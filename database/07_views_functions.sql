-- ============================================================
-- 07_views_functions.sql
-- Views و Functions للإحصائيات والتقارير - EcoControl
-- ============================================================

-- ============================================================
-- VIEWS - عروض البيانات
-- ============================================================

-- ============================================================
-- 1. عرض آخر قراءات المناخ لكل جهاز
-- ============================================================
CREATE OR REPLACE VIEW v_latest_climate_readings AS
SELECT DISTINCT ON (device_id)
    device_id,
    temperature,
    humidity,
    pressure,
    light_level,
    reading_quality,
    recorded_at,
    EXTRACT(EPOCH FROM (NOW() - recorded_at)) AS seconds_ago
FROM climate_readings
ORDER BY device_id, recorded_at DESC;

-- ============================================================
-- 2. عرض آخر قراءات الري لكل وحدة
-- ============================================================
CREATE OR REPLACE VIEW v_latest_irrigation_readings AS
SELECT DISTINCT ON (unit_id)
    unit_id,
    soil_moisture,
    water_flow,
    total_water_consumed,
    irrigation_active,
    current_mode,
    recorded_at,
    EXTRACT(EPOCH FROM (NOW() - recorded_at)) AS seconds_ago
FROM irrigation_readings
ORDER BY unit_id, recorded_at DESC;

-- ============================================================
-- 3. عرض حالة جميع الأجهزة
-- ============================================================
CREATE OR REPLACE VIEW v_all_devices_status AS
SELECT 
    'esp32' AS device_type,
    device_id AS identifier,
    name,
    is_connected,
    last_seen_at,
    EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS offline_seconds
FROM esp32_devices
WHERE is_active = TRUE

UNION ALL

SELECT 
    'irrigation_unit' AS device_type,
    unit_id AS identifier,
    name,
    is_connected,
    last_seen_at,
    EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS offline_seconds
FROM plant_bed_units
WHERE is_active = TRUE;

-- ============================================================
-- 4. عرض إحصائيات الري اليومية
-- ============================================================
CREATE OR REPLACE VIEW v_daily_irrigation_stats AS
SELECT 
    unit_id,
    DATE(started_at) AS irrigation_date,
    COUNT(*) AS session_count,
    SUM(water_consumed) AS total_water,
    AVG(water_consumed) AS avg_water_per_session,
    AVG(duration_seconds) AS avg_duration,
    AVG(moisture_before) AS avg_moisture_before,
    AVG(moisture_after) AS avg_moisture_after,
    MIN(started_at) AS first_session,
    MAX(started_at) AS last_session
FROM irrigation_sessions
WHERE status = 'completed'
GROUP BY unit_id, DATE(started_at)
ORDER BY irrigation_date DESC;

-- ============================================================
-- 5. عرض المخزون المنخفض
-- ============================================================
CREATE OR REPLACE VIEW v_low_stock_items AS
SELECT 
    id,
    name,
    type,
    quantity,
    min_threshold,
    unit,
    (min_threshold - quantity) AS shortage,
    ROUND((quantity / NULLIF(min_threshold, 0) * 100)::numeric, 1) AS stock_percentage,
    expiry_date,
    CASE 
        WHEN expiry_date < CURRENT_DATE THEN 'expired'
        WHEN expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'ok'
    END AS expiry_status
FROM fertilizers_stock
WHERE is_active = TRUE 
    AND (quantity <= min_threshold OR expiry_date < CURRENT_DATE + INTERVAL '30 days')
ORDER BY stock_percentage ASC;

-- ============================================================
-- 6. عرض الأحواض مع النباتات
-- ============================================================
CREATE OR REPLACE VIEW v_beds_with_plants AS
SELECT 
    b.id AS bed_id,
    b.bed_number,
    b.name AS bed_name,
    b.description,
    b.location,
    b.status,
    b.irrigation_unit_id,
    COUNT(bp.id) AS plant_count,
    ARRAY_AGG(DISTINCT COALESCE(bp.plant_name, pc.name)) FILTER (WHERE bp.id IS NOT NULL) AS plant_names,
    ARRAY_AGG(DISTINCT pc.category) FILTER (WHERE pc.id IS NOT NULL) AS plant_categories
FROM greenhouse_beds b
LEFT JOIN bed_plants bp ON b.id = bp.bed_id
LEFT JOIN plants_catalog pc ON bp.plant_id = pc.id
GROUP BY b.id
ORDER BY b.bed_number;

-- ============================================================
-- 7. عرض التنبيهات النشطة الملخصة
-- ============================================================
CREATE OR REPLACE VIEW v_active_alerts_summary AS
SELECT 
    alert_type,
    severity,
    COUNT(*) AS alert_count,
    MIN(triggered_at) AS oldest_alert,
    MAX(triggered_at) AS newest_alert
FROM active_alerts
WHERE status = 'active'
GROUP BY alert_type, severity
ORDER BY 
    CASE severity 
        WHEN 'critical' THEN 1 
        WHEN 'warning' THEN 2 
        ELSE 3 
    END,
    alert_count DESC;

-- ============================================================
-- 8. عرض إحصائيات المستخدمين
-- ============================================================
CREATE OR REPLACE VIEW v_user_stats AS
SELECT 
    user_type,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE is_active = TRUE) AS active_count,
    COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days') AS active_last_week,
    COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '30 days') AS active_last_month
FROM users
WHERE user_type != 'admin'
GROUP BY user_type;

-- ============================================================
-- FUNCTIONS - الدوال
-- ============================================================

-- ============================================================
-- 1. دالة حساب متوسط القراءات لفترة معينة
-- ============================================================
CREATE OR REPLACE FUNCTION get_climate_averages(
    p_device_id VARCHAR(50),
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    avg_temperature DECIMAL(5,2),
    avg_humidity DECIMAL(5,2),
    min_temperature DECIMAL(5,2),
    max_temperature DECIMAL(5,2),
    min_humidity DECIMAL(5,2),
    max_humidity DECIMAL(5,2),
    reading_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ROUND(AVG(temperature)::numeric, 2)::DECIMAL(5,2),
        ROUND(AVG(humidity)::numeric, 2)::DECIMAL(5,2),
        MIN(temperature),
        MAX(temperature),
        MIN(humidity),
        MAX(humidity),
        COUNT(*)
    FROM climate_readings
    WHERE device_id = p_device_id
        AND recorded_at > NOW() - (p_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. دالة حساب استهلاك المياه لوحدة معينة
-- ============================================================
CREATE OR REPLACE FUNCTION get_water_consumption(
    p_unit_id VARCHAR(50),
    p_start_date DATE DEFAULT CURRENT_DATE - 7,
    p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    consumption_date DATE,
    total_liters DECIMAL(10,3),
    session_count BIGINT,
    avg_per_session DECIMAL(10,3)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE(started_at),
        COALESCE(SUM(water_consumed), 0),
        COUNT(*),
        COALESCE(AVG(water_consumed), 0)
    FROM irrigation_sessions
    WHERE unit_id = p_unit_id
        AND DATE(started_at) BETWEEN p_start_date AND p_end_date
        AND status = 'completed'
    GROUP BY DATE(started_at)
    ORDER BY DATE(started_at);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. دالة إنشاء تنبيه جديد
-- ============================================================
CREATE OR REPLACE FUNCTION create_alert(
    p_alert_type VARCHAR(50),
    p_severity VARCHAR(20),
    p_title VARCHAR(200),
    p_message TEXT,
    p_source_type VARCHAR(50),
    p_source_id VARCHAR(100),
    p_source_name VARCHAR(100) DEFAULT NULL,
    p_current_value DECIMAL(10,2) DEFAULT NULL,
    p_threshold_value DECIMAL(10,2) DEFAULT NULL,
    p_unit VARCHAR(20) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_alert_id UUID;
BEGIN
    -- التحقق من عدم وجود تنبيه مشابه نشط
    SELECT id INTO v_alert_id
    FROM active_alerts
    WHERE alert_type = p_alert_type
        AND source_type = p_source_type
        AND source_id = p_source_id
        AND status = 'active'
    LIMIT 1;
    
    IF v_alert_id IS NOT NULL THEN
        -- تحديث التنبيه الموجود
        UPDATE active_alerts
        SET 
            current_value = p_current_value,
            triggered_at = NOW()
        WHERE id = v_alert_id;
        
        RETURN v_alert_id;
    END IF;
    
    -- إنشاء تنبيه جديد
    INSERT INTO active_alerts (
        alert_type, severity, title, message,
        source_type, source_id, source_name,
        current_value, threshold_value, unit
    )
    VALUES (
        p_alert_type, p_severity, p_title, p_message,
        p_source_type, p_source_id, p_source_name,
        p_current_value, p_threshold_value, p_unit
    )
    RETURNING id INTO v_alert_id;
    
    RETURN v_alert_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. دالة حل التنبيه
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_alert(
    p_alert_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_resolution_type VARCHAR(30) DEFAULT 'auto',
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_alert RECORD;
BEGIN
    -- جلب التنبيه
    SELECT * INTO v_alert
    FROM active_alerts
    WHERE id = p_alert_id AND status = 'active';
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- تحديث التنبيه
    UPDATE active_alerts
    SET 
        status = 'resolved',
        resolved_at = NOW(),
        resolved_by = p_user_id,
        resolution_notes = p_notes
    WHERE id = p_alert_id;
    
    -- نسخ للتاريخ
    INSERT INTO alert_history (
        original_alert_id, alert_type, severity,
        source_type, source_id, source_name,
        title, message,
        current_value, threshold_value,
        triggered_at, resolved_at,
        duration_seconds, resolution_type,
        resolved_by, resolution_notes
    )
    VALUES (
        v_alert.id, v_alert.alert_type, v_alert.severity,
        v_alert.source_type, v_alert.source_id, v_alert.source_name,
        v_alert.title, v_alert.message,
        v_alert.current_value, v_alert.threshold_value,
        v_alert.triggered_at, NOW(),
        EXTRACT(EPOCH FROM (NOW() - v_alert.triggered_at))::INTEGER,
        p_resolution_type, p_user_id, p_notes
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. دالة تسجيل حدث في سجل التدقيق
-- ============================================================
CREATE OR REPLACE FUNCTION log_audit(
    p_user_id UUID,
    p_action VARCHAR(50),
    p_table_name VARCHAR(100),
    p_record_id TEXT,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
    v_username VARCHAR(50);
BEGIN
    -- جلب اسم المستخدم
    SELECT username INTO v_username
    FROM users WHERE id = p_user_id;
    
    INSERT INTO audit_log (
        user_id, username, user_ip,
        action, table_name, record_id,
        old_values, new_values, description
    )
    VALUES (
        p_user_id, v_username, p_ip_address,
        p_action, p_table_name, p_record_id,
        p_old_values, p_new_values, p_description
    )
    RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. دالة إعادة تعيين إحصائيات القواعد الذكية اليومية
-- ============================================================
CREATE OR REPLACE FUNCTION reset_daily_smart_rules_stats()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE smart_irrigation_rules
    SET 
        today_session_count = 0,
        today_water_consumed = 0,
        stats_reset_date = CURRENT_DATE
    WHERE stats_reset_date < CURRENT_DATE;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. دالة حساب الملخص الإحصائي للوحة التحكم
-- ============================================================
CREATE OR REPLACE FUNCTION get_dashboard_summary()
RETURNS TABLE (
    total_devices INTEGER,
    connected_devices INTEGER,
    total_irrigation_units INTEGER,
    connected_units INTEGER,
    active_alerts INTEGER,
    critical_alerts INTEGER,
    today_water_consumption DECIMAL(10,3),
    today_irrigation_sessions INTEGER,
    low_stock_items INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*)::INTEGER FROM esp32_devices WHERE is_active = TRUE),
        (SELECT COUNT(*)::INTEGER FROM esp32_devices WHERE is_active = TRUE AND is_connected = TRUE),
        (SELECT COUNT(*)::INTEGER FROM plant_bed_units WHERE is_active = TRUE),
        (SELECT COUNT(*)::INTEGER FROM plant_bed_units WHERE is_active = TRUE AND is_connected = TRUE),
        (SELECT COUNT(*)::INTEGER FROM active_alerts WHERE status = 'active'),
        (SELECT COUNT(*)::INTEGER FROM active_alerts WHERE status = 'active' AND severity = 'critical'),
        (SELECT COALESCE(SUM(water_consumed), 0) FROM irrigation_sessions WHERE DATE(started_at) = CURRENT_DATE),
        (SELECT COUNT(*)::INTEGER FROM irrigation_sessions WHERE DATE(started_at) = CURRENT_DATE),
        (SELECT COUNT(*)::INTEGER FROM fertilizers_stock WHERE is_active = TRUE AND quantity <= min_threshold);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGERS - المحفزات
-- ============================================================

-- ============================================================
-- 1. محفز لتسجيل تغييرات العتبات تلقائياً
-- ============================================================
CREATE OR REPLACE FUNCTION log_threshold_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.on_value != NEW.on_value 
       OR OLD.off_value != NEW.off_value 
       OR OLD.comparison != NEW.comparison THEN
        
        INSERT INTO threshold_history (
            threshold_id, device_id, relay_id,
            old_on_value, new_on_value,
            old_off_value, new_off_value,
            old_comparison, new_comparison
        )
        VALUES (
            NEW.id, NEW.device_id, NEW.relay_id,
            OLD.on_value, NEW.on_value,
            OLD.off_value, NEW.off_value,
            OLD.comparison, NEW.comparison
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_threshold_change ON automation_thresholds;
CREATE TRIGGER trg_log_threshold_change
    AFTER UPDATE ON automation_thresholds
    FOR EACH ROW
    EXECUTE FUNCTION log_threshold_change();

-- ============================================================
-- 2. محفز لتحديث إحصائيات المخزون
-- ============================================================
CREATE OR REPLACE FUNCTION update_stock_after_transaction()
RETURNS TRIGGER AS $$
BEGIN
    -- تحديث الكمية في جدول المخزون
    UPDATE fertilizers_stock
    SET quantity = quantity + NEW.quantity_change
    WHERE id = NEW.item_id;
    
    -- تحديث القيم في سجل المعاملة
    NEW.quantity_after := (
        SELECT quantity FROM fertilizers_stock WHERE id = NEW.item_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SCHEDULED JOBS (للتنفيذ عبر pg_cron أو خدمة خارجية)
-- ============================================================

-- يمكن جدولة هذه الدوال للتنفيذ الدوري:
-- 1. reset_daily_smart_rules_stats() - يومياً عند منتصف الليل
-- 2. حذف القراءات القديمة (أكثر من 90 يوم) للحفاظ على الأداء
-- 3. إغلاق التنبيهات القديمة تلقائياً

-- مثال لحذف البيانات القديمة (يُنفذ شهرياً):
-- DELETE FROM climate_readings WHERE recorded_at < NOW() - INTERVAL '90 days';
-- DELETE FROM irrigation_readings WHERE recorded_at < NOW() - INTERVAL '90 days';

-- ============================================================
-- نهاية الملف
-- ============================================================


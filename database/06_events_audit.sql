-- ============================================================
-- 06_events_audit.sql
-- جداول الأحداث والتدقيق - EcoControl
-- ============================================================

-- ============================================================
-- جدول أحداث النظام
-- ============================================================
CREATE TABLE IF NOT EXISTS system_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- تصنيف الحدث
    event_category VARCHAR(30) NOT NULL
        CHECK (event_category IN (
            'device',           -- أحداث الأجهزة
            'climate',          -- أحداث المناخ
            'irrigation',       -- أحداث الري
            'inventory',        -- أحداث المخزون
            'user',             -- أحداث المستخدمين
            'system',           -- أحداث النظام
            'security'          -- أحداث الأمان
        )),
    
    -- نوع الحدث
    event_type VARCHAR(50) NOT NULL,
    
    -- مستوى الأهمية
    severity VARCHAR(20) NOT NULL DEFAULT 'info'
        CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    
    -- عنوان ووصف الحدث
    title VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- بيانات إضافية
    metadata JSONB,
    
    -- المصدر
    source_type VARCHAR(50),                -- device, unit, user, api, system
    source_id VARCHAR(100),                 -- معرف المصدر
    
    -- المستخدم المرتبط (إذا وجد)
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- حالة المعالجة
    is_read BOOLEAN DEFAULT FALSE,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس مهمة
CREATE INDEX IF NOT EXISTS idx_system_events_category ON system_events(event_category);
CREATE INDEX IF NOT EXISTS idx_system_events_severity ON system_events(severity);
CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_unread ON system_events(is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_system_events_source ON system_events(source_type, source_id);

-- ============================================================
-- جدول سجل التدقيق (Audit Log)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- المستخدم
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50),                   -- حفظ اسم المستخدم حتى لو حُذف
    user_ip INET,
    user_agent TEXT,
    
    -- نوع العملية
    action VARCHAR(50) NOT NULL
        CHECK (action IN (
            'create', 'read', 'update', 'delete',
            'login', 'logout', 'login_failed',
            'settings_change', 'mode_change',
            'export', 'import', 'bulk_action'
        )),
    
    -- الجدول والسجل المتأثر
    table_name VARCHAR(100),
    record_id TEXT,
    
    -- البيانات
    old_values JSONB,                       -- القيم القديمة
    new_values JSONB,                       -- القيم الجديدة
    
    -- تفاصيل إضافية
    description TEXT,
    metadata JSONB,
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(table_name, record_id);

-- ============================================================
-- جدول الإشعارات
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- المستلم
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    -- إذا كان NULL يعني إشعار عام للجميع
    
    -- نوع الإشعار
    notification_type VARCHAR(30) NOT NULL
        CHECK (notification_type IN (
            'alert',            -- تنبيه
            'warning',          -- تحذير
            'info',             -- معلومة
            'success',          -- نجاح
            'reminder',         -- تذكير
            'system'            -- نظام
        )),
    
    -- المحتوى
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    
    -- رابط للتفاصيل (اختياري)
    action_url TEXT,
    action_label VARCHAR(50),
    
    -- الأيقونة واللون
    icon VARCHAR(50),
    color VARCHAR(20),
    
    -- بيانات إضافية
    metadata JSONB,
    
    -- الحالة
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- انتهاء الصلاحية
    expires_at TIMESTAMPTZ,
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================================
-- جدول التنبيهات النشطة
-- ============================================================
CREATE TABLE IF NOT EXISTS active_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- تصنيف التنبيه
    alert_type VARCHAR(50) NOT NULL
        CHECK (alert_type IN (
            'temperature_high', 'temperature_low',
            'humidity_high', 'humidity_low',
            'soil_dry', 'soil_wet',
            'device_offline', 'device_error',
            'low_stock', 'expired_stock',
            'leak_detected', 'blockage_detected',
            'system_error', 'security_alert'
        )),
    
    -- مستوى الخطورة
    severity VARCHAR(20) NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('info', 'warning', 'critical')),
    
    -- المصدر
    source_type VARCHAR(50),
    source_id VARCHAR(100),
    source_name VARCHAR(100),
    
    -- المحتوى
    title VARCHAR(200) NOT NULL,
    message TEXT,
    
    -- القيم
    current_value DECIMAL(10,2),
    threshold_value DECIMAL(10,2),
    unit VARCHAR(20),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'acknowledged', 'resolved', 'ignored')),
    
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    
    -- التواريخ
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_active_alerts_type ON active_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_active_alerts_severity ON active_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_active_alerts_status ON active_alerts(status);
CREATE INDEX IF NOT EXISTS idx_active_alerts_active ON active_alerts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_active_alerts_source ON active_alerts(source_type, source_id);

-- ============================================================
-- جدول سجل التنبيهات (تاريخي)
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- نسخة من التنبيه
    original_alert_id UUID,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    
    source_type VARCHAR(50),
    source_id VARCHAR(100),
    source_name VARCHAR(100),
    
    title VARCHAR(200) NOT NULL,
    message TEXT,
    
    current_value DECIMAL(10,2),
    threshold_value DECIMAL(10,2),
    
    -- مدة التنبيه
    triggered_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    
    -- كيف تم الحل
    resolution_type VARCHAR(30)
        CHECK (resolution_type IN ('auto', 'manual', 'ignored', 'expired')),
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_alert_history_type ON alert_history(alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_source ON alert_history(source_type, source_id);

-- ============================================================
-- جدول إعدادات التنبيهات للمستخدمين
-- ============================================================
CREATE TABLE IF NOT EXISTS user_alert_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- قنوات الإشعار
    email_enabled BOOLEAN DEFAULT FALSE,
    push_enabled BOOLEAN DEFAULT TRUE,
    
    -- أنواع التنبيهات المفعلة
    temperature_alerts BOOLEAN DEFAULT TRUE,
    humidity_alerts BOOLEAN DEFAULT TRUE,
    irrigation_alerts BOOLEAN DEFAULT TRUE,
    device_alerts BOOLEAN DEFAULT TRUE,
    stock_alerts BOOLEAN DEFAULT TRUE,
    security_alerts BOOLEAN DEFAULT TRUE,
    
    -- الحد الأدنى للخطورة
    min_severity VARCHAR(20) DEFAULT 'warning'
        CHECK (min_severity IN ('info', 'warning', 'critical')),
    
    -- أوقات عدم الإزعاج
    quiet_hours_enabled BOOLEAN DEFAULT FALSE,
    quiet_start_hour INTEGER DEFAULT 22,
    quiet_end_hour INTEGER DEFAULT 7,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_user_alert_preferences_updated_at ON user_alert_preferences;
CREATE TRIGGER update_user_alert_preferences_updated_at
    BEFORE UPDATE ON user_alert_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_alert_preferences ENABLE ROW LEVEL SECURITY;

-- سياسة: المدير يرى كل شيء
CREATE POLICY admin_all_events ON system_events
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- سياسة: المستخدم يرى إشعاراته فقط
CREATE POLICY user_own_notifications ON notifications
    FOR SELECT
    USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY user_own_preferences ON user_alert_preferences
    FOR ALL
    USING (user_id = auth.uid());

-- ============================================================
-- نهاية الملف
-- ============================================================


-- ============================================================
-- 04_irrigation.sql
-- جداول نظام الري - EcoControl
-- ============================================================

-- ============================================================
-- جدول قراءات الري (رطوبة التربة، تدفق المياه)
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_readings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- مصدر القراءة
    unit_id VARCHAR(50) NOT NULL,           -- معرف وحدة الري
    
    -- القراءات
    soil_moisture DECIMAL(5,2),             -- رطوبة التربة (%)
    water_flow DECIMAL(8,3),                -- معدل التدفق (L/min)
    total_water_consumed DECIMAL(10,3),     -- إجمالي الاستهلاك (L)
    
    -- حالة الري
    irrigation_active BOOLEAN DEFAULT FALSE,
    current_mode VARCHAR(20),               -- off, quantitative, temporal, moisture, manual
    
    -- التاريخ
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس مهمة
CREATE INDEX IF NOT EXISTS idx_irrigation_readings_unit_id ON irrigation_readings(unit_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_readings_recorded_at ON irrigation_readings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_irrigation_readings_unit_time ON irrigation_readings(unit_id, recorded_at DESC);

-- ============================================================
-- جدول جلسات الري (كل عملية ري)
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- الوحدة
    unit_id VARCHAR(50) NOT NULL,
    
    -- نوع الري
    irrigation_mode VARCHAR(20) NOT NULL    -- quantitative, temporal, moisture, manual
        CHECK (irrigation_mode IN ('quantitative', 'temporal', 'moisture', 'manual')),
    
    -- تفاصيل الجلسة
    target_value DECIMAL(8,2),              -- الهدف (لتر أو دقيقة)
    actual_value DECIMAL(8,2),              -- القيمة الفعلية
    
    -- كمية المياه
    water_consumed DECIMAL(10,3),           -- المياه المستهلكة (لتر)
    
    -- رطوبة التربة
    moisture_before DECIMAL(5,2),           -- رطوبة قبل الري
    moisture_after DECIMAL(5,2),            -- رطوبة بعد الري
    
    -- حالة الجلسة
    status VARCHAR(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'stopped', 'failed', 'skipped')),
    
    -- سبب التوقف/الفشل
    stop_reason TEXT,
    
    -- التواريخ
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,               -- المدة بالثواني
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_irrigation_sessions_unit_id ON irrigation_sessions(unit_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_sessions_started_at ON irrigation_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_irrigation_sessions_status ON irrigation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_irrigation_sessions_mode ON irrigation_sessions(irrigation_mode);

-- ============================================================
-- جدول إعدادات الري لكل وحدة
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- الوحدة
    unit_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- الوضع الحالي
    irrigation_mode VARCHAR(20) NOT NULL DEFAULT 'off'
        CHECK (irrigation_mode IN ('off', 'quantitative', 'temporal', 'moisture', 'manual')),
    
    -- ========== إعدادات الري الكمي ==========
    quantitative_value DECIMAL(8,2) DEFAULT 5.0,        -- الكمية باللتر
    quantitative_schedule VARCHAR(20) DEFAULT 'immediate'
        CHECK (quantitative_schedule IN ('immediate', 'hourly', 'daily')),
    quantitative_interval INTEGER DEFAULT 6,             -- كل X ساعة
    quantitative_daily_hour INTEGER DEFAULT 6,           -- الساعة
    quantitative_daily_minute INTEGER DEFAULT 0,         -- الدقيقة
    
    -- ========== إعدادات الري الوقتي ==========
    temporal_value INTEGER DEFAULT 10,                   -- المدة بالدقائق
    temporal_schedule VARCHAR(20) DEFAULT 'immediate'
        CHECK (temporal_schedule IN ('immediate', 'hourly', 'daily')),
    temporal_interval INTEGER DEFAULT 6,
    temporal_daily_hour INTEGER DEFAULT 6,
    temporal_daily_minute INTEGER DEFAULT 0,
    
    -- ========== إعدادات الري الذكي ==========
    moisture_threshold DECIMAL(5,2) DEFAULT 40.0,        -- عتبة الرطوبة (%)
    moisture_check_interval INTEGER DEFAULT 30,          -- فحص كل X دقيقة
    moisture_irrigation_type VARCHAR(20) DEFAULT 'quantitative'
        CHECK (moisture_irrigation_type IN ('quantitative', 'temporal')),
    moisture_irrigation_value DECIMAL(8,2) DEFAULT 5.0,
    
    -- ========== التحكم اليدوي ==========
    manual_pump BOOLEAN DEFAULT FALSE,
    manual_valve_open BOOLEAN DEFAULT FALSE,
    manual_valve_close BOOLEAN DEFAULT FALSE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_irrigation_settings_unit_id ON irrigation_settings(unit_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_settings_mode ON irrigation_settings(irrigation_mode);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_irrigation_settings_updated_at ON irrigation_settings;
CREATE TRIGGER update_irrigation_settings_updated_at
    BEFORE UPDATE ON irrigation_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول القواعد الذكية
-- ============================================================
CREATE TABLE IF NOT EXISTS smart_irrigation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- الوحدة
    unit_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- ========== النافذة الزمنية ==========
    enable_time_window BOOLEAN DEFAULT FALSE,
    allowed_start_hour INTEGER DEFAULT 6,
    allowed_end_hour INTEGER DEFAULT 20,
    
    -- ========== حدود الجلسات ==========
    enable_daily_limit BOOLEAN DEFAULT FALSE,
    max_sessions_per_day INTEGER DEFAULT 5,
    
    enable_min_interval BOOLEAN DEFAULT FALSE,
    min_interval_minutes INTEGER DEFAULT 120,
    
    -- ========== حد الاستهلاك اليومي ==========
    enable_daily_consumption BOOLEAN DEFAULT FALSE,
    max_liters_per_day DECIMAL(8,2) DEFAULT 50.0,
    
    -- ========== التخطي الذكي ==========
    enable_moisture_skip BOOLEAN DEFAULT FALSE,
    skip_if_moisture_above DECIMAL(5,2) DEFAULT 80,
    
    -- ========== كشف الأعطال ==========
    enable_leak_detection BOOLEAN DEFAULT TRUE,
    enable_blockage_detection BOOLEAN DEFAULT TRUE,
    expected_flow_rate DECIMAL(6,2) DEFAULT 10.0,
    
    -- إحصائيات اليوم الحالي (تُصفر يومياً)
    today_session_count INTEGER DEFAULT 0,
    today_water_consumed DECIMAL(10,3) DEFAULT 0,
    last_session_at TIMESTAMPTZ,
    stats_reset_date DATE DEFAULT CURRENT_DATE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_smart_rules_unit_id ON smart_irrigation_rules(unit_id);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_smart_rules_updated_at ON smart_irrigation_rules;
CREATE TRIGGER update_smart_rules_updated_at
    BEFORE UPDATE ON smart_irrigation_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول أحداث الري (سجل كل عملية)
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- الوحدة
    unit_id VARCHAR(50) NOT NULL,
    
    -- نوع الحدث
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN (
            'session_started', 'session_ended', 'session_stopped',
            'mode_changed', 'settings_updated', 'rule_triggered',
            'pump_on', 'pump_off', 'valve_opened', 'valve_closed',
            'emergency_stop', 'skip_triggered', 'error', 'warning'
        )),
    
    -- تفاصيل الحدث
    details JSONB,
    
    -- القيم المرتبطة
    soil_moisture DECIMAL(5,2),
    water_flow DECIMAL(8,3),
    
    -- من قام بالعملية (إذا كان يدوياً)
    triggered_by UUID REFERENCES users(id),
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_irrigation_events_unit_id ON irrigation_events(unit_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_events_event_type ON irrigation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_irrigation_events_created_at ON irrigation_events(created_at DESC);

-- ============================================================
-- جدول استهلاك المياه اليومي (ملخص)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_water_consumption (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- الوحدة واليوم
    unit_id VARCHAR(50) NOT NULL,
    consumption_date DATE NOT NULL,
    
    -- الإحصائيات
    total_liters DECIMAL(10,3) DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    
    -- أوقات الري
    first_session_at TIMESTAMPTZ,
    last_session_at TIMESTAMPTZ,
    
    -- متوسطات
    avg_moisture_before DECIMAL(5,2),
    avg_moisture_after DECIMAL(5,2),
    avg_session_duration INTEGER,           -- بالثواني
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- مفتاح فريد
    UNIQUE(unit_id, consumption_date)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_daily_consumption_unit_date ON daily_water_consumption(unit_id, consumption_date DESC);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE irrigation_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_irrigation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_water_consumption ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة للجميع
CREATE POLICY read_irrigation ON irrigation_readings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_sessions ON irrigation_sessions
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_settings ON irrigation_settings
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- نهاية الملف
-- ============================================================


-- ============================================================
-- 03_climate.sql
-- جداول المناخ والحساسات - EcoControl
-- ============================================================

-- ============================================================
-- جدول قراءات المناخ (الحرارة والرطوبة)
-- ============================================================
CREATE TABLE IF NOT EXISTS climate_readings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- مصدر القراءة
    device_id VARCHAR(50) NOT NULL,         -- معرف جهاز ESP32
    
    -- القراءات
    temperature DECIMAL(5,2),               -- درجة الحرارة (°C)
    humidity DECIMAL(5,2),                  -- نسبة الرطوبة (%)
    
    -- بيانات إضافية (اختياري)
    pressure DECIMAL(7,2),                  -- الضغط الجوي (hPa)
    light_level INTEGER,                    -- مستوى الإضاءة (lux)
    co2_level INTEGER,                      -- مستوى CO2 (ppm)
    
    -- جودة القراءة
    reading_quality VARCHAR(20) DEFAULT 'good'
        CHECK (reading_quality IN ('good', 'warning', 'error')),
    
    -- التاريخ
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس مهمة للأداء
CREATE INDEX IF NOT EXISTS idx_climate_readings_device_id ON climate_readings(device_id);
CREATE INDEX IF NOT EXISTS idx_climate_readings_recorded_at ON climate_readings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_readings_device_time ON climate_readings(device_id, recorded_at DESC);

-- ملاحظة: لا يمكن استخدام NOW() في partial index لأنها ليست IMMUTABLE
-- الفهرس أعلاه (device_time) كافٍ للاستعلامات على القراءات الأخيرة

-- ============================================================
-- جدول حالة الريلي (Relay States)
-- ============================================================
CREATE TABLE IF NOT EXISTS relay_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- مصدر الريلي
    device_id VARCHAR(50) NOT NULL,         -- معرف جهاز ESP32
    relay_id VARCHAR(20) NOT NULL,          -- fan, motor, pump, heater
    
    -- الحالة
    label VARCHAR(50),                      -- اسم العرض
    mode VARCHAR(10) NOT NULL DEFAULT 'auto'
        CHECK (mode IN ('auto', 'manual')),
    state BOOLEAN NOT NULL DEFAULT FALSE,   -- ON/OFF
    
    -- التواريخ
    last_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- مفتاح فريد لكل ريلي في كل جهاز
    UNIQUE(device_id, relay_id)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_relay_states_device_id ON relay_states(device_id);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_relay_states_updated_at ON relay_states;
CREATE TRIGGER update_relay_states_updated_at
    BEFORE UPDATE ON relay_states
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول أحداث الريلي (سجل التشغيل/الإيقاف)
-- ============================================================
CREATE TABLE IF NOT EXISTS relay_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- مصدر الحدث
    device_id VARCHAR(50) NOT NULL,
    relay_id VARCHAR(20) NOT NULL,          -- fan, motor, pump, heater
    
    -- تفاصيل الحدث
    event_type VARCHAR(20) NOT NULL         -- state_change, mode_change
        CHECK (event_type IN ('state_change', 'mode_change', 'threshold_trigger', 'manual_override')),
    
    previous_state BOOLEAN,
    new_state BOOLEAN,
    previous_mode VARCHAR(10),
    new_mode VARCHAR(10),
    
    -- سبب التغيير
    trigger_reason VARCHAR(100),            -- auto_rule, manual, api, threshold
    trigger_value DECIMAL(6,2),             -- القيمة التي أدت للتشغيل (مثلاً: الحرارة 32°C)
    
    -- من قام بالتغيير (إذا كان يدوياً)
    triggered_by UUID REFERENCES users(id),
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_relay_events_device_relay ON relay_events(device_id, relay_id);
CREATE INDEX IF NOT EXISTS idx_relay_events_created_at ON relay_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relay_events_event_type ON relay_events(event_type);

-- ============================================================
-- جدول عتبات الأتمتة (Automation Thresholds)
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- مصدر الإعدادات
    device_id VARCHAR(50) NOT NULL,
    relay_id VARCHAR(20) NOT NULL,          -- fan, motor, pump, heater
    
    -- إعدادات العتبة
    threshold_type VARCHAR(20) NOT NULL     -- temperature, humidity
        CHECK (threshold_type IN ('temperature', 'humidity', 'soil_moisture', 'light')),
    comparison VARCHAR(10) NOT NULL         -- above, below
        CHECK (comparison IN ('above', 'below')),
    
    on_value DECIMAL(6,2) NOT NULL,         -- قيمة التشغيل
    off_value DECIMAL(6,2) NOT NULL,        -- قيمة الإيقاف
    
    -- الوحدة والوصف
    unit VARCHAR(10),                       -- °C, %, etc.
    description TEXT,
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- مفتاح فريد
    UNIQUE(device_id, relay_id)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_automation_thresholds_device ON automation_thresholds(device_id);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_automation_thresholds_updated_at ON automation_thresholds;
CREATE TRIGGER update_automation_thresholds_updated_at
    BEFORE UPDATE ON automation_thresholds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول تاريخ تغييرات العتبات
-- ============================================================
CREATE TABLE IF NOT EXISTS threshold_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    threshold_id UUID REFERENCES automation_thresholds(id) ON DELETE SET NULL,
    device_id VARCHAR(50) NOT NULL,
    relay_id VARCHAR(20) NOT NULL,
    
    -- القيم السابقة والجديدة
    old_on_value DECIMAL(6,2),
    new_on_value DECIMAL(6,2),
    old_off_value DECIMAL(6,2),
    new_off_value DECIMAL(6,2),
    old_comparison VARCHAR(10),
    new_comparison VARCHAR(10),
    
    -- من قام بالتغيير
    changed_by UUID REFERENCES users(id),
    change_reason TEXT,
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_threshold_history_threshold_id ON threshold_history(threshold_id);
CREATE INDEX IF NOT EXISTS idx_threshold_history_created_at ON threshold_history(created_at DESC);

-- ============================================================
-- إدراج العتبات الافتراضية
-- ============================================================
-- يتم تنفيذها عند تسجيل جهاز جديد
-- INSERT INTO automation_thresholds (device_id, relay_id, threshold_type, comparison, on_value, off_value, unit, description)
-- VALUES 
--     ('default', 'fan', 'temperature', 'above', 30, 28, '°C', 'المروحة تعمل عند ارتفاع الحرارة'),
--     ('default', 'heater', 'temperature', 'below', 20, 22, '°C', 'السخان يعمل عند انخفاض الحرارة'),
--     ('default', 'pump', 'humidity', 'below', 40, 55, '%', 'المضخة تعمل عند انخفاض الرطوبة'),
--     ('default', 'motor', 'temperature', 'above', 32, 30, '°C', 'الباب يفتح عند ارتفاع الحرارة')
-- ON CONFLICT DO NOTHING;

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE climate_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_history ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة للجميع
CREATE POLICY read_climate ON climate_readings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_relay_states ON relay_states
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_relay_events ON relay_events
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_thresholds ON automation_thresholds
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- نهاية الملف
-- ============================================================


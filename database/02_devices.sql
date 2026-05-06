-- ============================================================
-- 02_devices.sql
-- جداول الأجهزة والوحدات - EcoControl
-- ============================================================

-- ============================================================
-- جدول أجهزة ESP32 (وحدة المناخ)
-- ============================================================
CREATE TABLE IF NOT EXISTS esp32_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- معرف الجهاز الفريد (من ESP32)
    device_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- بيانات الجهاز
    name VARCHAR(100) NOT NULL DEFAULT 'جهاز ESP32',
    description TEXT,
    location VARCHAR(200),                  -- الموقع داخل الدفيئة
    
    -- نوع الجهاز
    device_type VARCHAR(50) NOT NULL DEFAULT 'climate_controller'
        CHECK (device_type IN ('climate_controller', 'irrigation_unit', 'sensor_node')),
    
    -- معلومات الاتصال
    ip_address INET,
    mac_address VARCHAR(17),
    firmware_version VARCHAR(20),
    
    -- حالة الاتصال
    is_connected BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ,
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_esp32_devices_device_id ON esp32_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_esp32_devices_device_type ON esp32_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_esp32_devices_is_connected ON esp32_devices(is_connected);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_esp32_devices_updated_at ON esp32_devices;
CREATE TRIGGER update_esp32_devices_updated_at
    BEFORE UPDATE ON esp32_devices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول وحدات الأحواض الزراعية (Plant Bed Units)
-- ============================================================
CREATE TABLE IF NOT EXISTS plant_bed_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- معرف الوحدة الفريد
    unit_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- بيانات الوحدة
    name VARCHAR(100) NOT NULL,
    description TEXT,
    location VARCHAR(200),                  -- الموقع
    
    -- ربط بحوض زراعي (اختياري)
    greenhouse_bed_id UUID,                 -- سيتم ربطه لاحقاً
    
    -- معلومات الجهاز
    device_id VARCHAR(50),                  -- معرف ESP32 المرتبط
    ip_address INET,
    firmware_version VARCHAR(20),
    
    -- حالة الاتصال
    is_connected BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ,
    
    -- إعدادات الري الافتراضية
    default_quantitative_liters DECIMAL(6,2) DEFAULT 5.0,    -- الكمية الافتراضية باللتر
    default_temporal_minutes INTEGER DEFAULT 10,              -- المدة الافتراضية بالدقائق
    default_moisture_threshold DECIMAL(5,2) DEFAULT 40.0,    -- عتبة الرطوبة الافتراضية
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_plant_bed_units_unit_id ON plant_bed_units(unit_id);
CREATE INDEX IF NOT EXISTS idx_plant_bed_units_is_connected ON plant_bed_units(is_connected);
CREATE INDEX IF NOT EXISTS idx_plant_bed_units_greenhouse_bed_id ON plant_bed_units(greenhouse_bed_id);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_plant_bed_units_updated_at ON plant_bed_units;
CREATE TRIGGER update_plant_bed_units_updated_at
    BEFORE UPDATE ON plant_bed_units
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول حالة اتصال الأجهزة (للتتبع التاريخي)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_connection_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- نوع الجهاز ومعرفه
    device_type VARCHAR(50) NOT NULL,       -- esp32, plant_bed_unit
    device_identifier VARCHAR(50) NOT NULL, -- device_id أو unit_id
    
    -- حدث الاتصال
    event_type VARCHAR(20) NOT NULL         -- connected, disconnected, timeout
        CHECK (event_type IN ('connected', 'disconnected', 'timeout', 'error')),
    
    -- تفاصيل إضافية
    ip_address INET,
    details JSONB,
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_device_connection_logs_device ON device_connection_logs(device_type, device_identifier);
CREATE INDEX IF NOT EXISTS idx_device_connection_logs_created_at ON device_connection_logs(created_at DESC);

-- Partitioning by month (اختياري للأداء مع البيانات الكبيرة)
-- يمكن تفعيله لاحقاً إذا كانت البيانات كبيرة

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE esp32_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant_bed_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_connection_logs ENABLE ROW LEVEL SECURITY;

-- سياسة: الكل يمكنهم القراءة (للمستخدمين المسجلين)
CREATE POLICY read_devices ON esp32_devices
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY read_units ON plant_bed_units
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- سياسة: المدير فقط يمكنه التعديل
CREATE POLICY admin_manage_devices ON esp32_devices
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- ============================================================
-- نهاية الملف
-- ============================================================


-- =============================================
-- Unit State Table - حالة الوحدات وأوامر التحكم
-- لتخزين حالة ESP32 وأوامر التحكم بشكل دائم
-- =============================================

-- جدول حالة الوحدات
CREATE TABLE IF NOT EXISTS unit_state (
  unit_id TEXT PRIMARY KEY,

  -- بيانات الحساسات
  soil_moisture REAL DEFAULT 0,
  water_flow REAL DEFAULT 0,
  total_water_consumed REAL DEFAULT 0,
  irrigation_active BOOLEAN DEFAULT FALSE,
  current_mode TEXT DEFAULT 'off',
  connected BOOLEAN DEFAULT FALSE,
  pump_requested BOOLEAN DEFAULT FALSE,

  -- إعدادات التحكم
  irrigation_mode TEXT DEFAULT 'off',

  -- الري الكمي
  quantitative_value REAL DEFAULT 5.0,
  quantitative_schedule TEXT DEFAULT 'immediate',
  quantitative_interval INTEGER DEFAULT 6,
  quantitative_daily_hour INTEGER DEFAULT 6,
  quantitative_daily_minute INTEGER DEFAULT 0,

  -- الري الوقتي
  temporal_value INTEGER DEFAULT 10,
  temporal_schedule TEXT DEFAULT 'immediate',
  temporal_interval INTEGER DEFAULT 6,
  temporal_daily_hour INTEGER DEFAULT 6,
  temporal_daily_minute INTEGER DEFAULT 0,

  -- الري الذكي
  moisture_threshold REAL DEFAULT 40.0,
  moisture_check_interval INTEGER DEFAULT 30,
  moisture_irrigation_type TEXT DEFAULT 'quantitative',
  moisture_irrigation_value REAL DEFAULT 5.0,

  -- التحكم اليدوي
  manual_pump BOOLEAN DEFAULT FALSE,
  manual_valve_open BOOLEAN DEFAULT FALSE,
  manual_valve_close BOOLEAN DEFAULT FALSE,
  manual_irrigation_toggle BOOLEAN DEFAULT FALSE,

  -- القواعد الذكية - النافذة الزمنية
  enable_time_window BOOLEAN DEFAULT FALSE,
  allowed_start_hour INTEGER DEFAULT 6,
  allowed_end_hour INTEGER DEFAULT 20,

  -- القواعد الذكية - حدود الجلسات
  enable_daily_limit BOOLEAN DEFAULT FALSE,
  max_sessions_per_day INTEGER DEFAULT 5,
  enable_min_interval BOOLEAN DEFAULT FALSE,
  min_interval_minutes INTEGER DEFAULT 120,

  -- القواعد الذكية - حد الاستهلاك
  enable_daily_consumption BOOLEAN DEFAULT FALSE,
  max_liters_per_day REAL DEFAULT 50.0,

  -- القواعد الذكية - التخطي
  enable_moisture_skip BOOLEAN DEFAULT FALSE,
  skip_if_moisture_above INTEGER DEFAULT 80,

  -- كشف الأعطال
  enable_leak_detection BOOLEAN DEFAULT TRUE,
  enable_blockage_detection BOOLEAN DEFAULT TRUE,
  expected_flow_rate REAL DEFAULT 10.0,

  -- إعادة تعيين عداد المياه
  reset_total_water BOOLEAN DEFAULT FALSE,

  -- التوقيتات
  sensor_updated_at TIMESTAMPTZ,
  control_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول حالة المضخة المركزية
CREATE TABLE IF NOT EXISTS central_pump_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active BOOLEAN DEFAULT FALSE,
  requesting_units TEXT[] DEFAULT '{}',
  controlled_by TEXT,
  last_state_change TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إدراج صف افتراضي للمضخة المركزية
INSERT INTO central_pump_state (id, active, requesting_units)
VALUES (1, FALSE, '{}')
ON CONFLICT (id) DO NOTHING;

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_unit_state_updated ON unit_state(sensor_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_state_mode ON unit_state(irrigation_mode);

-- دالة تحديث التوقيت تلقائياً
CREATE OR REPLACE FUNCTION update_unit_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.control_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث التوقيت
DROP TRIGGER IF EXISTS unit_state_update_timestamp ON unit_state;
CREATE TRIGGER unit_state_update_timestamp
  BEFORE UPDATE ON unit_state
  FOR EACH ROW
  EXECUTE FUNCTION update_unit_state_timestamp();

-- دالة تحديث توقيت المضخة
CREATE OR REPLACE FUNCTION update_pump_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF OLD.active IS DISTINCT FROM NEW.active THEN
    NEW.last_state_change = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger للمضخة
DROP TRIGGER IF EXISTS pump_state_update_timestamp ON central_pump_state;
CREATE TRIGGER pump_state_update_timestamp
  BEFORE UPDATE ON central_pump_state
  FOR EACH ROW
  EXECUTE FUNCTION update_pump_state_timestamp();

-- تعليق
COMMENT ON TABLE unit_state IS 'حالة وحدات ESP32 وأوامر التحكم - للاستخدام مع Serverless';
COMMENT ON TABLE central_pump_state IS 'حالة المضخة المركزية - صف واحد فقط';
-- =====================================================
-- جدول إعدادات التحكم بالمناخ - EcoControl
-- =====================================================
-- هذا الجدول يخزن إعدادات وضع القيم المستهدفة (Setpoint Mode)
-- للحفاظ على الإعدادات حتى بعد إعادة تشغيل السيرفر أو النشر على الاستضافة

-- حذف الجدول إذا كان موجوداً (للتطوير فقط)
DROP TABLE IF EXISTS climate_settings CASCADE;

-- إنشاء الجدول
CREATE TABLE climate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- مفتاح التعريف (نستخدم قيمة ثابتة 'default' لأننا نحتاج إعدادات واحدة فقط)
  setting_key VARCHAR(50) UNIQUE NOT NULL DEFAULT 'default',
  
  -- هل وضع القيم المستهدفة مفعّل؟
  enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- القيم المستهدفة
  target_temperature DECIMAL(5,2) NOT NULL DEFAULT 25.0,  -- درجة الحرارة المستهدفة (°C)
  target_humidity DECIMAL(5,2) NOT NULL DEFAULT 60.0,     -- نسبة الرطوبة المستهدفة (%)
  
  -- هوامش التسامح
  temperature_tolerance DECIMAL(4,2) NOT NULL DEFAULT 2.0, -- هامش التسامح للحرارة (±°C)
  humidity_tolerance DECIMAL(4,2) NOT NULL DEFAULT 5.0,    -- هامش التسامح للرطوبة (±%)
  
  -- التواريخ
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- إدراج السجل الافتراضي
INSERT INTO climate_settings (setting_key, enabled, target_temperature, target_humidity, temperature_tolerance, humidity_tolerance)
VALUES ('default', false, 25.0, 60.0, 2.0, 5.0)
ON CONFLICT (setting_key) DO NOTHING;

-- إنشاء فهرس على setting_key
CREATE INDEX IF NOT EXISTS idx_climate_settings_key ON climate_settings(setting_key);

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_climate_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS trigger_update_climate_settings_timestamp ON climate_settings;
CREATE TRIGGER trigger_update_climate_settings_timestamp
  BEFORE UPDATE ON climate_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_climate_settings_timestamp();

-- تعليقات على الجدول والأعمدة
COMMENT ON TABLE climate_settings IS 'إعدادات التحكم بالمناخ (وضع القيم المستهدفة)';
COMMENT ON COLUMN climate_settings.setting_key IS 'مفتاح التعريف (دائماً "default")';
COMMENT ON COLUMN climate_settings.enabled IS 'هل وضع القيم المستهدفة مفعّل؟';
COMMENT ON COLUMN climate_settings.target_temperature IS 'درجة الحرارة المستهدفة (°C)';
COMMENT ON COLUMN climate_settings.target_humidity IS 'نسبة الرطوبة المستهدفة (%)';
COMMENT ON COLUMN climate_settings.temperature_tolerance IS 'هامش التسامح للحرارة (±°C)';
COMMENT ON COLUMN climate_settings.humidity_tolerance IS 'هامش التسامح للرطوبة (±%)';

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================
-- تفعيل RLS على الجدول
ALTER TABLE climate_settings ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة: الجميع يمكنهم القراءة (للواجهة)
CREATE POLICY "Anyone can read climate settings"
  ON climate_settings
  FOR SELECT
  USING (true);

-- سياسة التحديث: الجميع يمكنهم التحديث (يمكن تقييدها لاحقاً للمديرين فقط)
CREATE POLICY "Anyone can update climate settings"
  ON climate_settings
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- سياسة الإدراج: الجميع يمكنهم الإدراج (في حالة عدم وجود السجل)
CREATE POLICY "Anyone can insert climate settings"
  ON climate_settings
  FOR INSERT
  WITH CHECK (true);

-- =====================================================
-- تنفيذ اختباري
-- =====================================================
-- عرض الإعدادات الحالية
SELECT * FROM climate_settings WHERE setting_key = 'default';

COMMENT ON TABLE climate_settings IS 'جدول إعدادات التحكم بالمناخ - يحفظ إعدادات الوضع الآلي بشكل دائم';


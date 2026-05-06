-- ============================================================
-- 08_cleanup_triggers.sql
-- محفزات تنظيف البيانات القديمة - EcoControl
-- ============================================================
-- يحافظ على آخر N قراءة فقط لكل جهاز/وحدة
-- ============================================================

-- عدد القراءات المحفوظة لكل جهاز
-- يمكن تغييرها حسب الحاجة
DO $$ 
BEGIN
    -- إنشاء متغير للإعدادات إذا لم يكن موجوداً
    PERFORM set_config('app.max_climate_readings', '10', false);
    PERFORM set_config('app.max_irrigation_readings', '10', false);
END $$;

-- ============================================================
-- دالة حذف قراءات المناخ القديمة
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_climate_readings()
RETURNS TRIGGER AS $$
DECLARE
    max_readings INTEGER := 10;  -- عدد القراءات المحفوظة لكل جهاز
    readings_count INTEGER;
BEGIN
    -- حساب عدد القراءات لهذا الجهاز
    SELECT COUNT(*) INTO readings_count
    FROM climate_readings
    WHERE device_id = NEW.device_id;
    
    -- إذا تجاوز العدد الحد المسموح، حذف الأقدم
    IF readings_count > max_readings THEN
        DELETE FROM climate_readings
        WHERE id IN (
            SELECT id FROM climate_readings
            WHERE device_id = NEW.device_id
            ORDER BY recorded_at ASC
            LIMIT (readings_count - max_readings)
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء المحفز
DROP TRIGGER IF EXISTS trg_cleanup_climate_readings ON climate_readings;
CREATE TRIGGER trg_cleanup_climate_readings
    AFTER INSERT ON climate_readings
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_old_climate_readings();

-- ============================================================
-- دالة حذف قراءات الري القديمة
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_irrigation_readings()
RETURNS TRIGGER AS $$
DECLARE
    max_readings INTEGER := 10;  -- عدد القراءات المحفوظة لكل وحدة
    readings_count INTEGER;
BEGIN
    -- حساب عدد القراءات لهذه الوحدة
    SELECT COUNT(*) INTO readings_count
    FROM irrigation_readings
    WHERE unit_id = NEW.unit_id;
    
    -- إذا تجاوز العدد الحد المسموح، حذف الأقدم
    IF readings_count > max_readings THEN
        DELETE FROM irrigation_readings
        WHERE id IN (
            SELECT id FROM irrigation_readings
            WHERE unit_id = NEW.unit_id
            ORDER BY recorded_at ASC
            LIMIT (readings_count - max_readings)
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء المحفز
DROP TRIGGER IF EXISTS trg_cleanup_irrigation_readings ON irrigation_readings;
CREATE TRIGGER trg_cleanup_irrigation_readings
    AFTER INSERT ON irrigation_readings
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_old_irrigation_readings();

-- ============================================================
-- دالة يدوية لتنظيف جميع القراءات القديمة (اختياري)
-- يمكن تشغيلها يدوياً أو عبر Cron
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_all_old_readings(max_per_device INTEGER DEFAULT 10)
RETURNS TABLE (
    climate_deleted INTEGER,
    irrigation_deleted INTEGER
) AS $$
DECLARE
    climate_count INTEGER := 0;
    irrigation_count INTEGER := 0;
BEGIN
    -- تنظيف قراءات المناخ
    WITH ranked AS (
        SELECT id, device_id,
               ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY recorded_at DESC) as rn
        FROM climate_readings
    ),
    to_delete AS (
        SELECT id FROM ranked WHERE rn > max_per_device
    )
    DELETE FROM climate_readings WHERE id IN (SELECT id FROM to_delete);
    GET DIAGNOSTICS climate_count = ROW_COUNT;
    
    -- تنظيف قراءات الري
    WITH ranked AS (
        SELECT id, unit_id,
               ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY recorded_at DESC) as rn
        FROM irrigation_readings
    ),
    to_delete AS (
        SELECT id FROM ranked WHERE rn > max_per_device
    )
    DELETE FROM irrigation_readings WHERE id IN (SELECT id FROM to_delete);
    GET DIAGNOSTICS irrigation_count = ROW_COUNT;
    
    RETURN QUERY SELECT climate_count, irrigation_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- مثال على الاستخدام:
-- SELECT * FROM cleanup_all_old_readings(10);
-- ============================================================

-- ============================================================
-- نهاية الملف
-- ============================================================


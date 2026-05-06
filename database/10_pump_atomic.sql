-- =============================================
-- Atomic Pump Reference Counting (10_pump_atomic.sql)
-- - يحل مشكلة TOCTOU في addRequest/removeRequest
-- - يجعل central_pump_state.requesting_units مصدر الحقيقة الوحيد
-- - يضيف pump_seq لمنع تطبيق رسائل خارج الترتيب على وحدة المضخة
-- =============================================

-- 1) إضافة عمود التسلسل (sequence) إن لم يكن موجوداً
ALTER TABLE central_pump_state
  ADD COLUMN IF NOT EXISTS pump_seq BIGINT NOT NULL DEFAULT 0;

-- ضمان وجود الصف الافتراضي
INSERT INTO central_pump_state (id, active, requesting_units, pump_seq)
VALUES (1, FALSE, '{}', 0)
ON CONFLICT (id) DO NOTHING;

-- 2) دالة ذرّية: تعيين/إلغاء طلب وحدة واحدة
--    تستخدم array_append/array_remove داخل UPDATE واحد → atomic على مستوى الصف
--    تُرجع الصف الجديد بالكامل
CREATE OR REPLACE FUNCTION pump_set_request(
  p_unit_id TEXT,
  p_requested BOOLEAN
)
RETURNS TABLE (
  active BOOLEAN,
  requesting_units TEXT[],
  controlled_by TEXT,
  pump_seq BIGINT,
  last_state_change TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- نضمن وجود الصف
  INSERT INTO central_pump_state (id, active, requesting_units, pump_seq)
  VALUES (1, FALSE, '{}', 0)
  ON CONFLICT (id) DO NOTHING;

  -- التحديث الذرّي:
  -- - إن p_requested=TRUE: نُزيل الـunitId أولاً (إن كان موجوداً) ثم نُلحقه → idempotent
  -- - إن p_requested=FALSE: نُزيله فقط
  -- - active = (length > 0)
  -- - controlled_by = أول عنصر أو NULL
  -- - pump_seq يزيد دائماً ليُمكّن firmware من تجاهل الرسائل القديمة
  RETURN QUERY
  UPDATE central_pump_state cps
  SET
    requesting_units = CASE
      WHEN p_requested THEN array_append(array_remove(cps.requesting_units, p_unit_id), p_unit_id)
      ELSE array_remove(cps.requesting_units, p_unit_id)
    END,
    active = CASE
      WHEN p_requested THEN TRUE
      ELSE COALESCE(array_length(array_remove(cps.requesting_units, p_unit_id), 1), 0) > 0
    END,
    controlled_by = CASE
      WHEN p_requested THEN
        COALESCE(
          (array_remove(cps.requesting_units, p_unit_id))[1],
          p_unit_id
        )
      ELSE
        (array_remove(cps.requesting_units, p_unit_id))[1]
    END,
    pump_seq = cps.pump_seq + 1
  WHERE cps.id = 1
  RETURNING
    cps.active,
    cps.requesting_units,
    cps.controlled_by,
    cps.pump_seq,
    cps.last_state_change,
    cps.updated_at;
END;
$$;

-- 3) دالة قراءة سريعة (idempotent — لا تُغيّر الصف)
CREATE OR REPLACE FUNCTION pump_get_state()
RETURNS TABLE (
  active BOOLEAN,
  requesting_units TEXT[],
  controlled_by TEXT,
  pump_seq BIGINT,
  last_state_change TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
  SELECT active, requesting_units, controlled_by, pump_seq, last_state_change, updated_at
  FROM central_pump_state
  WHERE id = 1;
$$;

COMMENT ON FUNCTION pump_set_request(TEXT, BOOLEAN) IS
  'Atomic add/remove of a unit from central_pump_state.requesting_units. Increments pump_seq each call.';
COMMENT ON FUNCTION pump_get_state() IS
  'Read current pump state including pump_seq.';
COMMENT ON COLUMN central_pump_state.pump_seq IS
  'Monotonically increasing counter for ordering pump state messages to ESP32.';

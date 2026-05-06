-- =============================================
-- 11_climate_settings_extra_json.sql
-- إضافة عمود extra_json (JSONB) لجدول climate_settings
-- يستخدم لتخزين حالة الريلايات والعتبات (relay_state, thresholds)
-- =============================================
-- خلفية: الكود في lib/db.js (ClimateSettingsDB.saveRelayState/saveThresholds/getRelayState/getThresholds)
-- يكتب في عمود extra_json عبر upsert. إذا كان العمود غير موجود فإن العمليات
-- تفشل صامتاً ولا يتم حفظ حالة الريلايات أو العتبات في Supabase.
-- =============================================

ALTER TABLE climate_settings
  ADD COLUMN IF NOT EXISTS extra_json JSONB;

COMMENT ON COLUMN climate_settings.extra_json IS
  'JSON payload for non-default keys (relay_state, thresholds). Allows reusing the same table for multiple climate-side persistence needs.';

-- ضمان وجود سجلات الـ relay_state و thresholds (تُملأ عند أول حفظ)
-- لا حاجة لإدراج صفوف افتراضية — upsert في الكود يُنشئها عند الحاجة.

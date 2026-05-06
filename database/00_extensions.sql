-- ============================================================
-- 00_extensions.sql
-- إضافات PostgreSQL المطلوبة لقاعدة بيانات EcoControl
-- ============================================================
-- تنفيذ: قم بتشغيل هذا الملف أولاً قبل باقي الملفات
-- ============================================================

-- تفعيل إضافة UUID لتوليد معرفات فريدة
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- تفعيل إضافة pgcrypto للتشفير (مفيدة لكلمات المرور)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- تفعيل إضافة pg_trgm للبحث النصي المحسن (اختياري)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- دالة مساعدة لتحديث updated_at تلقائياً
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- دالة مساعدة لتوليد معرفات مخصصة (اختياري)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_custom_id(prefix TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN prefix || '_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '_' || SUBSTRING(uuid_generate_v4()::TEXT, 1, 8);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- نهاية الملف
-- ============================================================


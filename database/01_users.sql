-- ============================================================
-- 01_users.sql
-- جداول إدارة المستخدمين - EcoControl
-- ============================================================

-- ============================================================
-- جدول المستخدمين الرئيسي
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- بيانات تسجيل الدخول
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    
    -- البيانات الشخصية
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    avatar_url TEXT,
    
    -- نوع المستخدم: admin, student, staff
    user_type VARCHAR(20) NOT NULL DEFAULT 'student' 
        CHECK (user_type IN ('admin', 'student', 'staff')),
    
    -- الدور: admin, user, viewer
    role VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin', 'user', 'viewer')),
    
    -- بيانات الطالب (اختيارية)
    department VARCHAR(100),          -- القسم
    stage VARCHAR(20),                 -- المرحلة (الأولى، الثانية، الخ)
    section VARCHAR(20),               -- الشعبة
    
    -- حالة الحساب
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    
    -- التواريخ
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول جلسات تسجيل الدخول
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- بيانات الجلسة
    token_hash TEXT NOT NULL,              -- hash للـ JWT token
    device_info TEXT,                       -- معلومات الجهاز
    ip_address INET,                        -- عنوان IP
    user_agent TEXT,                        -- معلومات المتصفح
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- ============================================================
-- جدول إعادة تعيين كلمة المرور
-- ============================================================
CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    token_hash TEXT NOT NULL,
    
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

-- فهرس للبحث السريع
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets(expires_at);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;

-- سياسة: المدير يمكنه رؤية الكل
CREATE POLICY admin_all_users ON users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- سياسة: المستخدم يرى بياناته فقط
CREATE POLICY user_own_data ON users
    FOR SELECT
    USING (id = auth.uid());

-- ============================================================
-- إدراج المدير الافتراضي (اختياري)
-- ============================================================
-- يمكنك تغيير كلمة المرور بعد التثبيت
-- كلمة المرور الافتراضية: Admin@2025
-- INSERT INTO users (username, password_hash, name, user_type, role)
-- VALUES (
--     'admin',
--     crypt('Admin@2025', gen_salt('bf')),
--     'مدير النظام',
--     'admin',
--     'admin'
-- ) ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- نهاية الملف
-- ============================================================


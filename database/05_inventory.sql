-- ============================================================
-- 05_inventory.sql
-- جداول المخزون والأحواض - EcoControl
-- ============================================================

-- ============================================================
-- جدول الأحواض الزراعية (Greenhouse Beds)
-- ============================================================
CREATE TABLE IF NOT EXISTS greenhouse_beds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- معرف الحوض
    bed_number INTEGER UNIQUE NOT NULL,     -- رقم الحوض (1, 2, 3, ...)
    
    -- بيانات الحوض
    name VARCHAR(100) NOT NULL,
    description TEXT,
    location VARCHAR(200),                  -- الموقع داخل الدفيئة
    
    -- الأبعاد (اختياري)
    length_cm INTEGER,                      -- الطول بالسنتيمتر
    width_cm INTEGER,                       -- العرض بالسنتيمتر
    area_sqm DECIMAL(6,2),                  -- المساحة بالمتر المربع
    
    -- ربط بوحدة الري (اختياري)
    irrigation_unit_id VARCHAR(50),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'empty', 'maintenance', 'inactive')),
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_greenhouse_beds_bed_number ON greenhouse_beds(bed_number);
CREATE INDEX IF NOT EXISTS idx_greenhouse_beds_status ON greenhouse_beds(status);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_greenhouse_beds_updated_at ON greenhouse_beds;
CREATE TRIGGER update_greenhouse_beds_updated_at
    BEFORE UPDATE ON greenhouse_beds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول كتالوج النباتات
-- ============================================================
CREATE TABLE IF NOT EXISTS plants_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- بيانات النبات
    name VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),                   -- الاسم بالإنجليزية
    scientific_name VARCHAR(150),           -- الاسم العلمي
    
    -- التصنيف
    category VARCHAR(50) NOT NULL DEFAULT 'خضروات'
        CHECK (category IN ('خضروات', 'فاكهة', 'ورقيات', 'أعشاب', 'زينة', 'أخرى')),
    variety VARCHAR(100),                   -- الصنف
    
    -- معلومات الزراعة
    optimal_temp_min DECIMAL(4,1),          -- الحرارة المثلى (الحد الأدنى)
    optimal_temp_max DECIMAL(4,1),          -- الحرارة المثلى (الحد الأقصى)
    optimal_humidity_min DECIMAL(4,1),      -- الرطوبة المثلى (الحد الأدنى)
    optimal_humidity_max DECIMAL(4,1),      -- الرطوبة المثلى (الحد الأقصى)
    optimal_soil_moisture DECIMAL(4,1),     -- رطوبة التربة المثلى
    
    -- معلومات الري
    water_needs VARCHAR(20) DEFAULT 'medium'
        CHECK (water_needs IN ('low', 'medium', 'high')),
    irrigation_notes TEXT,
    
    -- معلومات إضافية
    growth_period_days INTEGER,             -- فترة النمو بالأيام
    notes TEXT,
    image_url TEXT,
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_plants_catalog_name ON plants_catalog(name);
CREATE INDEX IF NOT EXISTS idx_plants_catalog_category ON plants_catalog(category);
CREATE INDEX IF NOT EXISTS idx_plants_catalog_is_active ON plants_catalog(is_active);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_plants_catalog_updated_at ON plants_catalog;
CREATE TRIGGER update_plants_catalog_updated_at
    BEFORE UPDATE ON plants_catalog
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول النباتات في الأحواض (علاقة Many-to-Many)
-- ============================================================
CREATE TABLE IF NOT EXISTS bed_plants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- العلاقات
    bed_id UUID NOT NULL REFERENCES greenhouse_beds(id) ON DELETE CASCADE,
    plant_id UUID REFERENCES plants_catalog(id) ON DELETE SET NULL,
    
    -- إذا كان النبات غير موجود في الكتالوج
    plant_name VARCHAR(100),                -- اسم النبات (إذا لم يكن من الكتالوج)
    
    -- تفاصيل الزراعة
    variety VARCHAR(100),
    quantity INTEGER DEFAULT 1,             -- عدد النباتات
    planting_date DATE,                     -- تاريخ الزراعة
    expected_harvest_date DATE,             -- تاريخ الحصاد المتوقع
    
    -- ملاحظات
    notes TEXT,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'growing'
        CHECK (status IN ('seedling', 'growing', 'flowering', 'fruiting', 'harvested', 'removed')),
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_bed_plants_bed_id ON bed_plants(bed_id);
CREATE INDEX IF NOT EXISTS idx_bed_plants_plant_id ON bed_plants(plant_id);
CREATE INDEX IF NOT EXISTS idx_bed_plants_status ON bed_plants(status);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_bed_plants_updated_at ON bed_plants;
CREATE TRIGGER update_bed_plants_updated_at
    BEFORE UPDATE ON bed_plants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول مخزون الأسمدة والمغذيات
-- ============================================================
CREATE TABLE IF NOT EXISTS fertilizers_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- بيانات المادة
    name VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    -- التصنيف
    type VARCHAR(30) NOT NULL DEFAULT 'سماد'
        CHECK (type IN ('سماد', 'مغذي', 'مبيد', 'محسن تربة', 'أخرى')),
    
    -- الكمية
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit VARCHAR(20) NOT NULL DEFAULT 'kg', -- kg, L, g, mL
    min_threshold DECIMAL(10,2) DEFAULT 0,  -- الحد الأدنى للتنبيه
    
    -- السعر (اختياري)
    unit_price DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'IQD',
    
    -- معلومات إضافية
    manufacturer VARCHAR(100),              -- الشركة المصنعة
    expiry_date DATE,                       -- تاريخ الصلاحية
    storage_location VARCHAR(100),          -- مكان التخزين
    notes TEXT,
    
    -- الحالة
    is_active BOOLEAN DEFAULT TRUE,
    
    -- التواريخ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_fertilizers_stock_name ON fertilizers_stock(name);
CREATE INDEX IF NOT EXISTS idx_fertilizers_stock_type ON fertilizers_stock(type);
CREATE INDEX IF NOT EXISTS idx_fertilizers_stock_low_stock ON fertilizers_stock(quantity, min_threshold)
    WHERE quantity <= min_threshold;

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_fertilizers_stock_updated_at ON fertilizers_stock;
CREATE TRIGGER update_fertilizers_stock_updated_at
    BEFORE UPDATE ON fertilizers_stock
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- جدول حركة المخزون (Inventory Transactions)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- المادة
    item_id UUID NOT NULL REFERENCES fertilizers_stock(id) ON DELETE CASCADE,
    
    -- نوع العملية
    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('add', 'remove', 'adjust', 'return', 'expired')),
    
    -- الكميات
    quantity_before DECIMAL(10,2),
    quantity_change DECIMAL(10,2) NOT NULL, -- موجب للإضافة، سالب للسحب
    quantity_after DECIMAL(10,2),
    
    -- تفاصيل
    reason TEXT,
    reference_id VARCHAR(100),              -- رقم مرجعي (فاتورة، طلب، الخ)
    
    -- من قام بالعملية
    created_by UUID REFERENCES users(id),
    
    -- التاريخ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item_id ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at ON inventory_transactions(created_at DESC);

-- ============================================================
-- جدول تطبيقات الأسمدة على الأحواض
-- ============================================================
CREATE TABLE IF NOT EXISTS fertilizer_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- العلاقات
    bed_id UUID NOT NULL REFERENCES greenhouse_beds(id) ON DELETE CASCADE,
    fertilizer_id UUID REFERENCES fertilizers_stock(id) ON DELETE SET NULL,
    
    -- تفاصيل التطبيق
    fertilizer_name VARCHAR(100),           -- حفظ الاسم في حالة حذف المادة
    quantity_applied DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20),
    
    -- طريقة التطبيق
    application_method VARCHAR(50),         -- رش، خلط، ري، الخ
    
    -- ملاحظات
    notes TEXT,
    
    -- من قام بالعملية
    applied_by UUID REFERENCES users(id),
    
    -- التاريخ
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_fertilizer_applications_bed_id ON fertilizer_applications(bed_id);
CREATE INDEX IF NOT EXISTS idx_fertilizer_applications_applied_at ON fertilizer_applications(applied_at DESC);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE greenhouse_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE plants_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE bed_plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE fertilizers_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fertilizer_applications ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة للجميع
CREATE POLICY read_beds ON greenhouse_beds
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_plants ON plants_catalog
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_bed_plants ON bed_plants
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_fertilizers ON fertilizers_stock
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- نهاية الملف
-- ============================================================


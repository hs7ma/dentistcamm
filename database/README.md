# 🗄️ قاعدة بيانات EcoControl - Supabase

## 📋 نظرة عامة

هذا المجلد يحتوي على ملفات SQL لإنشاء قاعدة بيانات نظام **EcoControl** لإدارة الدفيئات الزراعية على منصة **Supabase**.

## 📁 هيكل الملفات

```
database/
├── 00_extensions.sql      # إضافات PostgreSQL والدوال المساعدة
├── 01_users.sql           # جداول المستخدمين والمصادقة
├── 02_devices.sql         # جداول الأجهزة (ESP32) ووحدات الري
├── 03_climate.sql         # جداول المناخ والحساسات والريلي
├── 04_irrigation.sql      # جداول نظام الري والجلسات
├── 05_inventory.sql       # جداول المخزون والأحواض والنباتات
├── 06_events_audit.sql    # جداول الأحداث والتدقيق والإشعارات
├── 07_views_functions.sql # Views و Functions للتقارير
└── README.md              # هذا الملف
```

## 🚀 خطوات التثبيت

### 1. إنشاء مشروع Supabase

1. اذهب إلى [supabase.com](https://supabase.com)
2. أنشئ مشروع جديد
3. احفظ بيانات الاتصال:
   - **Project URL**: `https://xxxx.supabase.co`
   - **API Key**: `eyJhbGciOiJIUzI1NiIs...`
   - **Database Password**: كلمة المرور التي اخترتها

### 2. تنفيذ ملفات SQL

**الطريقة الأولى: عبر SQL Editor في Supabase**

1. افتح لوحة تحكم Supabase
2. اذهب إلى **SQL Editor**
3. نفذ الملفات **بالترتيب التالي**:

```
00_extensions.sql  → أولاً
01_users.sql       → ثانياً
02_devices.sql     → ثالثاً
03_climate.sql     → رابعاً
04_irrigation.sql  → خامساً
05_inventory.sql   → سادساً
06_events_audit.sql → سابعاً
07_views_functions.sql → أخيراً
```

**الطريقة الثانية: عبر CLI**

```bash
# تثبيت Supabase CLI
npm install -g supabase

# تسجيل الدخول
supabase login

# ربط المشروع
supabase link --project-ref YOUR_PROJECT_REF

# تنفيذ الملفات
supabase db push
```

## 📊 الجداول الرئيسية

### المستخدمين (`01_users.sql`)
| الجدول | الوصف |
|--------|--------|
| `users` | بيانات المستخدمين (طلاب، منتسبين، مدير) |
| `user_sessions` | جلسات تسجيل الدخول |
| `password_resets` | طلبات إعادة تعيين كلمة المرور |

### الأجهزة (`02_devices.sql`)
| الجدول | الوصف |
|--------|--------|
| `esp32_devices` | أجهزة ESP32 للتحكم بالمناخ |
| `plant_bed_units` | وحدات الأحواض الزراعية |
| `device_connection_logs` | سجل الاتصال/الانقطاع |

### المناخ (`03_climate.sql`)
| الجدول | الوصف |
|--------|--------|
| `climate_readings` | قراءات الحرارة والرطوبة |
| `relay_states` | حالة الريلي الحالية |
| `relay_events` | سجل تشغيل/إيقاف الريلي |
| `automation_thresholds` | عتبات الأتمتة |

### الري (`04_irrigation.sql`)
| الجدول | الوصف |
|--------|--------|
| `irrigation_readings` | قراءات رطوبة التربة والتدفق |
| `irrigation_sessions` | جلسات الري |
| `irrigation_settings` | إعدادات الري |
| `smart_irrigation_rules` | القواعد الذكية |
| `daily_water_consumption` | الاستهلاك اليومي |

### المخزون (`05_inventory.sql`)
| الجدول | الوصف |
|--------|--------|
| `greenhouse_beds` | الأحواض الزراعية |
| `plants_catalog` | كتالوج النباتات |
| `bed_plants` | النباتات في الأحواض |
| `fertilizers_stock` | مخزون الأسمدة |
| `inventory_transactions` | حركة المخزون |

### الأحداث (`06_events_audit.sql`)
| الجدول | الوصف |
|--------|--------|
| `system_events` | أحداث النظام |
| `audit_log` | سجل التدقيق |
| `notifications` | الإشعارات |
| `active_alerts` | التنبيهات النشطة |

## 🔧 الدوال المتاحة (`07_views_functions.sql`)

### Views
- `v_latest_climate_readings` - آخر قراءات المناخ
- `v_latest_irrigation_readings` - آخر قراءات الري
- `v_all_devices_status` - حالة جميع الأجهزة
- `v_daily_irrigation_stats` - إحصائيات الري اليومية
- `v_low_stock_items` - المخزون المنخفض
- `v_beds_with_plants` - الأحواض مع النباتات

### Functions
- `get_climate_averages()` - متوسطات المناخ
- `get_water_consumption()` - استهلاك المياه
- `create_alert()` - إنشاء تنبيه
- `resolve_alert()` - حل تنبيه
- `log_audit()` - تسجيل في سجل التدقيق
- `get_dashboard_summary()` - ملخص لوحة التحكم

## 🔐 الأمان (RLS)

جميع الجداول مفعل فيها **Row Level Security** مع سياسات:
- المدير يمكنه الوصول لكل شيء
- المستخدم يرى بياناته فقط
- القراءة متاحة للمستخدمين المسجلين

## ⚙️ إعداد المشروع

بعد إنشاء قاعدة البيانات، أضف المتغيرات التالية لملف `.env`:

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...
```

## 📝 ملاحظات

- **الترتيب مهم**: نفذ الملفات بالترتيب المذكور
- **النسخ الاحتياطي**: خذ نسخة احتياطية قبل أي تعديل
- **RLS**: تأكد من تفعيل RLS لجميع الجداول
- **Indexes**: الفهارس موجودة لتحسين الأداء

## 🆘 استكشاف الأخطاء

### خطأ: Extension not found
```sql
-- تأكد من تنفيذ ملف 00_extensions.sql أولاً
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### خطأ: Function not found
```sql
-- تأكد من وجود دالة update_updated_at_column
SELECT proname FROM pg_proc WHERE proname = 'update_updated_at_column';
```

---

**تم إنشاؤه لنظام EcoControl** 🌱


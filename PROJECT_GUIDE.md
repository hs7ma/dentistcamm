# دليل مشروع EcoControl GLM5.1

## نظام التحكم الذكي بالدفيئات الزراعية

**الإصدار:** 1.0.0  
**آخر تحديث:** أبريل 2026

---

## جدول المحتويات

1. [نظرة عامة](#1-نظرة-عامة)
2. [البنية المعمارية](#2-البنية-المعمارية)
3. [الميزات الرئيسية](#3-الميزات-الرئيسية)
4. [المكونات المادية (ESP32)](#4-المكونات-المادية-esp32)
5. [هيكل المشروع](#5-هيكل-المشروع)
6. [قاعدة البيانات (Supabase)](#6-قاعدة-البيانات-supabase)
7. [الواجهة البرمجية (API)](#7-الواجهة-البرمجية-api)
8. [التواصل في الوقت الحقيقي (WebSocket)](#8-التواصل-في-الوقت-الحقيقي-websocket)
9. [الأمن والحماية](#9-الأمن-والحماية)
10. [النشر والتشغيل](#10-النشر-والتشغيل)
11. [استكشاف الأخطاء](#11-استكشاف-الأخطاء)

---

## 1. نظرة عامة

**EcoControl** هو نظام متكامل للتحكم الذكي بالدفيئات الزراعية، يجمع بين التحكم التلقائي والتحكم اليدوي عن بُعد عبر واجهة ويب. يتكون النظام من ثلاث طبقات:

- **خادم Node.js** — يعالج المنطق والتواصل وقاعدة البيانات
- **وحدات ESP32** — تقرأ الحساسات وتنفذ الأوامر عبر WebSockets
- **واجهة ويب** — لوحة تحكم تفاعلية بالعربية لإدارة المناخ والري

### ما يميز النظام

| الميزة | الوصف |
|--------|-------|
| **تحكم مزدوج** | أوتوماتيكي (حسب العتبات) أو يدوي عن بُعد أو يدوي فيزيائي (سويتشات) |
| **وضع يدوي فيزيائي** | عند تشغيل أي سويتش فعلي على ESP32، يتحول تلقائياً لوضع MANUAL ويعطل التحكم عن بُعد |
| **ري ذكي** | كمي، زمني، حسب الرطوبة — مع جدولة وإطارات زمنية وكشف تسرب |
| **مضخة مركزية** | نظام عدّ مرجعي (refcount) يمنع إيقاف المضخة ما دام أي حوض يستخدمها |
| **استمرارية البيانات** | يعمل بدون قاعدة بيانات (in-memory) ويتزامن تلقائياً عند الاتصال |
| **حماية ESP32** | Watchdog + debounce + حد أدنى للذاكرة + حماية brownout |

---

## 2. البنية المعمارية

```
┌─────────────────────────────────────────────────────────────┐
│                    المتصفح (Browser)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ climate.html │  │irrigation.html│  │  admin.html       │ │
│  │  Socket.IO ←────→ Socket.IO ←────→  REST API         │ │
│  └──────────────┘  └──────────────┘  └───────────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │    خادم Node.js        │
          │    (Express + WS)       │
          │  ┌─────────────────┐   │
          │  │  Routes Layer    │   │
          │  │ climate.routes   │   │
          │  │ irrigation.routes│   │
          │  │ admin.routes     │   │
          │  │ auth.routes      │   │
          │  └────────┬────────┘   │
          │           │             │
          │  ┌────────▼────────┐   │
          │  │  Services Layer   │   │
          │  │ climate.service  │   │
          │  │ irrigation.svc   │   │
          │  │ pump.service     │   │
          │  │ users.service    │   │
          │  └────────┬────────┘   │
          │           │             │
          │  ┌────────▼────────┐   │
          │  │  Data Layer       │   │
          │  │ Supabase (متصل)   │   │
          │  │ In-Memory (احتياطي)│  │
          │  └─────────────────┘   │
          └───────┬───────┬───────┘
                  │       │
        Native WS │       │ Socket.IO
                  │       │
     ┌────────────▼───┐   │  ┌──────────────┐
     │   ESP32 وحدة   │   └──► واجهة المتصفح │
     │   المناخ        │      └──────────────┘
     │  DHT22 + Relay  │
     │  (climate-ctrl) │
     └─────────────────┘
     ┌─────────────────┐
     │   ESP32 أحواض   │·····► Native WS
     │   (plant-bed-XX) │
     │  Soil+Flow+Valve│
     └─────────────────┘
     ┌─────────────────┐
     │   ESP32 مضخة     │·····► Native WS
     │  (plant-bed-04)  │
     │  Central Pump    │
     └─────────────────┘
```

### تدفق البيانات

1. **ESP32 → السيرفر:** كل 10 ثوانٍ يرسل ESP32 بيانات الحساسات عبر WebSocket
2. **السيرفر → المتصفح:** يبث الحالة عبر Socket.IO لكل المتصلين
3. **المتصفح → السيرفر:** أوامر التحكم عبر REST API
4. **السيرفر → ESP32:** أوامر الريلايات عبر `full_state` message
5. **ESP32 → السيرفر:** حالة السويتشات الفيزيائية (لتعطيل التحكم عن بُعد)

---

## 3. الميزات الرئيسية

### 3.1 وحدة المناخ (Climate Controller)

| الميزة | التفاصيل |
|--------|---------|
| **حساسات** | درجة الحرارة والرطوبة (DHT22) |
| **ريلايات** | مروحة، سخان، مضخة ترطيب، إضاءة، باب تبريد |
| **أوضاع** | AUTO (عتبات تلقائية)، MANUAL (سويتشات فيزيائية)، ONLINE/OFFLINE |
| **نقطة تعيين** | Setpoint: تحديد حرارة ورطوبة مستهدفة مع هامش تحمل |
| **شاشة OLED** | عرض الحرارة والرطوبة ووضع النظام |
| **حماية Brownout** | حد أدنى 500ms بين تبديل الريلايات + تأخير 100ms بين كل ريلي |
| **Watchdog** | إعادة تشغيل تلقائية إذا علق الـ loop لأكثر من 15 ثانية |
| **حماية الذاكرة** | إعادة تشغيل تلقائية إذا نقصت الذاكرة الحرة عن 20KB |
| **فصل آمن** | عند انقطاع الاتصال: جميع الريلايات OFF + تخطي القواعد التلقائية |

### 3.2 وحدة الري (Irrigation)

| الميزة | التفاصيل |
|--------|---------|
| **أنماط الري** | كمي (لتر)، زمني (دقائق)، حسب الرطوبة، يدوي |
| **جدولة** | فوري، كل ساعات، يومي (ساعة:dقيقة) |
| **إطارات زمنية** | تحديد ساعات البدء والانتهاء المسموح بها |
| **حد يومي** | عدد جلسات ري كحد أقصى + استهلاك أقصى باللتر |
| **فترة حد أدنى** | حد أدنى بين جلسات الري (بالدقائق) |
| **كشف التسرب** | تنبيه إذا كان التدفق أعلى من المتوقع |
| **كشف الانسداد** | تنبيه إذا كان التدفق أقل من المتوقع |
| **تخطي الرطوبة** | عدم الري إذا رطوبة التربة أعلى من عتبة معينة |
| **إكمال فوري** | عند انتهاء الري الكمي/الزمني: إعادة الوضع لـ off تلقائياً |

### 3.3 المضخة المركزية (Central Pump)

| الميزة | التفاصيل |
|--------|---------|
| **نظام العدّ المرجعي** | كل وحدة تطلب المضخة → refcount++; تُلغي الطلب → refcount--; المضخة تعمل ما دام refcount > 0 |
| **اتصال ذري** | استخدام Supabase RPC (`pump_get_state`, `pump_set_request`) لضمان الاتساق |
| **إشعار فوري** | إرسال حالة المضخة لجميع الوحدات عبر WebSocket فور التغيير |
| **فصل آمن** | عند فصل وحدة: إلغاء طلب المضخة تلقائياً; المضخة تبقى تعمل للأحواض الأخرى |

### 3.4 الوضع اليدوي الفيزيائي (Physical Manual Mode)

عندما يُشغّل المستخدم أي سويتش فعلي على وحدة المناخ:
- يتحول النظام تلقائياً لوضع **MANUAL**
- يُعطّل التحكم عن بُعد (إرجاع HTTP 409 Conflict)
- شاشة OLED تعرض `>> MANUAL MODE <<`
- عند إطفاء جميع السويتشات → يعود لوضع **ONLINE** ويُزامن مع السيرفر

### 3.5 واجهة المستخدم

| الصفحة | الوظيفة |
|--------|---------|
| `climate.html` | لوحة تحكم المناخ: عتبات، ريلايات، نقطة تعيين، مؤشر الوضع اليدوي |
| `irrigation.html` | لوحة تحكم الري: أنماط، جدولة، إطارات، إكمال فوري، حالة المضخة |
| `admin.html` | إدارة المستخدمين: إنشاء، تعديل، حذف |
| `inventory.html` | المخزون: نباتات، أسمدة |
| `index.html` | الصفحة الرئيسية |
| `login.html` | تسجيل الدخول |

---

## 4. المكونات المادية (ESP32)

### 4.1 وحدة التحكم بالمناخ (Climate Controller)

**الملف:** `firmware/esp32_dht22_relay_controller.ino`

| المكون | GPIO | الوصف |
|--------|------|-------|
| DHT22 | GPIO 4 | حساس حرارة + رطوبة |
| OLED SDA | GPIO 21 | شاشة I2C بيانات |
| OLED SCL | GPIO 22 | شاشة I2C ساعة |
| FAN_RELAY | GPIO 27 | مروحة (Active High) |
| HEATER_RELAY | GPIO 26 | سخان (Active High) |
| PUMP_RELAY | GPIO 33 | مضخة ترطيب (Active High) |
| LIGHT_RELAY | GPIO 25 | إضاءة (Active High) |
| DOOR_RELAY | GPIO 32 | باب تبريد NO=فتح, NC=إغلاق |
| SW_FAN | GPIO 16 | سويتش مروحة (INPUT_PULLUP) |
| SW_HEATER | GPIO 17 | سويتش سخان |
| SW_PUMP | GPIO 18 | سويتش مضخة |
| SW_MOTOR | GPIO 19 | سويتش إضاءة |
| SW_DOOR | GPIO 23 | سويتش باب تبريد |

**الاتصال:** WebSocket آمن (WSS) على المنفذ 443  
**الفاصل الزمني:** إرسال بيانات كل 10 ثوانٍ، heartbeat كل 20 ثانية  
**البروتوكول:** مصادقة بالرمز → إرسال `sensor_data` ← استقبال `full_state`

### 4.2 وحدة الأحواض الزراعية (Plant Bed Unit)

**الملف:** `firmware/esp32_valve_only_unit.ino`

| المكون | GPIO | الوصف |
|--------|------|-------|
| Soil Moisture | GPIO 4 | حساس رطوبة التربة (Analog) |
| Water Flow | GPIO 5 | حساس تدفق الماء (Interrupt) |
| Pump Relay | GPIO 18 | مضخة الماء |
| Valve Open | GPIO 19 | صمام فتح |
| Valve Close | GPIO 21 | صمام إغلاق |
| Flow Relay | GPIO 22 | حساس التدفق (NC) |
| OLED SDA | GPIO 16 | شاشة I2C |
| OLED SCL | GPIO 17 | شاشة I2C |

**أنماط الري المستلمة من السيرفر:**
- `quantitative` — ري كمية محددة (لتر)
- `temporal` — ري لمدة محددة (دقائق)
- `moisture` — ري حسب رطوبة التربة
- `off` — إيقاف

### 4.3 وحدة المضخة المركزية (Central Pump)

**الملف:** `firmware/esp32_central_pump_unit.ino`

تستقبل أوامر `irrigation_state` من السيرفر:
- `centralPumpShouldRun: true/false` — تشغيل/إيقاف المضخة
- عند الاستقبال → تشغيل أو إيقاف المضخة فوراً وإرسال تأكيد

### 4.4 المكتبات المطلوبة (Arduino IDE)

```
WiFi.h (مدمجة)
WebSocketsClient.h (by Markus Sattler)
ArduinoJson.h (v6+)
DHT.h (Adafruit DHT sensor library)
U8g2lib.h (شاشة OLED)
Wire.h (مدمجة)
esp_task_wdt.h (مدمجة - ESP-IDF)
```

---

## 5. هيكل المشروع

```
GLM5.1/
├── .env                    # متغيرات البيئة (غير متابع في git)
├── .env.example            # قالب المتغيرات
├── Dockerfile              # حاوية Docker
├── package.json            # الحزم والسكريبتات
├── server.js               # نقطة الدخول
│
├── src/
│   ├── app.js              # الخادم الرئيسي: Express + HTTP + WS + Socket.IO
│   ├── config/
│   │   └── index.js         # الإعدادات (من .env أو قيم افتراضية)
│   ├── db/
│   │   ├── index.js         # تصدير قواعد البيانات
│   │   ├── supabase.js      # اتصال Supabase + isConfigured/isAvailable
│   │   ├── climate.db.js    # قراءات المناخ + حالات الريلايات
│   │   ├── irrigation.db.js # بيانات الأحواض + جلسات الري
│   │   ├── pump.db.js       # Mضخة مركزية (atomic refcount)
│   │   ├── users.db.js      # إدارة المستخدمين
│   │   └── events.db.js     # سجل الأحداث والتدقيق
│   ├── middleware/
│   │   ├── auth.js           # JWT + مصادقة + rate limiting
│   │   └── errorHandler.js   # معالج أخطاء مركزي
│   ├── routes/
│   │   ├── index.js          # تجميع المسارات
│   │   ├── auth.routes.js    # /api/auth/login
│   │   ├── climate.routes.js # /api/status, /api/sensor, /api/relay, /api/thresholds, /api/setpoint
│   │   ├── irrigation.routes.js # /api/units/:unitId/*, /api/central-pump, /api/irrigation/*
│   │   ├── admin.routes.js   # /api/admin/users/*
│   │   └── greenhouse.routes.js # /api/greenhouse/layout, /api/inventory
│   ├── services/
│   │   ├── climate.service.js # منطق المناخ: عتبات، setpoint، ريلايات، manual mode
│   │   ├── irrigation.service.js # منطق الري: أنماط، جدولة، إكمال فوري
│   │   ├── pump.service.js    # منطق المضخة: refcount، إشعارات WebSocket
│   │   └── users.service.js   # إدارة المستخدمين في الذاكرة + Supabase
│   └── websocket/
│       ├── broadcaster.js      # بث state_update + irrigation_summary
│       ├── esp32.handler.js    # معالج WebSocket للأجهزة ESP32
│       └── ui.handler.js       # معالج Socket.IO لواجهة المتصفح
│
├── public/                    # ملفات الواجهة الثابتة
│   ├── climate.html           # لوحة المناخ
│   ├── irrigation.html        # لوحة الري
│   ├── admin.html             # إدارة المستخدمين
│   ├── inventory.html         # المخزون
│   ├── index.html              # الصفحة الرئيسية
│   ├── login.html              # تسجيل الدخول
│   └── images/                 # أيقونات وصور
│
├── firmware/                   # أكواد ESP32
│   ├── esp32_dht22_relay_controller.ino   # وحدة المناخ
│   ├── esp32_valve_only_unit.ino           # وحدة الأحواض
│   ├── esp32_central_pump_unit.ino         # وحدة المضخة المركزية
│   ├── config_example.h                    # قالب إعدادات WiFi+Server
│   ├── PLANT_BED_UNIT_README.md            # دليل وحدة الأحواض
│   └── CENTRAL_PUMP_SETUP.md              # دليل وحدة المضخة
│
└── database/                   # ملفات SQL لـ Supabase (بالترتيب)
    ├── 00_extensions.sql
    ├── 01_users.sql
    ├── 02_devices.sql
    ├── 03_climate.sql
    ├── 04_irrigation.sql
    ├── 05_climate_settings.sql
    ├── 05_inventory.sql
    ├── 06_events_audit.sql
    ├── 07_views_functions.sql
    ├── 08_cleanup_triggers.sql
    ├── 09_unit_state.sql
    ├── 10_pump_atomic.sql
    └── 11_climate_settings_extra_json.sql
```

---

## 6. قاعدة البيانات (Supabase)

### الوضع التشغيلي

النظام يعمل في وضعين:

| الوضع | الشرط | السلوك |
|-------|--------|--------|
| **متصل** | بيانات Supabase صحيحة + اتصال ناجح | قراءة/كتابة في Supabase + ذاكرة |
| **احتياطي** | بيانات غير مهيأة أو فشل الاتصال | الذاكرة فقط (يعمل بدون قاعدة بيانات) |

عند عودة الاتصال → مزامنة تلقائية للبيانات المتغيرة.

### الجداول الرئيسية

| الجدول | الوصف |
|--------|-------|
| `users` | بيانات المستخدمين |
| `esp32_devices` | أجهزة المناخ المسجلة |
| `plant_bed_units` | وحدات الأحواض الزراعية |
| `climate_readings` | أرشيف قراءات الحرارة والرطوبة |
| `relay_states` | حالة الريلايات الحالية |
| `unit_state` | حالة كل حوض (حساسات + تحكم) |
| `pump_state` | حالة المضخة المركزية (atomic) |
| `irrigation_sessions` | سجل جلسات الري |
| `automation_thresholds` | عتبات الأتمتة |

### الدوال الذرية (RPC)

| الدالة | الوصف |
|--------|-------|
| `pump_get_state()` | قراءة حالة المضخة atomically |
| `pump_set_request(unit_id, requested)` | طلب/إلغاء المضخة atomically |

---

## 7. الواجهة البرمجية (API)

### المصادقة

جميع نقاط النهاية المحمية تتطلب رمز JWT في الرأس:
```
Authorization: Bearer <token>
```

### نقاط النهاية

#### المناخ (Climate)

| الطريقة | المسار | الوصف | مصادقة |
|---------|--------|-------|--------|
| GET | `/api/status` | حالة المناخ الكاملة | لا |
| POST | `/api/sensor` | تحديث بيانات الحساسات (ESP32) | لا |
| PUT | `/api/relay/:id` | تحكم بالريلاي | نعم |
| PUT | `/api/thresholds` | تحديث العتبات | نعم |
| GET | `/api/climate/setpoint` | قراءة نقطة التعيين | نعم |
| PUT | `/api/climate/setpoint` | تحديث نقطة التعيين | نعم |

#### الري (Irrigation)

| الطريقة | المسار | الوصف | مصادقة |
|---------|--------|-------|--------|
| POST | `/api/units/:unitId/sensor` | بيانات حساسات الحوض (ESP32) | لا |
| GET | `/api/units/:unitId` | حالة الحوض | نعم |
| PUT | `/api/units/:unitId/control` | تحكم بالحوض | نعم |
| PUT | `/api/units/:unitId/settings` | تحديث إعدادات الحوض | نعم |
| GET | `/api/irrigation/summary` | ملخص الري والمضخة | نعم |
| GET | `/api/central-pump` | حالة المضخة المركزية | نعم |
| POST | `/api/central-pump/request` | طلب/إلغاء المضخة | نعم |
| GET | `/api/debug/unit/:unitId` | تصحيح حالة الحوض | نعم |

#### الإدارة (Admin)

| الطريقة | المسار | الوصف | مصادقة |
|---------|--------|-------|--------|
| GET | `/api/admin/users` | قائمة المستخدمين | مدير |
| POST | `/api/admin/users` | إنشاء مستخدم | مدير |
| PUT | `/api/admin/users/:id` | تعديل مستخدم | مدير |
| DELETE | `/api/admin/users/:id` | حذف مستخدم | مدير |

#### المصادقة (Auth)

| الطريقة | المسار | الوصف |
|---------|--------|-------|
| POST | `/api/auth/login` | تسجيل الدخول |

#### أخرى

| الطريقة | المسار | الوصف | مصادقة |
|---------|--------|-------|--------|
| GET | `/api/greenhouse/layout` | تخطيط الدفيئة | نعم |
| PUT | `/api/greenhouse/layout` | تحديث التخطيط | نعم |
| GET | `/api/inventory` | المخزون | نعم |
| PUT | `/api/inventory` | تحديث المخزون | نعم |
| GET | `/api/version` | إصدار السيرفر | لا |

---

## 8. التواصل في الوقت الحقيقي (WebSocket)

### Native WebSocket (`ws://` — للأجهزة ESP32)

**المسار:** `/ws`  
**المنفذ:** نفس المنفذ (3000 افتراضياً)  
**الحمولة القصوى:** 2048 bytes  
**Heartbeat:** كل 20 ثانية من ESP32، timeout بعد 90 ثانية صمت

#### مصادقة ESP32

```json
{ "type": "auth", "token": "ESP32_CLIMATE_SECURE_TOKEN_2025", "device": "climate-controller-01" }
```

#### بيانات حساسات المناخ → السيرفر

```json
{
  "type": "sensor_data",
  "temperature": 28.5,
  "humidity": 65.0,
  "sensorOk": true,
  "deviceId": "climate-controller-01",
  "token": "...",
  "switches": { "fan": false, "heater": false, "pump": true, "motor": false, "door": false }
}
```

#### أوامر الريلايات من السيرفر → ESP32

```json
{
  "type": "full_state",
  "relays": {
    "fan": { "mode": "auto", "state": true },
    "heater": { "mode": "auto", "state": false },
    "pump": { "mode": "manual", "state": true },
    "motor": { "mode": "auto", "state": false },
    "door": { "mode": "auto", "state": false }
  }
}
```

#### بيانات أحواض الري → السيرفر

```json
{
  "type": "sensor_data",
  "deviceId": "plant-bed-01",
  "soilMoisture": 45.2,
  "waterFlow": 3.8,
  "irrigationActive": true,
  "currentMode": 2,
  "totalWaterConsumed": 125.5
}
```

#### طلب/إلغاء المضخة من أحواض الري

```json
{ "type": "pump_request", "device": "plant-bed-01", "action": "request" }
{ "type": "pump_request", "device": "plant-bed-01", "action": "release" }
```

#### حالة المضخة من السيرفر → وحدة المضخة

```json
{
  "type": "irrigation_state",
  "data": {
    "centralPumpShouldRun": true,
    "pumpSeq": 5,
    "source": "pump_command",
    "reason": "irrigation_on"
  }
}
```

### Socket.IO (للمتصفح)

**المسار:** الجذر `/`  
**المنفذ:** نفس المنفذ

#### أحداث من السيرفر

| الحدث | الوصف |
|-------|-------|
| `state_update` | حالة المناخ الكاملة (حساسات + ريلايات + عتبات + setpoint + manualMode) |
| `irrigation_summary` | ملخص جميع الأحواض + حالة المضخة |
| `irrigation_unit_:id` | تحديث لحوض محدد |

---

## 9. الأمن والحماية

### مصادقة المستخدمين

| الآلية | التفاصيل |
|--------|---------|
| **JWT** | رمز صالح لمدة قابلة للتكوين (افتراضي: 24 ساعة) |
| **bcrypt** | تجزئة كلمات المرور بـ 10 rounds |
| **Rate Limiting** | 5 محاولات تسجيل لكل IP كل 60 ثانية، مع تنظيف دوري |
| **Helmet** | حماية HTTP headers |

### مصادقة الأجهزة

| الآلية | التفاصيل |
|--------|---------|
| **رمز مميز** | كل ESP32 يرسل `token` عند الاتصال، يُقارن بالقيمة في `.env` |
| **حمولة محدودة** | 2048 bytes كحد أقصى لرسائل WebSocket |

### بيئة الإنتاج

في وضع الإنتاج (`NODE_ENV=production`):

- رمز JWT **مطلوب** — يرفض البدء بدونه
- كلمة مرور المدير **مطلوبة**
- رمز EPS32 **مطلوب**

في وضع التطوير يتم استخدام قيم مؤقتة مع تحذير.

---

## 10. النشر والتشغيل

### 10.1 المتطلبات

- Node.js 18+ 
- قاعدة بيانات Supabase (اختياري — يعمل بدونها)
- ESP32 مع firmware محمّل

### 10.2 التثبيت

```bash
# نسخ المستودع
git clone <repo-url>
cd GLM5.1

# تثبيت الحزم
npm install

# نسخ قالب البيئة
cp .env.example .env

# تعديل المتغيرات
 nano .env
```

### 10.3 متغيرات البيئة (.env)

| المتغير | مطلوب | الوصف | الافتراضي |
|---------|-------|-------|----------|
| `PORT` | لا | منفذ السيرفر | 3000 |
| `NODE_ENV` | لا | بيئة التشغيل | development |
| `JWT_SECRET` | **نعود** في الإنتاج | مفتاح تشفير JWT | — |
| `JWT_EXPIRES_IN` | لا | مدة صلاحية JWT | 24h |
| `ADMIN_USERNAME` | لا | اسم المدير | admin |
| `ADMIN_PASSWORD` | **نعود** في الإنتاج | كلمة مرور المدير | — |
| `SOCKET_SECRET_TOKEN` | **نعود** في الإنتاج | رمز مصادقة ESP32 | — |
| `SUPABASE_URL` | لا | رابط Supabase | — |
| `SUPABASE_ANON_KEY` | لا | مفتاح Supabase العام | — |
| `SUPABASE_SERVICE_KEY` | لا | مفتاح Supabase الخاص | — |
| `CORS_ORIGIN` | لا | أصول مسموحة (مفصولة بـ,) | * في التطوير |
| `USE_PUMP_REFCOUNT` | لا | استخدام نظام العد المرجعي | true |
| `FAN_ON_TEMP` | لا | عتبة تشغيل المروحة (°C) | 30 |
| `FAN_OFF_TEMP` | لا | عتبة إيقاف المروحة (°C) | 28 |
| `HEATER_ON_TEMP` | لا | عتبة تشغيل السخان (°C) | 20 |
| `HEATER_OFF_TEMP` | لا | عتبة إيقاف السخان (°C) | 22 |
| `PUMP_ON_HUMIDITY` | لا | عتبة تشغيل المضخة (%) | 40 |
| `PUMP_OFF_HUMIDITY` | لا | عتبة إيقاف المضخة (%) | 55 |
| `MOTOR_OPEN_TEMP` | لا | عتبة فتح الباب (°C) | 32 |
| `MOTOR_CLOSE_TEMP` | لا | عتبة إغلاق الباب (°C) | 30 |

### 10.4 تشغيل السيرفر

```bash
# تطوير
npm run dev

# إنتاج
npm start
```

### 10.5 Docker

```bash
# بناء
docker build -t ecocontrol .

# تشغيل
docker run -p 3000:3000 --env-file .env ecocontrol
```

### 10.6 رفع Firmware لـ ESP32

1. افتح Arduino IDE
2. اختر Board: ESP32 Dev Module
3. عدّل الإعدادات في بداية الملف:
   - `WIFI_SSID` و `WIFI_PASSWORD`
   - `WS_HOST` و `WS_PORT` (رابط السيرفر)
   - `DEVICE_ID` (معرّف فريد لكل وحدة)
4. ارفع الكود

**تكوين كل وحدة:**

| الوحدة | الملف | DEVICE_ID |
|--------|-------|-----------|
| المناخ | `esp32_dht22_relay_controller.ino` | `climate-controller-01` |
| حوض 1-3 | `esp32_valve_only_unit.ino` | `plant-bed-01` إلى `plant-bed-03` |
| المضخة المركزية | `esp32_central_pump_unit.ino` | `plant-bed-04` |

---

## 11. استكشاف الأخطاء

###常见 المشاكل وحلولها

| المشكلة | السبب | الحل |
|---------|------|------|
| السيرفر يرفض البدء بـ `JWT_SECRET must be set` | `NODE_ENV=production` بدون متغيرات البيئة | أضف `JWT_SECRET`, `ADMIN_PASSWORD`, `SOCKET_SECRET_TOKEN` إلى `.env` |
| ESP32 لا يتصل | WiFi أو رابط خاطئ | تحقق من `WIFI_SSID`, `WIFI_PASSWORD`, `WS_HOST`, `WS_PORT` |
| `Supabase: Connection failed` | بيانات اتصال خاطئة أو Supabase متوقف | تحقق من `SUPABASE_URL` و `SUPABASE_SERVICE_KEY` في `.env` |
| الري لا يتوقف تلقائياً | `currentMode` لا يُرسل كرقم `0` | تأكد أن ESP32 يرسل `"currentMode": 0` (رقم وليس نص) |
| لوحة التحكم لا تتحدث | Socket.IO غير متصل | تحقق من CORS_ORIGIN في `.env` |
| ESP32 يعيد التشغيل باستمرار | brownout من تبديل ريلايات سريع | تم إصلاحه: حد أدنى 500ms بين التبديلات + تأخير 100ms بين كل ريلي |
| المضخة لا تعمل | وحدة المضخة غير متصلة | تأكد من تشغيل `plant-bed-04` واتصالها بـ `/ws` |
| الري يبدأ تلقائياً عند تحميل الصفحة | قيمة `0` تُعامل كـ falsy | تم إصلاحه: استخدام `!== undefined` بدلاً من `||` |

### سجلات التشخيص

```bash
# مراقبة سجلات السيرفر
npm start 2>&1 | tee server.log

# فحص اتصال Supabase
curl http://localhost:3000/api/status | jq '.database'

# فحص حالة وحدة
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/debug/unit/plant-bed-01

# فحص حالة المضخة المركزية
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/central-pump
```

---

**تم إنشاؤه لنظام EcoControl** 🌱
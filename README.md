# DentistCam — نظام تصوير الأسنان مع تحليل ذكي

نظام يلتقط بثاً مباشراً من ESP32-CAM ويحلّله طبياً عبر OpenAI Vision (GPT-4o-mini).

> **يعمل عبر iPhone Personal Hotspot فقط.**

---

## النقل لحاسوب آخر — 3 خطوات

### الخطوة 1: انسخ المجلد كاملاً
انسخ مجلد `dentistCam` إلى الحاسوب الجديد (USB / OneDrive / GitHub...).

> ✅ المفتاح موجود مسبقاً في `frontend/.env` — لا يحتاج إعدادات إضافية.

### الخطوة 2: ثبّت Node.js
حمّل من [nodejs.org](https://nodejs.org/) (الإصدار 18 أو أحدث).
بعد التنصيب أعد تشغيل الحاسوب أو افتح PowerShell جديد.

### الخطوة 3: شغّل التطبيق

#### الويندوز
دبل-كليك على [run.bat](run.bat) — سيقوم تلقائياً بـ:
- تنصيب الحزم (~25 ثانية في أول مرة)
- إنشاء `.env` إذا لم يوجد
- تشغيل الواجهة

#### لينكس / macOS
```bash
chmod +x run.sh
./run.sh
```

ستفتح الواجهة على: **http://localhost:5173**

---

## ESP32-CAM (مرة واحدة فقط)

ESP32 لا يحتاج إعادة برمجة عند نقل الواجهة لحاسوب آخر — الكود محفوظ على الشريحة.

إذا أردت رفع الكود لأول مرة:

1. افتح Arduino IDE → ثبّت **ESP32 core by Espressif** (3.x)
2. افتح [esp32/esp32_dental_cam/esp32_dental_cam.ino](esp32/esp32_dental_cam/esp32_dental_cam.ino)
3. عدّل بيانات WiFi في أعلى الملف `.ino`:
   ```cpp
   const char* WIFI_SSID     = "iPhone";
   const char* WIFI_PASSWORD = "كلمة_السر";
   ```
4. اللوحة: **AI Thinker ESP32-CAM** → Upload (مع GPIO0 → GND)
5. افصل GPIO0 → اضغط RESET → افتح Serial Monitor (115200)

ستظهر دائماً نفس الرسالة (IP ثابت):
```
[WiFi] Connected — IP: 172.20.10.10 | GW: 172.20.10.1
  Stream:  http://172.20.10.10:81/stream
  Capture: http://172.20.10.10/capture
```

---

## ترتيب التشغيل اليومي

```
1. iPhone: شغّل Personal Hotspot
   (تأكد من Maximize Compatibility = ON)

2. الحاسوب: اتصل بـ Hotspot

3. ESP32: وصّل الكهرباء (سيتصل تلقائياً بـ 172.20.10.10)

4. الحاسوب: دبل-كليك على run.bat
   → افتح http://localhost:5173

5. الواجهة: ستجد IP الكاميرا 172.20.10.10 محفوظ مسبقاً ✓
```

---

## كيف يعمل التحليل بالذكاء الاصطناعي

```
الكاميرا (ESP32) → الواجهة → OpenAI API (gpt-4o-mini Vision)
   محلي               محلي        انترنت (4G من iPhone)
```

اضغط زر **"تحليل بالذكاء"** على الواجهة:
- تُلتقط صورة من ESP32 (`/capture`)
- تُحوّل إلى base64
- تُرسل لـ OpenAI Vision مع تعليمات طبية بالعربية
- يظهر التقرير (نخر، التهاب، توصيات، أولوية)

**المتطلبات:**
- ✅ مفتاح OpenAI صالح (موجود في `frontend/.env`)
- ✅ رصيد في حساب OpenAI ([تحقّق هنا](https://platform.openai.com/usage))
- ✅ اتصال انترنت (4G من iPhone أو شبكة أخرى)

---

## استكشاف الأخطاء

### الواجهة لا تتصل بالكاميرا
| السبب | الحل |
|---|---|
| الحاسوب ليس على Hotspot | افتح cmd → `ipconfig` → ابحث عن `172.20.10.x` |
| iPhone أغلق Hotspot | افتح iPhone → اعرض شاشة Hotspot |
| ESP32 لم يتصل | افحص Serial Monitor، تأكد من Maximize Compatibility |
| IP مختلف في الإعدادات | اضغط ⚙️ → غيّر إلى `172.20.10.10` |

### فشل التحليل بالذكاء
الواجهة تعرض رسائل واضحة تلقائياً:

| الرسالة | المعنى |
|---|---|
| "تعذر الاتصال بـ OpenAI" | لا انترنت — تحقّق من Hotspot |
| "مفتاح OpenAI غير صالح" | المفتاح خاطئ في `frontend/.env` |
| "تجاوزت الحد المسموح أو لا يوجد رصيد" | اشحن حسابك على OpenAI |
| "الصورة غير صالحة" | التقط صورة أخرى |

### npm install يفشل
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### اختبار سريع لمفتاح OpenAI من PowerShell
```powershell
curl https://api.openai.com/v1/models -H "Authorization: Bearer YOUR_KEY"
```
إذا رأيت قائمة موديلات → المفتاح يعمل.

---

## هيكل المشروع

```
dentistCam/
├── README.md                  ← هذا الملف
├── run.bat                    ← تشغيل سريع (Windows)
├── run.sh                     ← تشغيل سريع (Linux/macOS)
├── setup.bat / setup.sh       ← تنصيب أولي (اختياري)
├── .gitignore
│
├── frontend/                  ← React + Vite + Tailwind
│   ├── .env                   ← مفتاح OpenAI + IP الكاميرا
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── components/        ← LiveStream, AIReport, ...
│       └── hooks/             ← useCameraStream, useAnalysis, ...
│
└── esp32/
    └── esp32_dental_cam/
        └── esp32_dental_cam.ino   ← الفيرموير (بيانات WiFi في الأعلى)
```

---

## نقاط فنية

| المكوّن | التفاصيل |
|---|---|
| IP ESP32 | `172.20.10.10` ثابت (يُضبط قبل WiFi.begin، لا DHCP) |
| Gateway | `172.20.10.1` |
| Subnet | `255.255.255.240` (/28 — iPhone Hotspot) |
| البث | MJPEG على `/stream` (منفذ 81) |
| الالتقاط | JPEG على `/capture` (منفذ 80) |
| التحليل | OpenAI `gpt-4o-mini` + `detail: low` |
| التكلفة التقريبية | ~$0.0001 لكل صورة |

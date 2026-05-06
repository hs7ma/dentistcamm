# 🌱 دليل الاتصال - وحدة الأحواض الزراعية

## 📡 إعداد الاتصال بالخادم

### 1️⃣ تحديد عنوان IP للحاسوب

#### على Windows:
```bash
ipconfig
```
ابحث عن `IPv4 Address` تحت `Wireless LAN adapter Wi-Fi` أو `Ethernet adapter`

مثال: `192.168.1.100`

#### على Mac/Linux:
```bash
ifconfig
```
أو
```bash
ip addr show
```

---

### 2️⃣ تحديث إعدادات ESP32

افتح ملف `esp32_plant_bed_unit.ino` وعدّل الأسطر التالية:

#### إعدادات Wi-Fi (السطر 34-35):
```cpp
constexpr char WIFI_SSID[] = "YOUR_WIFI_NAME";      // اسم شبكة الواي فاي
constexpr char WIFI_PASSWORD[] = "YOUR_PASSWORD";   // كلمة المرور
```

#### عنوان الخادم (السطر 42):
```cpp
constexpr char API_BASE_URL[] = "http://192.168.1.100:3000";
```
⚠️ **مهم**: استبدل `192.168.1.100` بعنوان IP الفعلي لحاسوبك!

#### معرف الوحدة (السطر 45):
```cpp
constexpr char UNIT_ID[] = "plant-bed-01";  // غيّره لكل وحدة (plant-bed-02, plant-bed-03, ...)
```

---

### 3️⃣ التحقق من تشغيل الخادم

تأكد من أن الخادم يعمل على الحاسوب:

```bash
npm start
```

يجب أن ترى رسالة مثل:
```
Server is running on:
  Local:   http://localhost:3000
  Network: http://192.168.1.100:3000
```

---

### 4️⃣ رفع الكود على ESP32

1. افتح Arduino IDE
2. اختر اللوحة: `ESP32 Dev Module`
3. اختر المنفذ الصحيح (COM Port)
4. اضغط على زر الرفع (Upload)

---

### 5️⃣ مراقبة الاتصال

افتح Serial Monitor (Ctrl+Shift+M) بسرعة `115200 baud`

#### رسائل النجاح:
```
[WiFi] Connecting to "YOUR_WIFI_NAME"...
[WiFi] ✓ Connected Successfully!
[WiFi] IP Address: 192.168.1.XXX
[WiFi] Signal Strength: -45 dBm
[WiFi] Gateway: 192.168.1.1
[API] Server URL: http://192.168.1.100:3000
[API] Unit ID: plant-bed-01
========================================
✓ SETUP COMPLETE - SYSTEM READY
========================================

[API] POST http://192.168.1.100:3000/api/units/plant-bed-01/sensor
[API] Payload: {"soilMoisture":45.2,"waterFlow":0.0,"totalWaterConsumed":0.0,"deviceId":"plant-bed-01","irrigationActive":false,"currentMode":0}
[API] ✓ Data sent successfully
```

---

## 🔧 حل المشاكل الشائعة

### ❌ المشكلة: ESP32 لا يتصل بالـ Wi-Fi
**الحل:**
- تأكد من صحة اسم الشبكة وكلمة المرور
- تأكد من أن الشبكة 2.4GHz (ESP32 لا يدعم 5GHz)
- جرب إعادة تشغيل الراوتر

### ❌ المشكلة: ESP32 متصل بالـ Wi-Fi لكن لا يرسل البيانات
**الحل:**
- تأكد من أن عنوان IP صحيح
- تأكد من أن الخادم يعمل (`npm start`)
- تأكد من أن ESP32 والحاسوب على نفس الشبكة
- أوقف Firewall مؤقتاً للاختبار

### ❌ المشكلة: `POST failed with status code: -1`
**الحل:**
- هذا يعني أن ESP32 لا يستطيع الوصول للخادم
- تحقق من عنوان IP مرة أخرى
- جرب استخدام `ping` من Terminal:
  ```bash
  ping 192.168.1.100
  ```

### ❌ المشكلة: `POST failed with status code: 404`
**الحل:**
- الخادم يعمل لكن الـ API endpoint غير صحيح
- تأكد من أن الخادم محدث وبه جميع API endpoints

---

## 📊 API Endpoints

### إرسال بيانات الحساسات (POST):
```
POST http://192.168.1.100:3000/api/units/{UNIT_ID}/sensor

Body:
{
  "soilMoisture": 45.2,
  "waterFlow": 1.5,
  "totalWaterConsumed": 12.3,
  "deviceId": "plant-bed-01",
  "irrigationActive": true,
  "currentMode": 1
}
```

### استقبال أوامر التحكم (GET):
```
GET http://192.168.1.100:3000/api/units/{UNIT_ID}/control

Response:
{
  "irrigationMode": "quantitative",
  "quantitativeValue": 5.0,
  "temporalValue": 600,
  "moistureThreshold": 40,
  "moistureIrrigationType": "quantitative",
  "moistureIrrigationValue": 3.0,
  "manualPump": false,
  "manualValve": false
}
```

---

## 🎯 نصائح مهمة

1. ✅ **تأكد من الشبكة الواحدة**: ESP32 والحاسوب يجب أن يكونا على نفس شبكة Wi-Fi
2. ✅ **استخدم IP ثابت**: يمكنك تعيين IP ثابت للحاسوب من إعدادات الراوتر
3. ✅ **راقب Serial Monitor**: دائماً راقب الرسائل لمعرفة حالة الاتصال
4. ✅ **اختبر الاتصال أولاً**: قبل توصيل الحساسات والريلايهات، تأكد من نجاح الاتصال
5. ✅ **معرف فريد لكل وحدة**: غيّر `UNIT_ID` لكل ESP32 (plant-bed-01, plant-bed-02, ...)

---

## 📱 الوصول من الواجهة

بعد نجاح الاتصال، يمكنك التحكم بالوحدة من:

```
http://192.168.1.100:3000/irrigation.html
```

اختر الوحدة من القائمة المنسدلة في الأعلى.

---

## 🆘 الدعم

إذا واجهت أي مشكلة:
1. تحقق من رسائل Serial Monitor
2. تحقق من رسائل الخادم في Terminal
3. تأكد من تطابق الإعدادات

---

**تم إعداد هذا الدليل لمساعدتك في إعداد وحدة الأحواض الزراعية بنجاح! 🌱**


/*
 * ملف التكوين المثالي - نسخة سريعة
 * انسخ هذه الإعدادات إلى esp32_plant_bed_unit.ino
 */

// ========== إعدادات Wi-Fi ==========
constexpr char WIFI_SSID[] = "YOUR_WIFI_NAME";        // ضع اسم شبكتك هنا
constexpr char WIFI_PASSWORD[] = "YOUR_PASSWORD";     // ضع كلمة المرور هنا

// ========== إعدادات الخادم ==========
// احصل على IP من: ipconfig (Windows) أو ifconfig (Mac/Linux)
constexpr char API_BASE_URL[] = "http://192.168.1.100:3000";  // ضع IP حاسوبك هنا

// ========== معرف الوحدة ==========
// غيّر هذا لكل ESP32 (مثال: plant-bed-01, plant-bed-02, plant-bed-03)
constexpr char UNIT_ID[] = "plant-bed-01";

// ========== أمثلة لوحدات متعددة ==========
/*
الوحدة 1:
constexpr char UNIT_ID[] = "plant-bed-01";

الوحدة 2:
constexpr char UNIT_ID[] = "plant-bed-02";

الوحدة 3:
constexpr char UNIT_ID[] = "plant-bed-03";
*/

// ========== ملاحظات مهمة ==========
/*
✓ تأكد من أن ESP32 والحاسوب على نفس شبكة Wi-Fi
✓ الشبكة يجب أن تكون 2.4GHz (ESP32 لا يدعم 5GHz)
✓ شغّل الخادم قبل تشغيل ESP32: npm start
✓ راقب Serial Monitor للتأكد من نجاح الاتصال
✓ افتح Firewall إذا لم يعمل الاتصال
*/


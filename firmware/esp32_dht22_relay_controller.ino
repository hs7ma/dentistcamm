/*
 * ESP32 DHT22 + Relay Controller - وحدة التحكم بالمناخ
 *
 * هذه الوحدة تتحكم بـ:
 * 1. قراءة الحرارة والرطوبة (DHT22)
 * 2. أربعة ريلايات: مروحة، سخان، مضخة ترطيب، إضاءة
 * 3. عرض القراءات على شاشة OLED
 *
 * أوضاع النظام:
 * - MANUAL:  أي سويتش مشغّل → كل الريلايات تتبع سويتشاتها فقط
 * - ONLINE:  كل السويتشات OFF + WiFi + سيرفر → الريلايات تتبع أوامر السيرفر
 * - OFFLINE: كل السويتشات OFF + (لا WiFi أو لا سيرفر) → كل الريلايات OFF
 *
 * المكتبات المطلوبة:
 * - WiFi.h, HTTPClient.h, ArduinoJson.h
 * - DHT.h (Adafruit DHT sensor library)
 * - U8g2lib.h (للشاشة OLED)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h> // يجب تثبيتها عبر مدير المكتبات (by Markus Sattler)
#include <ArduinoJson.h>
#include <DHT.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <esp_task_wdt.h> // Hardware Watchdog Timer


// ==================== إعدادات المستخدم ====================

// Wi-Fi
constexpr char WIFI_SSID[]     = "MSR3";
constexpr char WIFI_PASSWORD[] = "60006000";

// API & WebSockets
constexpr char WS_HOST[] = "ntu-app.up.railway.app";
constexpr uint16_t WS_PORT = 443;
constexpr char WS_URL[] = "/ws";
constexpr char DEVICE_ID[] = "climate-controller-01";
constexpr char WS_TOKEN[] = "ESP32_CLIMATE_SECURE_TOKEN_2025";


// GPIO - ريلايات
constexpr gpio_num_t FAN_RELAY_PIN    = GPIO_NUM_27;
constexpr gpio_num_t HEATER_RELAY_PIN = GPIO_NUM_26;
constexpr gpio_num_t PUMP_RELAY_PIN   = GPIO_NUM_33;
constexpr gpio_num_t LIGHT_RELAY_PIN  = GPIO_NUM_25;  // ريلي الإضاءة
constexpr gpio_num_t DOOR_RELAY_PIN   = GPIO_NUM_32;  // ريلي باب التبريد (NO=فتح, NC=إغلاق)

// GPIO - سويتشات (INPUT_PULLUP: LOW = مشغّل)
constexpr gpio_num_t SW_FAN_PIN    = GPIO_NUM_16;
constexpr gpio_num_t SW_HEATER_PIN = GPIO_NUM_17;
constexpr gpio_num_t SW_PUMP_PIN   = GPIO_NUM_18;
constexpr gpio_num_t SW_MOTOR_PIN  = GPIO_NUM_19;
constexpr gpio_num_t SW_DOOR_PIN   = GPIO_NUM_23;  // سويتش باب التبريد

// GPIO - حساس + شاشة
constexpr gpio_num_t DHT_PIN  = GPIO_NUM_4;
constexpr gpio_num_t OLED_SDA = GPIO_NUM_21;
constexpr gpio_num_t OLED_SCL = GPIO_NUM_22;

// التوقيتات والاستقرار
constexpr unsigned long SENSOR_POST_INTERVAL   = 10000UL;  
constexpr unsigned long DHT_READ_INTERVAL      = 2000UL;
constexpr unsigned long DISPLAY_UPDATE_INTERVAL = 1000UL;
constexpr unsigned long SWITCH_DEBOUNCE_MS     = 200UL;
constexpr unsigned long BOOT_SETTLE_MS         = 500UL;
constexpr uint8_t      WIFI_BOOT_ATTEMPTS      = 20;  
constexpr unsigned long RELAY_MIN_TOGGLE_MS    = 500UL;   // حد أدنى 500ms بين تبديلات نفس الريلاي
constexpr unsigned long FULL_STATE_MIN_INTERVAL = 500UL;   // حد أدنى 500ms بين رسائل full_state

// WebSockets & Reconnect Backoff
constexpr unsigned long WS_HEARTBEAT_INTERVAL  = 20000UL; // 20 ثانية لتفادي Timeout
constexpr unsigned long CONNECTION_DEAD_TIMEOUT = 90000UL; // 90 ثانية صمت = انقطاع الاتصال
constexpr unsigned long OFFLINE_SAFE_TIMEOUT_MS = 300000UL; // 5 دقائق في OFFLINE → إطفاء آمن
unsigned long wifiBackoffDelay = 1000UL;
unsigned long wsBackoffDelay   = 1000UL;
constexpr unsigned long MAX_BACKOFF_DELAY = 30000UL; // أقصى حد للانتظار 30 ثانية
#define WDT_TIMEOUT 15 // 15 seconds Watchdog
constexpr uint32_t MIN_FREE_HEAP = 20000; // حد أدنى للذاكرة (20KB)


// ==================== أوضاع النظام ====================

enum SystemMode { MODE_MANUAL, MODE_ONLINE, MODE_OFFLINE };

SystemMode currentMode = MODE_OFFLINE;

// ==================== هيكل الريلي ====================

struct RelayChannel {
  const char* id;
  gpio_num_t  relayPin;
  gpio_num_t  switchPin;
  bool        relayState;
  bool        switchOn;
  bool        lastRawReading;
  unsigned long debounceStart;
  bool        activeHigh;  // true = تشغيل بـ HIGH، false = تشغيل بـ LOW
  unsigned long lastToggleMs; // حماية من التبديل السريع
};

RelayChannel channels[] = {
  { "fan",    FAN_RELAY_PIN,    SW_FAN_PIN,    false, false, false, 0, true,  0 },
  { "heater", HEATER_RELAY_PIN, SW_HEATER_PIN, false, false, false, 0, true,  0 },
  { "pump",   PUMP_RELAY_PIN,   SW_PUMP_PIN,   false, false, false, 0, true,  0 },
  { "motor",  LIGHT_RELAY_PIN,  SW_MOTOR_PIN,  false, false, false, 0, true,  0 },
  { "door",   DOOR_RELAY_PIN,   SW_DOOR_PIN,   false, false, false, 0, true,  0 }, // Active High
};
constexpr uint8_t CH_COUNT = sizeof(channels) / sizeof(channels[0]);

// ==================== المتغيرات العامة ====================

DHT dht(DHT_PIN, DHT22);
float temperature = NAN;
float humidity    = NAN;

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

WebSocketsClient webSocket;

bool serverConnected = false;
unsigned long lastSensorPost    = 0;
unsigned long lastDHTRead       = 0;
unsigned long lastDisplayUpdate = 0;
unsigned long lastWiFiRetry     = 0;
unsigned long lastWSHeartbeat   = 0;
unsigned long lastMessageReceived = 0;
unsigned long lastWSRetry       = 0;
unsigned long lastFullStateTime = 0;
unsigned long offlineStartMs    = 0;  // وقت الدخول إلى OFFLINE (0 = لسنا في OFFLINE)



// ==================== الدوال ====================

const char* modeToString(SystemMode m) {
  switch (m) {
    case MODE_MANUAL:  return "MANUAL";
    case MODE_ONLINE:  return "ONLINE";
    case MODE_OFFLINE: return "OFFLINE";
  }
  return "UNKNOWN";
}

// ==================== تشغيل الريلايات ====================

void driveRelay(RelayChannel& ch, bool on) {
  if (ch.relayState == on) return;
  unsigned long now = millis();
  if (on && (now - ch.lastToggleMs) < RELAY_MIN_TOGGLE_MS) return;
  if (!on && (now - ch.lastToggleMs) < RELAY_MIN_TOGGLE_MS) return;
  ch.lastToggleMs = now;
  ch.relayState = on;
  digitalWrite(ch.relayPin, ch.activeHigh ? on : !on);
  Serial.printf("[%s] %s -> %s\n", modeToString(currentMode), ch.id, on ? "ON" : "OFF");
}

void initRelays() {
  for (auto& ch : channels) {
    pinMode(ch.relayPin, OUTPUT);
    digitalWrite(ch.relayPin, ch.activeHigh ? LOW : HIGH); // إيقاف آمن حسب نوع كل ريلي
    ch.relayState = false;
  }
}

// ==================== السويتشات (debounce) ====================

void initSwitches() {
  for (auto& ch : channels) {
    pinMode(ch.switchPin, INPUT_PULLUP);
  }

  // انتظار استقرار الأطراف بعد التهيئة
  delay(BOOT_SETTLE_MS);

  // قراءة أولية لتثبيت الحالة الابتدائية الحقيقية
  for (auto& ch : channels) {
    bool raw = (digitalRead(ch.switchPin) == LOW);
    ch.switchOn       = raw;
    ch.lastRawReading = raw;
    ch.debounceStart  = millis();
    if (raw) {
      Serial.printf("[BOOT] Switch %s is ON (GPIO %d)\n", ch.id, ch.switchPin);
    }
  }
}

void updateSwitches() {
  unsigned long now = millis();
  for (auto& ch : channels) {
    bool raw = (digitalRead(ch.switchPin) == LOW);

    if (raw != ch.lastRawReading) {
      // القراءة تغيرت → إعادة بدء مؤقت الثبات
      ch.lastRawReading = raw;
      ch.debounceStart  = now;
    } else if (raw != ch.switchOn && (now - ch.debounceStart >= SWITCH_DEBOUNCE_MS)) {
      // القراءة ثابتة ومختلفة عن الحالة المعتمدة → تحديث
      ch.switchOn = raw;
      Serial.printf("[SWITCH] %s = %s (GPIO %d)\n", ch.id, raw ? "ON" : "OFF", ch.switchPin);
    }
  }
}

bool anySwitchOn() {
  for (const auto& ch : channels) {
    if (ch.switchOn) return true;
  }
  return false;
}

// ==================== تحديد وضع النظام ====================

SystemMode determineMode() {
  if (anySwitchOn()) return MODE_MANUAL;
  if (WiFi.status() == WL_CONNECTED && serverConnected) return MODE_ONLINE;
  return MODE_OFFLINE;
}


// ==================== تطبيق الأوضاع على الريلايات ====================

void applyMode(SystemMode mode) {
  switch (mode) {

    case MODE_MANUAL:
      // كل ريلي يتبع سويتشه مباشرة
      for (auto& ch : channels) {
        driveRelay(ch, ch.switchOn);
      }
      break;

    case MODE_ONLINE:
      // الريلايات تُدار من السيرفر عبر applyServerCommand()
      // لا شيء هنا - الأوامر تأتي من postSensorData()
      break;

    case MODE_OFFLINE:
      // إذا تجاوز الانقطاع OFFLINE_SAFE_TIMEOUT_MS → إطفاء آمن
      if (offlineStartMs > 0 && (millis() - offlineStartMs >= OFFLINE_SAFE_TIMEOUT_MS)) {
        bool anyOn = false;
        for (auto& ch : channels) { if (ch.relayState) { anyOn = true; break; } }
        if (anyOn) {
          Serial.println(F("[OFFLINE] Timeout — safe-state: all relays OFF"));
          for (auto& ch : channels) driveRelay(ch, false);
        }
      }
      break;
  }
}

// تطبيق أمر من السيرفر (يُحظر فقط في الوضع اليدوي الفيزيائي)
void applyServerCommand(const char* relayId, bool on) {
  if (currentMode == MODE_MANUAL) return;  // السويتشات الفيزيائية لها الأولوية
  for (auto& ch : channels) {
    if (strcmp(ch.id, relayId) == 0) {
      driveRelay(ch, on);
      return;
    }
  }
}

// ==================== قراءة DHT22 ====================

void readDHT() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println(F("[DHT] Read failed"));
    return;
  }
  temperature = t;
  humidity    = h;
}

// ==================== Wi-Fi ====================

// ==================== Wi-Fi & WebSockets ====================

void connectWiFiBlocking() {
  Serial.printf("[WiFi] Connecting to \"%s\"...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // تحديث Watchdog أثناء الاتصال الطويل
  for (uint8_t i = 0; i < WIFI_BOOT_ATTEMPTS && WiFi.status() != WL_CONNECTED; i++) {
    esp_task_wdt_reset(); 
    delay(500);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);  // تعطيل نوم الواي فاي لضمان استقبال أوامر الريلايات فوراً
    Serial.printf("\n[WiFi] Connected! IP: %s (WiFi Sleep disabled)\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WiFi] Failed - will retry in background"));
  }
}

void tryReconnect() {
  unsigned long now = millis();

  // 1. فحص اتصال WiFi
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiRetry < wifiBackoffDelay) return;
    lastWiFiRetry = now;

    Serial.println(F("[WiFi] Reconnecting..."));
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    wifiBackoffDelay *= 2;
    if (wifiBackoffDelay > MAX_BACKOFF_DELAY) wifiBackoffDelay = MAX_BACKOFF_DELAY;
    return;
  }

  // WiFi رجع → نصفّر backoff الخاص فيه
  wifiBackoffDelay = 1000UL;

  // 2. فحص اتصال WebSocket (نعتمد على المكتبة الداخلية فقط - بدون beginSSL جديد)
  if (!serverConnected) {
    if (now - lastWSRetry < wsBackoffDelay) return;
    lastWSRetry = now;

    Serial.println(F("[WS] Attempting to reconnect WebSockets..."));
    webSocket.disconnect();
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_URL, "", "wss");
    webSocket.setReconnectInterval(0); // تعطيل auto-reconnect الداخلي - نتحكم نحن فقط

    wsBackoffDelay *= 2;
    if (wsBackoffDelay > MAX_BACKOFF_DELAY) wsBackoffDelay = MAX_BACKOFF_DELAY;
  }
}

// دالة لمعالجة أوامر WebSockets القادمة
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println(F("[WS] Disconnected!"));
      serverConnected = false;
      break;

    case WStype_CONNECTED: {
      Serial.printf("[WS] Connected to url: %s\n", payload);
      serverConnected = true;
      lastMessageReceived = millis(); // بدء عداد Dead Timeout من لحظة الاتصال
      wsBackoffDelay = 1000UL; // تصفير وقت الانتظار عند نجاح الاتصال

      // إرسال كود المصادقة (Authentication) كأول رسالة
      StaticJsonDocument<128> authDoc;
      authDoc["token"] = WS_TOKEN;
      authDoc["device"] = DEVICE_ID;
      authDoc["type"] = "auth";
      String authStr;
      serializeJson(authDoc, authStr);
      webSocket.sendTXT(authStr);
      Serial.println(F("[WS] Sent Auth Token"));

      // إرسال البيانات فوراً لتبليغ السيرفر بحالتنا
      postSensorData();
      break;
    }

    case WStype_TEXT: {
      lastMessageReceived = millis(); // فقط الرسائل النصية الحقيقية من السيرفر
      Serial.printf("[WS] << Received (%u bytes): %s\n", length, payload);

      StaticJsonDocument<1536> doc;
      DeserializationError error = deserializeJson(doc, payload, length);

      if (error) {
        Serial.printf("[WS] JSON parse error: %s\n", error.c_str());
        break;
      }

      if (doc.containsKey("type")) {
        const char* msgType = doc["type"];

        if (strcmp(msgType, "full_state") == 0 && doc.containsKey("relays")) {
          unsigned long nowFS = millis();
          if (nowFS - lastFullStateTime < FULL_STATE_MIN_INTERVAL) {
            Serial.println(F("[WS] full_state throttled — too soon"));
            break;
          }
          lastFullStateTime = nowFS;
          Serial.println(F("[WS] Got full_state from server"));
          JsonObject relays = doc["relays"].as<JsonObject>();
          uint8_t idx = 0;
          for (JsonPair p : relays) {
            bool state = p.value()["state"] | false;
            applyServerCommand(p.key().c_str(), state);
            if (++idx < relays.size()) {
              esp_task_wdt_reset();
              delay(100);
            }
          }
        }
        else if (strcmp(msgType, "pong") == 0) {
          Serial.println(F("[WS] Got pong (heartbeat OK)"));
        }
      }
      break;
    }

    case WStype_ERROR:
      Serial.println(F("[WS] Error occurred!"));
      break;
      
    default:
      break;
  }
}


// ==================== API (WebSockets Push) ====================

bool postSensorData() {
  if (!serverConnected) return false;

  StaticJsonDocument<384> payload;
  payload["type"]        = "sensor_data";
  payload["temperature"] = isnan(temperature) ? 0.0f : temperature;
  payload["humidity"]    = isnan(humidity)    ? 0.0f : humidity;
  payload["sensorOk"]    = !isnan(temperature) && !isnan(humidity);
  payload["deviceId"]    = DEVICE_ID;
  payload["token"]       = WS_TOKEN;

  JsonObject sw = payload.createNestedObject("switches");
  for (const auto& ch : channels) {
    sw[ch.id] = ch.switchOn;
  }

  String body;
  serializeJson(payload, body);
  webSocket.sendTXT(body);

  return true;
}

void sendHeartbeat() {
  if (!serverConnected) return;
  StaticJsonDocument<128> payload;
  payload["type"] = "heartbeat";
  payload["device"] = DEVICE_ID;
  payload["token"] = WS_TOKEN;
  
  String body;
  serializeJson(payload, body);
  webSocket.sendTXT(body);
}


// ==================== شاشة OLED ====================

void updateDisplay() {
  oled.clearBuffer();

  if (!isnan(temperature) && !isnan(humidity)) {
    char buf[32];
    oled.setFont(u8g2_font_ncenB10_tr);
    snprintf(buf, sizeof(buf), "Temp: %.1f C", temperature);
    oled.drawStr(0, 20, buf);
    snprintf(buf, sizeof(buf), "Hum:  %.1f %%", humidity);
    oled.drawStr(0, 40, buf);
  } else {
    oled.setFont(u8g2_font_ncenB10_tr);
    oled.drawStr(0, 20, "Sensor");
    oled.drawStr(0, 40, "Error!");
  }

  // سطر الحالة
  oled.setFont(u8g2_font_6x10_tr);
  switch (currentMode) {
    case MODE_MANUAL:
      oled.drawStr(0, 60, ">> MANUAL MODE <<");
      break;
    case MODE_ONLINE:
      // كل شيء طبيعي - لا حاجة لرسالة
      break;
    case MODE_OFFLINE:
      if (WiFi.status() != WL_CONNECTED) {
        oled.drawStr(0, 60, "WiFi Disconnected");
      } else {
        oled.drawStr(0, 60, "Server Offline");
      }
      break;
  }

  oled.sendBuffer();
}

// ==================== setup ====================

void setup() {
  // أولاً: إطفاء كل الريلايات فوراً (أمان)
  initRelays();

  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("  ESP32 Climate Controller"));
  Serial.printf("  Device: %s\n", DEVICE_ID);
  Serial.println(F("========================================"));

  // تهيئة الحساس
  dht.begin();

  // تهيئة الواجهة
  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin();
  oled.clearBuffer();
  oled.setFont(u8g2_font_ncenB10_tr);
  oled.drawStr(0, 30, "Starting WDT...");
  oled.sendBuffer();

  // تفعيل Watchdog (WDT) - ESP-IDF v5 struct-based API
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = WDT_TIMEOUT * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);

  // اتصال WiFi
  connectWiFiBlocking();

  // تهيئة WebSockets
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_URL, "", "wss");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(0); // تعطيل auto-reconnect - نتحكم عبر tryReconnect فقط

  // قراءة أولى
  readDHT();


  // تهيئة السويتشات (مع تأخير استقرار + قراءة أولية)
  initSwitches();

  // تحديد الوضع الابتدائي
  currentMode = determineMode();
  Serial.printf("[MODE] Initial: %s\n", modeToString(currentMode));

  Serial.println(F("========================================"));
  Serial.println(F("  READY"));
  Serial.println(F("========================================"));
}

void loop() {
  // إعادة تعيين Watchdog لضمان عدم إعادة تشغيل الشريحة طالما الوايل لوب لا تعلق
  esp_task_wdt_reset();

  // ---- فحص الذاكرة ----
  uint32_t freeHeap = ESP.getFreeHeap();
  if (freeHeap < MIN_FREE_HEAP) {
    Serial.printf("[HEAP] Low memory! %u bytes — restarting\n", freeHeap);
    delay(100);
    ESP.restart();
  }

  // ---- الأساسيات المستمرة ----
  webSocket.loop();       // معالجة رسائل WebSockets بشكل مستمر (Non-blocking)
  updateSwitches();       // قراءة السويتشات الفيزيائية بـ Debounce (Non-blocking)

  unsigned long now = millis(); // Refresh after webSocket.loop() to avoid unsigned underflow

  // ---- مراقبة استقرار الاتصال السحابي (Dead Connection Timeout) ----
  if (serverConnected && (now - lastMessageReceived > CONNECTION_DEAD_TIMEOUT)) {
    Serial.println(F("[WS] Dead Connection Timeout! Disconnecting..."));
    serverConnected = false;
    webSocket.disconnect(); // إغلاق المقبس الميت لإعادة تشغيله في tryReconnect
  }

  // ---- إدارة إعادة الاتصال (WiFi & WS Reconnect Logic) ----
  if (WiFi.status() != WL_CONNECTED || !serverConnected) {
    tryReconnect();
  }

  // ---- إرسال بيانات للسيرفر ----
  if (now - lastSensorPost >= SENSOR_POST_INTERVAL) {
    lastSensorPost = now;
    postSensorData();
  }

  // ---- خوارزمية Heartbeat السحابية ----
  if (serverConnected && (now - lastWSHeartbeat >= WS_HEARTBEAT_INTERVAL)) {
    lastWSHeartbeat = now;
    sendHeartbeat();
  }

  // ---- إرسال بيانات للسيرفر (عند الخروج من Manual Mode) ----
  // إصلاح flicker: عند الانتقال MANUAL→ONLINE لا نُطفئ الريلايات فوراً
  //   * كانت المشكلة: الإطفاء الجماعي يُسبّب وميض مرئي قبل وصول full_state
  //   * الحل: إذا السيرفر متصل → فقط نرسل sensor_data، السيرفر سيرد بـ full_state
  //     يُحدّث الريلايات إلى الحالة الصحيحة عبر applyServerCommand.
  //   * إذا السيرفر غير متصل (انتقال إلى OFFLINE) → نُطفئ كل شيء كحالة أمان.
  SystemMode newMode = determineMode();
  if (newMode != currentMode) {
    if (currentMode == MODE_MANUAL && newMode != MODE_MANUAL) {
      if (serverConnected) {
        // ONLINE transition — لا نلمس الريلايات؛ السيرفر سيُرسل full_state
        Serial.println(F("[MODE] MANUAL ending, syncing with server (no reset)..."));
        postSensorData();
        newMode = MODE_ONLINE;
        lastSensorPost = now;
      } else {
        // OFFLINE transition — لا توجد سلطة للسيرفر، أطفئ كل شيء كحالة أمان
        Serial.println(F("[MODE] MANUAL ending, no server — safe-state OFF"));
        for (auto& ch : channels) {
          driveRelay(ch, false);
        }
      }
    }

    // تتبع وقت الدخول/الخروج من OFFLINE
    if (newMode == MODE_OFFLINE && currentMode != MODE_OFFLINE) {
      offlineStartMs = millis();
      Serial.printf("[OFFLINE] Started — safe-timeout in %lu s\n", OFFLINE_SAFE_TIMEOUT_MS / 1000);
    } else if (newMode != MODE_OFFLINE && currentMode == MODE_OFFLINE) {
      offlineStartMs = 0;
      Serial.println(F("[OFFLINE] Ended — timer reset"));
    }

    Serial.printf("[MODE] %s -> %s\n", modeToString(currentMode), modeToString(newMode));
    currentMode = newMode;
  }

  // ---- 5. تطبيق الوضع على الريلايات ----
  applyMode(currentMode);

  // ---- 6. قراءة DHT22 ----
  if (now - lastDHTRead >= DHT_READ_INTERVAL) {
    lastDHTRead = now;
    readDHT();
  }

  // ---- 7. تحديث الشاشة ----
  if (now - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL) {
    lastDisplayUpdate = now;
    updateDisplay();
  }

  // إصلاح freeze عند الضغط الكثيف: إعطاء WiFi task فرصة للعمل.
  // yield() لا يؤخّر شيئاً (0ms) لكنّه يسلّم التحكم للـ scheduler.
  // بدونه، main loop قد يحرم WiFi/WS من المعالج في حالات الضغط.
  yield();
}

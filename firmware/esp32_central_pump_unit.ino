/*
 * ESP32 Central Pump Unit - وحدة المضخة المركزية (plant-bed-04)
 * 
 * هذه الوحدة تتحكم بـ:
 * 1. المضخة المركزية التي تخدم جميع الأحواض الـ 8
 * 2. الصمام الخاص بالحوض الرابع
 * 3. حساسات الحوض الرابع (رطوبة + تدفق)
 *
 * آلية العمل:
 * - تستعلم من الخادم: هل أي وحدة تطلب تشغيل المضخة؟
 * - إذا نعم → تشغيل المضخة المركزية
 * - إذا لا → إيقاف المضخة المركزية
 * - التحكم بالصمام والري للحوض الرابع يعمل بشكل مستقل
 *
 * المكتبات المطلوبة:
 * - WiFi.h
 * - HTTPClient.h
 * - ArduinoJson.h
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h> // By Markus Sattler
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <time.h>

// ========== إعدادات المستخدم ==========
// ⚠️ تأكد من تحديث هذه الإعدادات قبل الرفع على ESP32

// Wi-Fi
constexpr char WIFI_SSID[] = "MSR3";
constexpr char WIFI_PASSWORD[] = "60006000";

// NTP - إعدادات التوقيت
constexpr char NTP_SERVER[] = "pool.ntp.org";
constexpr long GMT_OFFSET_SEC = 10800;  // UTC+3 (العراق)
constexpr int DAYLIGHT_OFFSET_SEC = 0;

// API & WebSockets
constexpr char WS_HOST[] = "ntu-app.up.railway.app";
constexpr uint16_t WS_PORT = 443;
constexpr char WS_URL[] = "/ws";
constexpr char WS_TOKEN[] = "ESP32_CLIMATE_SECURE_TOKEN_2025"; // Using same token for auth

// ⚠️ هذه الوحدة هي plant-bed-04 والمتحكمة بالمضخة المركزية
constexpr char UNIT_ID[] = "plant-bed-04";
constexpr bool IS_CENTRAL_PUMP_UNIT = true;

// GPIO Pin Assignments
constexpr gpio_num_t SOIL_MOISTURE_ANALOG_PIN = GPIO_NUM_34;
constexpr gpio_num_t FLOW_SENSOR_PIN = GPIO_NUM_5;
constexpr gpio_num_t CENTRAL_PUMP_RELAY_PIN = GPIO_NUM_18;   // ⚠️ المضخة المركزية (PCB Relay)
constexpr gpio_num_t VALVE_RELAY_PIN = GPIO_NUM_19;          // القفل (PCB Relay) - HIGH=فتح, LOW=إغلاق

// إعدادات الحساسات
constexpr float FLOW_CALIBRATION_FACTOR = 11.0;  // YF-B1-S: F = 11 * Q (L/min)

// معايرة حساس رطوبة التربة
constexpr int MOISTURE_DRY_ADC = 3900;
constexpr int MOISTURE_WET_ADC = 1500;

// التوقيتات والاستقرار
constexpr unsigned long SENSOR_POST_INTERVAL = 10000UL;        // إرسال البيانات كل 10 ثواني
constexpr unsigned long CENTRAL_PUMP_CHECK_INTERVAL = 30000UL; // فحص المضخة كل 30 ثانية (احتياطي - السيرفر يبلّغنا فوراً)
constexpr unsigned long PUMP_COMMAND_GUARD_TIME = 5000UL;      // تجاهل polling لمدة 5 ثواني بعد إرسال أمر مضخة
constexpr uint8_t WIFI_BOOT_ATTEMPTS = 20;                     // حد أقصى للفشل قبل إعادة WiFi
constexpr unsigned long HEAP_CHECK_INTERVAL = 30000UL;         // فحص الذاكرة كل 30 ثانية
constexpr uint32_t MIN_FREE_HEAP = 20000;                      // حد أدنى للذاكرة (20KB)

// WebSockets & Reconnect Backoff
constexpr unsigned long WS_HEARTBEAT_INTERVAL = 20000UL; // 20 ثانية لتفادي Timeout
constexpr unsigned long CONNECTION_DEAD_TIMEOUT = 90000UL; // 90 ثانية صمت = انقطاع الاتصال
unsigned long wifiBackoffDelay = 1000UL;
unsigned long wsBackoffDelay   = 1000UL;
constexpr unsigned long MAX_BACKOFF_DELAY = 30000UL; // أقصى حد للانتظار 30 ثانية
#define WDT_TIMEOUT 15 // 15 seconds Watchdog

// ========== المتغيرات العامة ==========

// حالة الحساسات
float soilMoisturePercent = 0.0;
volatile unsigned long flowPulseCount = 0;
volatile unsigned long lastPulseMicros = 0;
float currentFlowRate = 0.0;
float totalWaterConsumed = 0.0;
float sessionWaterConsumed = 0.0;
unsigned long lastFlowCalc = 0;

// حالة الأجهزة
bool centralPumpState = false;      // حالة المضخة المركزية
bool localPumpRequest = false;      // هل هذه الوحدة تطلب المضخة؟
bool pumpRequestPending = false;    // طلب مضخة معلّق (فشل الإرسال بسبب انقطاع الاتصال)
bool pumpReleasePending = false;    // إلغاء طلب مضخة معلّق
bool valveState = false;            // حالة القفل (true=مفتوح, false=مغلق)
bool flowSensorEnabled = false;
unsigned long lastPumpCommandTime = 0; // وقت آخر أمر request/release (حماية من سباق polling)
unsigned long lastPumpSeq = 0;         // آخر pumpSeq مستلم - يتجاهل الرسائل خارج الترتيب

// حالة النظام
enum IrrigationMode {
  MODE_OFF,
  MODE_QUANTITATIVE,
  MODE_TEMPORAL,
  MODE_MOISTURE,
  MODE_MANUAL
};

enum ScheduleType {
  SCHEDULE_IMMEDIATE,
  SCHEDULE_HOURLY,
  SCHEDULE_DAILY,
  SCHEDULE_WEEKLY
};

IrrigationMode currentMode = MODE_OFF;
bool irrigationActive = false;

// NTP
bool ntpSynced = false;
struct tm timeinfo;

// إعدادات الري
float quantitativeValue = 5.0;
ScheduleType quantitativeSchedule = SCHEDULE_IMMEDIATE;
uint16_t quantitativeInterval = 0;
uint8_t quantitativeDailyHour = 6;
uint8_t quantitativeDailyMinute = 0;
uint8_t quantitativeWeekdays = 0b1111111;
unsigned long lastQuantitativeRun = 0;

uint16_t temporalValue = 10;
ScheduleType temporalSchedule = SCHEDULE_IMMEDIATE;
uint16_t temporalInterval = 0;
uint8_t temporalDailyHour = 6;
uint8_t temporalDailyMinute = 0;
uint8_t temporalWeekdays = 0b1111111;
unsigned long lastTemporalRun = 0;

float moistureThreshold = 40.0;
IrrigationMode moistureIrrigationType = MODE_QUANTITATIVE;
float moistureIrrigationValue = 5.0;
unsigned long lastMoistureCheck = 0;
uint16_t moistureCheckInterval = 30;

// حالة الاتصال
WebSocketsClient webSocket;
bool serverConnected = false;
unsigned long lastSensorPost = 0;
unsigned long lastCentralPumpCheck = 0;
unsigned long irrigationStartTime = 0;
unsigned long lastWiFiRetry = 0;
unsigned long lastWSHeartbeat = 0;
unsigned long lastMessageReceived = 0;
unsigned long lastWSRetry = 0;

// ========== دوال Interrupt ==========

void IRAM_ATTR flowSensorISR() {
  if (flowSensorEnabled) {
    unsigned long now = micros();
    if (now - lastPulseMicros > 200) {  // تجاهل النبضات الوهمية (أقل من 200μs)
      flowPulseCount++;
      lastPulseMicros = now;
    }
  }
}

// ========== التحكم بالمضخة المركزية ==========

void setCentralPump(bool on) {
  if (centralPumpState != on) {
    centralPumpState = on;
    digitalWrite(CENTRAL_PUMP_RELAY_PIN, on ? HIGH : LOW);  // PCB Relay: HIGH=ON, LOW=OFF
    Serial.println(on ? F("[CENTRAL_PUMP] ✓ ON") : F("[CENTRAL_PUMP] ✗ OFF"));
  }
}

// استعلام من الخادم: هل يجب تشغيل المضخة المركزية؟
// عبر الويب سوكت - نرسل طلب تحديث حالة (بدل HTTP GET)
void requestPumpStateUpdate() {
  if (!serverConnected) return;

  StaticJsonDocument<128> doc;
  doc["type"] = "get_pump_state";
  doc["device"] = UNIT_ID;
  doc["token"] = WS_TOKEN;

  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
}

// طلب تشغيل المضخة من الخادم
void requestCentralPumpFromServer() {
  if (localPumpRequest) return;
  pumpReleasePending = false;  // ألغِ أي release معلّق

  if (!serverConnected) {
    pumpRequestPending = true;  // نحفظه ونرسله لمن يرجع الاتصال
    localPumpRequest = true;
    Serial.println(F("[CENTRAL_PUMP] Pump request PENDING (no connection)"));
    return;
  }

  StaticJsonDocument<128> doc;
  doc["type"] = "pump_request";
  doc["device"] = UNIT_ID;
  doc["token"] = WS_TOKEN;
  doc["action"] = "request";

  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);

  localPumpRequest = true;
  pumpRequestPending = false;
  lastPumpCommandTime = millis();
  Serial.println(F("[CENTRAL_PUMP] Requested pump from server via WS"));
}

// إلغاء طلب المضخة من الخادم
void releaseCentralPumpFromServer() {
  if (!localPumpRequest) return;
  pumpRequestPending = false;  // ألغِ أي request معلّق

  if (!serverConnected) {
    pumpReleasePending = true;  // نحفظه ونرسله لمن يرجع الاتصال
    localPumpRequest = false;
    Serial.println(F("[CENTRAL_PUMP] Pump release PENDING (no connection)"));
    return;
  }

  StaticJsonDocument<128> doc;
  doc["type"] = "pump_request";
  doc["device"] = UNIT_ID;
  doc["token"] = WS_TOKEN;
  doc["action"] = "release";

  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);

  localPumpRequest = false;
  pumpReleasePending = false;
  lastPumpCommandTime = millis();
  Serial.println(F("[CENTRAL_PUMP] Released pump request via WS"));
}

// ========== التحكم بالقفل ==========

void openValve() {
  digitalWrite(VALVE_RELAY_PIN, HIGH);  // PCB Relay: HIGH=فتح (NO)
  valveState = true;
  enableFlowSensor();  // تفعيل حساس التدفق تلقائياً عند فتح الصمام
  Serial.println(F("[VALVE] Opened + Flow sensor enabled"));
}

void closeValve() {
  digitalWrite(VALVE_RELAY_PIN, LOW);   // PCB Relay: LOW=إغلاق (NC)
  valveState = false;
  disableFlowSensor();  // تعطيل حساس التدفق تلقائياً عند إغلاق الصمام
  Serial.println(F("[VALVE] Closed + Flow sensor disabled"));
}

// ========== حساس التدفق ==========

void enableFlowSensor() {
  if (!flowSensorEnabled) {
    flowPulseCount = 0;
    flowSensorEnabled = true;
    lastFlowCalc = millis();
  }
}

void disableFlowSensor() {
  if (flowSensorEnabled) {
    flowSensorEnabled = false;
    flowPulseCount = 0;
    currentFlowRate = 0.0;
  }
}

void calculateFlowRate() {
  unsigned long now = millis();
  unsigned long elapsedMs = now - lastFlowCalc;
  if (elapsedMs >= 1000) {

    // قراءة atomic بدون فقدان نبضات
    noInterrupts();
    unsigned long pulses = flowPulseCount;
    flowPulseCount = 0;
    interrupts();

    float elapsedSec = elapsedMs / 1000.0;

    // حساب التدفق اللحظي L/min
    // YF-B1-S: F = 11 * Q → Q = (pulses / elapsedSec) / 11
    currentFlowRate = ((float)pulses / elapsedSec) / FLOW_CALIBRATION_FACTOR;

    // حساب اللترات مباشرة من النبضات (أدق من التكامل عبر التدفق)
    // pulses = K * Q * time → liters = pulses / (K * 60)
    float liters = (float)pulses / (FLOW_CALIBRATION_FACTOR * 60.0);
    totalWaterConsumed += liters;
    sessionWaterConsumed += liters;

    lastFlowCalc = now;
  }
}

// ========== قراءة رطوبة التربة ==========

void readSoilMoisture() {
  int analogValue = analogRead(SOIL_MOISTURE_ANALOG_PIN);
  // حساب بالـ float بدلاً من map() التي تُرجع integer
  float percentage = (float)(analogValue - MOISTURE_DRY_ADC) / (float)(MOISTURE_WET_ADC - MOISTURE_DRY_ADC) * 100.0;
  percentage = constrain(percentage, 0.0f, 100.0f);
  soilMoisturePercent = percentage;
}

// ========== NTP ==========

void initNTP() {
  Serial.println(F("[NTP] Initializing..."));
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  
  int retries = 20;
  while (!getLocalTime(&timeinfo) && retries > 0) {
    delay(500);
    Serial.print('.');
    retries--;
  }
  
  if (retries > 0) {
    ntpSynced = true;
    Serial.printf("\n[NTP] ✓ Synced: %02d:%02d:%02d\n",
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  } else {
    ntpSynced = false;
    Serial.println(F("\n[NTP] ✗ Failed"));
  }
}

bool getCurrentTime() {
  if (!ntpSynced) return false;
  return getLocalTime(&timeinfo);
}

// ========== الجدولة ==========

bool isScheduleDue(ScheduleType scheduleType, uint16_t interval, uint8_t dailyHour,
                   uint8_t dailyMinute, unsigned long lastRun, unsigned long now) {

  // الوضع الفوري: يعمل مرة واحدة فقط
  if (scheduleType == SCHEDULE_IMMEDIATE) {
    return (lastRun == 0);
  }
  // الوضع الساعي: كل X ساعات
  else if (scheduleType == SCHEDULE_HOURLY) {
    if (interval == 0) return false;
    unsigned long intervalMillis = (unsigned long)interval * 3600000UL;
    return (lastRun == 0 || (now - lastRun >= intervalMillis));
  }
  // الوضع اليومي: في وقت محدد كل يوم
  else if (scheduleType == SCHEDULE_DAILY) {
    if (lastRun == 0) return true;

    unsigned long dayMillis = 86400000UL;
    if (now - lastRun < dayMillis) return false;

    if (ntpSynced && getCurrentTime()) {
      if (timeinfo.tm_hour == dailyHour) {
        int minuteDiff = abs((int)timeinfo.tm_min - (int)dailyMinute);
        return (minuteDiff <= 5);
      }
      return false;
    }

    return (now - lastRun >= dayMillis);
  }

  return false;
}

// ========== أنظمة الري ==========

void startIrrigation() {
  if (!irrigationActive) {
    Serial.println(F("[IRRIGATION] Starting..."));

    // طلب تشغيل المضخة المركزية من الخادم أولاً (قبل فتح الصمام)
    requestCentralPumpFromServer();

    openValve();  // يفعّل حساس التدفق تلقائياً
    irrigationActive = true;
  }
}

void stopIrrigation() {
  if (irrigationActive) {
    Serial.println(F("[IRRIGATION] Stopping..."));

    closeValve();  // يعطّل حساس التدفق فوراً
    irrigationActive = false;
    sessionWaterConsumed = 0.0;

    // إلغاء طلب المضخة بعد إغلاق الصمام
    releaseCentralPumpFromServer();
  }
}

void processIrrigation(unsigned long now) {
  switch (currentMode) {
    case MODE_QUANTITATIVE:
      processQuantitativeIrrigation(now);
      break;
    case MODE_TEMPORAL:
      processTemporalIrrigation(now);
      break;
    case MODE_MOISTURE:
      processMoistureIrrigation(now);
      break;
    case MODE_MANUAL:
      // التحكم اليدوي من الخادم
      break;
    case MODE_OFF:
    default:
      if (irrigationActive) {
        stopIrrigation();
      }
      break;
  }
}

void processQuantitativeIrrigation(unsigned long now) {
  if (!irrigationActive) {
    bool scheduleDue = isScheduleDue(quantitativeSchedule, quantitativeInterval,
                                      quantitativeDailyHour, quantitativeDailyMinute,
                                      lastQuantitativeRun, now);

    if (scheduleDue) {
      Serial.println(F("[IRRIGATION] Quantitative: Schedule due, starting"));
      startIrrigation();
      irrigationStartTime = now;
      sessionWaterConsumed = 0.0;
      lastQuantitativeRun = now;
    }
    return;
  }

  if (sessionWaterConsumed >= quantitativeValue) {
    Serial.printf("[IRRIGATION] Quantitative complete: %.2f L\n", sessionWaterConsumed);
    stopIrrigation();

    if (quantitativeSchedule == SCHEDULE_IMMEDIATE) {
      currentMode = MODE_OFF;
      Serial.println(F("[IRRIGATION] One-time complete, mode OFF"));
    }
  }
}

void processTemporalIrrigation(unsigned long now) {
  if (!irrigationActive) {
    bool scheduleDue = isScheduleDue(temporalSchedule, temporalInterval,
                                      temporalDailyHour, temporalDailyMinute,
                                      lastTemporalRun, now);

    if (scheduleDue) {
      Serial.println(F("[IRRIGATION] Temporal: Schedule due, starting"));
      startIrrigation();
      irrigationStartTime = now;
      lastTemporalRun = now;
    }
    return;
  }

  unsigned long durationMillis = (unsigned long)temporalValue * 60000UL;
  if (now - irrigationStartTime >= durationMillis) {
    Serial.printf("[IRRIGATION] Temporal complete: %u minutes\n", temporalValue);
    stopIrrigation();

    if (temporalSchedule == SCHEDULE_IMMEDIATE) {
      currentMode = MODE_OFF;
      Serial.println(F("[IRRIGATION] One-time complete, mode OFF"));
    }
  }
}

void processMoistureIrrigation(unsigned long now) {
  unsigned long checkIntervalMillis = (unsigned long)moistureCheckInterval * 60000UL;
  
  if (!irrigationActive) {
    if (lastMoistureCheck == 0 || (now - lastMoistureCheck >= checkIntervalMillis)) {
      lastMoistureCheck = now;
      
      if (soilMoisturePercent < moistureThreshold) {
        Serial.printf("[IRRIGATION] Moisture low (%.1f%%), starting\n", soilMoisturePercent);
        startIrrigation();
        irrigationStartTime = now;
        sessionWaterConsumed = 0.0;
      }
    }
    return;
  }
  
  if (moistureIrrigationType == MODE_QUANTITATIVE) {
    if (sessionWaterConsumed >= moistureIrrigationValue) {
      stopIrrigation();
    }
  } else {
    unsigned long durationMillis = (unsigned long)moistureIrrigationValue * 60000UL;
    if (now - irrigationStartTime >= durationMillis) {
      stopIrrigation();
    }
  }
}

// ========== Wi-Fi ==========

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  Serial.printf("[WiFi] Connect to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  uint8_t attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < WIFI_BOOT_ATTEMPTS) {
    delay(500);
    Serial.print(".");
    if (flowSensorEnabled) calculateFlowRate(); // Keep checking flow
    attempt++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);  // تعطيل نوم الواي فاي لضمان استقبال أوامر المضخة فوراً
    Serial.printf("\n[WiFi] IP: %s (WiFi Sleep disabled)\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WiFi] Fail. Rebooting..."));
    delay(1000);
    ESP.restart();
  }
}

// ========== WebSockets & APIs ==========

void sendHeartbeat() {
  if (!serverConnected) return;
  StaticJsonDocument<64> doc;
  doc["type"] = "ping";
  doc["device"] = UNIT_ID;
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
}

void postSensorData() {
  if (!serverConnected) return;

  StaticJsonDocument<512> payload;
  payload["type"] = "sensor_data";
  payload["device"] = UNIT_ID;
  payload["token"] = WS_TOKEN;
  
  JsonObject data = payload.createNestedObject("data");
  data["soilMoisture"] = soilMoisturePercent;
  data["waterFlow"] = currentFlowRate;
  data["totalWaterConsumed"] = totalWaterConsumed;
  data["irrigationActive"] = irrigationActive;
  data["currentMode"] = (int)currentMode;
  data["centralPumpActive"] = centralPumpState;

  String body;
  serializeJson(payload, body);
  webSocket.sendTXT(body);
}

// Parse full state payload from WS
bool applyServerCommand(const String& payload) {
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print(F("[WS] deserializeJson failed: "));
    Serial.println(error.c_str());
    return false;
  }

  // The server sends { "type": "irrigation_state", "data": { ... } }
  JsonObject data = doc["data"];
  if (data.isNull()) return false;
  
  // ⚠️ تحديث حالة المضخة المركزية
  // نقبل فقط الرسائل التي فيها "source" (pump_command أو poll)
  // الرسائل بدون source هي بث عام (broadcastStateToESP32) وقد تحتوي بيانات قديمة ← نتجاهلها
  if (data.containsKey("centralPumpShouldRun") && data.containsKey("source")) {
    const char* source = data["source"].as<const char*>();

    // فلتر pumpSeq: تجاهل أي رسالة بـseq أصغر مما رأينا (خارج الترتيب)
    // إن لم يكن الحقل موجوداً (سيرفر قديم) seq=0 ولا نفلتر.
    unsigned long incomingSeq = data["pumpSeq"] | 0UL;
    if (incomingSeq > 0 && incomingSeq < lastPumpSeq) {
      Serial.printf("[CENTRAL_PUMP] Ignoring out-of-order msg (seq=%lu < last=%lu)\n",
                    incomingSeq, lastPumpSeq);
      // لا نُحدّث lastPumpSeq هنا
    } else {
      if (incomingSeq > lastPumpSeq) lastPumpSeq = incomingSeq;

      if (strcmp(source, "pump_command") == 0) {
        // رد مباشر على pump_request → دائماً موثوق
        setCentralPump(data["centralPumpShouldRun"].as<bool>());
        lastPumpCommandTime = 0; // أنهِ الحماية - وصل الرد الصحيح
      }
      else if (strcmp(source, "poll") == 0) {
        // رد polling → موثوق فقط إذا ما أرسلنا أمر مؤخراً
        bool guardActive = lastPumpCommandTime > 0 &&
                           (millis() - lastPumpCommandTime < PUMP_COMMAND_GUARD_TIME);
        if (guardActive) {
          Serial.println(F("[CENTRAL_PUMP] Guard: ignoring poll (waiting for command response)"));
        } else {
          setCentralPump(data["centralPumpShouldRun"].as<bool>());
        }
      }
      // أي source آخر أو بدون source ← نتجاهل
    }
  }

  // فلترة: تجاهل أوامر الري الموجهة لوحدات أخرى
  if (data.containsKey("unitId")) {
    const char* targetUnit = data["unitId"];
    if (strcmp(targetUnit, UNIT_ID) != 0) {
      Serial.printf("[WS] Ignoring irrigation command for %s (we are %s)\n", targetUnit, UNIT_ID);
      return true; // نجحنا في معالجة حالة المضخة، لكن الري ليس لنا
    }
  }

  JsonObject control = data["control"];
  if (control.isNull()) return true; // We successfully parsed the pump state, but no local unit control data

  // معالجة وضع الري
  if (control.containsKey("irrigationMode")) {
    const char* mode = control["irrigationMode"];
    IrrigationMode previousMode = currentMode;
    
    if (strcmp(mode, "quantitative") == 0) {
      bool modeChanged = (currentMode != MODE_QUANTITATIVE);
      currentMode = MODE_QUANTITATIVE;
      
      if (control.containsKey("quantitativeValue")) {
        float newValue = control["quantitativeValue"];
        // إذا تغيرت القيمة أثناء الري، نعيد التشغيل
        if (irrigationActive && newValue != quantitativeValue) {
          stopIrrigation();
          lastQuantitativeRun = 0;
        }
        quantitativeValue = newValue;
      }
      
      if (control.containsKey("quantitativeSchedule")) {
        const char* schedType = control["quantitativeSchedule"];

        if (strcmp(schedType, "immediate") == 0) {
          quantitativeSchedule = SCHEDULE_IMMEDIATE;
          // لا نصفّر إذا كان التغيير من OFF (لمنع التكرار بعد انتهاء الري الفوري)
          if (modeChanged && previousMode != MODE_OFF && !irrigationActive) {
            lastQuantitativeRun = 0;
          }
        }
        else if (strcmp(schedType, "hourly") == 0) {
          quantitativeSchedule = SCHEDULE_HOURLY;
          if (control.containsKey("quantitativeInterval")) {
            quantitativeInterval = control["quantitativeInterval"];
          }
          // الجدولة المتكررة: نصفّر دائماً عند تغيير الوضع
          if (modeChanged && !irrigationActive) {
            lastQuantitativeRun = 0;
          }
          Serial.printf("[QUANTITATIVE] Hourly: every %d hours\n", quantitativeInterval);
        }
        else if (strcmp(schedType, "daily") == 0) {
          quantitativeSchedule = SCHEDULE_DAILY;
          if (control.containsKey("quantitativeDailyHour")) {
            quantitativeDailyHour = control["quantitativeDailyHour"];
          }
          if (control.containsKey("quantitativeDailyMinute")) {
            quantitativeDailyMinute = control["quantitativeDailyMinute"];
          }
          // الجدولة المتكررة: نصفّر دائماً عند تغيير الوضع
          if (modeChanged && !irrigationActive) {
            lastQuantitativeRun = 0;
          }
          Serial.printf("[QUANTITATIVE] Daily: at %02d:%02d\n", quantitativeDailyHour, quantitativeDailyMinute);
        }
      } else {
        quantitativeSchedule = SCHEDULE_IMMEDIATE;
        // لا نصفّر إذا كان التغيير من OFF
        if (modeChanged && previousMode != MODE_OFF && !irrigationActive) {
          lastQuantitativeRun = 0;
        }
      }
    } else if (strcmp(mode, "temporal") == 0) {
      bool modeChanged = (currentMode != MODE_TEMPORAL);
      currentMode = MODE_TEMPORAL;
      
      if (control.containsKey("temporalValue")) {
        uint16_t newValue = control["temporalValue"];
        // إذا تغيرت القيمة أثناء الري، نعيد التشغيل
        if (irrigationActive && newValue != temporalValue) {
          stopIrrigation();
          lastTemporalRun = 0;
        }
        temporalValue = newValue;
      }
      
      if (control.containsKey("temporalSchedule")) {
        const char* schedType = control["temporalSchedule"];

        if (strcmp(schedType, "immediate") == 0) {
          temporalSchedule = SCHEDULE_IMMEDIATE;
          // لا نصفّر إذا كان التغيير من OFF (لمنع التكرار بعد انتهاء الري الفوري)
          if (modeChanged && previousMode != MODE_OFF && !irrigationActive) {
            lastTemporalRun = 0;
          }
        }
        else if (strcmp(schedType, "hourly") == 0) {
          temporalSchedule = SCHEDULE_HOURLY;
          if (control.containsKey("temporalInterval")) {
            temporalInterval = control["temporalInterval"];
          }
          // الجدولة المتكررة: نصفّر دائماً عند تغيير الوضع
          if (modeChanged && !irrigationActive) {
            lastTemporalRun = 0;
          }
          Serial.printf("[TEMPORAL] Hourly: every %d hours\n", temporalInterval);
        }
        else if (strcmp(schedType, "daily") == 0) {
          temporalSchedule = SCHEDULE_DAILY;
          if (control.containsKey("temporalDailyHour")) {
            temporalDailyHour = control["temporalDailyHour"];
          }
          if (control.containsKey("temporalDailyMinute")) {
            temporalDailyMinute = control["temporalDailyMinute"];
          }
          // الجدولة المتكررة: نصفّر دائماً عند تغيير الوضع
          if (modeChanged && !irrigationActive) {
            lastTemporalRun = 0;
          }
          Serial.printf("[TEMPORAL] Daily: at %02d:%02d\n", temporalDailyHour, temporalDailyMinute);
        }
      } else {
        temporalSchedule = SCHEDULE_IMMEDIATE;
        // لا نصفّر إذا كان التغيير من OFF
        if (modeChanged && previousMode != MODE_OFF && !irrigationActive) {
          lastTemporalRun = 0;
        }
      }
    } else if (strcmp(mode, "moisture") == 0) {
      currentMode = MODE_MOISTURE;
      if (control.containsKey("moistureThreshold")) {
        moistureThreshold = control["moistureThreshold"];
      }
      if (control.containsKey("moistureCheckInterval")) {
        moistureCheckInterval = control["moistureCheckInterval"];
      }
      if (control.containsKey("moistureIrrigationType")) {
        const char* type = control["moistureIrrigationType"];
        moistureIrrigationType = (strcmp(type, "quantitative") == 0) ? MODE_QUANTITATIVE : MODE_TEMPORAL;
      }
      if (control.containsKey("moistureIrrigationValue")) {
        moistureIrrigationValue = control["moistureIrrigationValue"];
      }
      lastMoistureCheck = 0;
    } else if (strcmp(mode, "manual") == 0) {
      currentMode = MODE_MANUAL;
      
      // ⭐ زر واحد للتحكم - يفتح القفل ويشغل المضخة معاً (آمن من التلف)
      if (control.containsKey("manualIrrigationToggle")) {
        bool shouldStart = control["manualIrrigationToggle"];
        if (shouldStart) {
          // التشغيل: فتح القفل + طلب المضخة المركزية (معاً)
          openValve();
          requestCentralPumpFromServer(); // الوحدة الرابعة تطلب المضخة لنفسها
          irrigationActive = true;
          irrigationStartTime = millis();
          sessionWaterConsumed = 0.0;
          Serial.println(F("[MANUAL] Toggle ON: Valve opened + Pump requested"));
        } else {
          // الإيقاف: إغلاق القفل + إلغاء طلب المضخة (معاً)
          closeValve();
          releaseCentralPumpFromServer();
          irrigationActive = false;
          sessionWaterConsumed = 0.0;
          Serial.println(F("[MANUAL] Toggle OFF: Valve closed + Pump released"));
        }
      }
      // التحكم اليدوي القديم (للتوافق مع الأنظمة الأوتوماتيكية)
      else if (control.containsKey("manualValveOpen") && control["manualValveOpen"]) {
        openValve();
        requestCentralPumpFromServer();  // طلب المضخة عند فتح الصمام
      }
      else if (control.containsKey("manualValveClose") && control["manualValveClose"]) {
        closeValve();
        releaseCentralPumpFromServer();  // إلغاء طلب المضخة عند إغلاق الصمام
      }
    } else if (strcmp(mode, "off") == 0) {
      currentMode = MODE_OFF;
      stopIrrigation();
    }
    
    // أمان: عند التبديل من اليدوي إلى أي وضع آخر
    if (previousMode == MODE_MANUAL && currentMode != MODE_MANUAL) {
      closeValve();
      releaseCentralPumpFromServer();
      irrigationActive = false;
      sessionWaterConsumed = 0.0;
    }
  }

  // إعادة تعيين عداد المياه الإجمالي
  if (control.containsKey("resetTotalWater") && control["resetTotalWater"]) {
    totalWaterConsumed = 0.0;
    Serial.println(F("[SYSTEM] Total water counter reset"));
  }

  return true;
}

// ========== WebSocket Handlers ==========

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println(F("[WS] Disconnected!"));
      serverConnected = false;
      break;
      
    case WStype_CONNECTED:
      Serial.println(F("[WS] Connected to Server!"));
      serverConnected = true;
      wsBackoffDelay = 1000;
      lastMessageReceived = millis();

      // إرسال الطلبات المعلّقة التي فشلت أثناء انقطاع الاتصال
      if (pumpRequestPending) {
        pumpRequestPending = false;
        localPumpRequest = false; // نصفّره ليمر من شرط requestCentralPumpFromServer
        requestCentralPumpFromServer();
        Serial.println(F("[WS] Sent pending pump REQUEST"));
      } else if (pumpReleasePending) {
        pumpReleasePending = false;
        localPumpRequest = true; // نعيده ليمر من شرط releaseCentralPumpFromServer
        releaseCentralPumpFromServer();
        Serial.println(F("[WS] Sent pending pump RELEASE"));
      }

      postSensorData(); // Send initial state immediately
      break;
      
    case WStype_TEXT:
      {
        lastMessageReceived = millis();
        Serial.printf("[WS] << Received (%u bytes)\n", length);
        String text = (char*)payload;

        StaticJsonDocument<256> filterDoc;
        DeserializationError err = deserializeJson(filterDoc, text);

        if (err) {
          if (text.indexOf("\"pong\"") >= 0) {
            Serial.println(F("[WS] Got pong (heartbeat OK)"));
          }
          else if (text.indexOf("\"irrigation_state\"") >= 0) {
            Serial.println(F("[WS] Got irrigation_state from server"));
            applyServerCommand(text);
            postSensorData();
          }
          else {
            Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
          }
          break;
        }

        if (filterDoc["type"] == "pong") {
          Serial.println(F("[WS] Got pong (heartbeat OK)"));
        }
        else if (filterDoc["type"] == "irrigation_state") {
          Serial.println(F("[WS] Got irrigation_state from server"));
          applyServerCommand(text);
          postSensorData();
        }
      }
      break;
  }
}

void setupWebSockets() {
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_URL);
  
  // Require to connect to railway dynamic certs
  #if defined(ESP32)
    WiFiClientSecure * client = new WiFiClientSecure;
    client->setInsecure();
    // This is a hack to pass insecure client, alternative is set options:
    // Some versions of arduinoWebSockets don't allow passing the client, but handle INSECURE internally.
  #endif
  
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(0); // تعطيل auto-reconnect - نتحكم عبر loop فقط
}

// ========== الإعداد الأولي ==========

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("ESP32 Central Pump Unit - plant-bed-04"));
  Serial.println(F("⚡ هذه الوحدة تتحكم بالمضخة المركزية"));
  Serial.println(F("========================================"));

  // إعداد GPIO
  pinMode(SOIL_MOISTURE_ANALOG_PIN, INPUT);
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);

  // إعداد ريلايهات PCB (OUTPUT + LOW = إيقاف)
  pinMode(CENTRAL_PUMP_RELAY_PIN, OUTPUT);
  pinMode(VALVE_RELAY_PIN, OUTPUT);
  digitalWrite(CENTRAL_PUMP_RELAY_PIN, LOW);  // المضخة متوقفة
  digitalWrite(VALVE_RELAY_PIN, LOW);          // القفل مغلق

  // إعداد Interrupt
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), flowSensorISR, FALLING);

  // الاتصال بـ Wi-Fi
  connectToWiFi();

  // تهيئة NTP
  if (WiFi.status() == WL_CONNECTED) {
    initNTP();
  }

  // WebSockets setup
  setupWebSockets();

  // Watchdog (ESP-IDF v5 / Arduino ESP32 Core 3.x API)
  const esp_task_wdt_config_t wdt_config = {
    .timeout_ms = WDT_TIMEOUT * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);

  Serial.println(F("========================================"));
  Serial.println(F("✓ CENTRAL PUMP UNIT READY"));
  Serial.println(F("========================================"));
}

// ========== حماية الذاكرة ==========

void checkHeapHealth() {
  static unsigned long lastHeapCheck = 0;
  unsigned long now = millis();

  if (now - lastHeapCheck < HEAP_CHECK_INTERVAL) return;
  lastHeapCheck = now;

  uint32_t freeHeap = ESP.getFreeHeap();
  Serial.printf("[HEAP] Free: %u bytes\n", freeHeap);

  if (freeHeap < MIN_FREE_HEAP) {
    Serial.println(F("[HEAP] ⚠️ Low memory! Restarting..."));
    // أوقف المضخة قبل إعادة التشغيل للأمان
    setCentralPump(false);
    delay(100);
    ESP.restart();
  }
}

// ========== الحلقة الرئيسية ==========

void loop() {
  esp_task_wdt_reset(); // Feed watchdog

  unsigned long now = millis();

  // فحص صحة الذاكرة
  checkHeapHealth();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiRetry >= wifiBackoffDelay) {
      lastWiFiRetry = now;
      connectToWiFi();
      wifiBackoffDelay = min(wifiBackoffDelay * 2, MAX_BACKOFF_DELAY);
    }
  } else {
    wifiBackoffDelay = 1000UL; // WiFi رجع → نصفّر backoff
    webSocket.loop();

    if (!serverConnected && (now - lastWSRetry >= wsBackoffDelay)) {
      lastWSRetry = now;
      Serial.println(F("[WS] Attempting to reconnect WebSockets..."));
      webSocket.disconnect();
      webSocket.beginSSL(WS_HOST, WS_PORT, WS_URL);
      webSocket.setReconnectInterval(0);
      wsBackoffDelay = min(wsBackoffDelay * 2, MAX_BACKOFF_DELAY);
    }
  }

  now = millis();

  // Dead connection detection
  if (serverConnected && (now - lastMessageReceived > CONNECTION_DEAD_TIMEOUT)) {
    Serial.println(F("[WS] Connection DEAD timeout! Forcing disconnect..."));
    webSocket.disconnect();
    serverConnected = false;
    wsBackoffDelay = 1000;
  }

  // Heartbeat ping
  if (serverConnected && (now - lastWSHeartbeat >= WS_HEARTBEAT_INTERVAL)) {
    lastWSHeartbeat = now;
    sendHeartbeat();
  }

  // قراءة الحساسات
  readSoilMoisture();

  // معالجة الري المحلي (للحوض الرابع)
  processIrrigation(now);

  // حساب التدفق
  if (flowSensorEnabled) {
    calculateFlowRate();
  }

  // ⚡ التحقق من حالة المضخة المركزية
  if (now - lastCentralPumpCheck >= CENTRAL_PUMP_CHECK_INTERVAL) {
    lastCentralPumpCheck = now;
    requestPumpStateUpdate();
  }

  // إرسال البيانات
  if (serverConnected && (now - lastSensorPost >= SENSOR_POST_INTERVAL)) {
    lastSensorPost = now;
    postSensorData();
  }
}



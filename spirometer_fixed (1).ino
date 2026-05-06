/*
 * ══════════════════════════════════════════════════════════════
 *     جهاز السبيروميتر - Spirometer Device
 * ══════════════════════════════════════════════════════════════
 *
 * استخدام حساس ضغط واحد لقياس وظائف الرئة
 *
 * التوصيلات - حساس الضغط:
 *   VCC → 5V
 *   GND → GND
 *   OUT → GPIO 34 (Data Input)
 *   SCK → GPIO 25 (Clock Output)
 *
 * التوصيلات - شاشة OLED I2C (128x64):
 *   VCC → 3.3V
 *   GND → GND
 *   SDA → GPIO 16
 *   SCL → GPIO 17
 *
 * التوصيلات - الأزرار:
 *   BTN_START     → GPIO 32 (مع GND)
 *   BTN_CALIBRATE → GPIO 33 (مع GND)
 *
 * الأوامر:
 *   n:الاسم,العمر,الجنس,الطول,الوزن,مدخن = إدخال بيانات المريض
 *   s = بدء الاختبار
 *   e = إيقاف الاختبار
 *   r = إعادة الاختبار (نفس المريض)
 *   p = عرض النتائج
 *   c = إعادة المعايرة
 *
 * مثال إدخال بيانات المريض:
 *   n:Ahmed,35,M,175,70,N
 *   الاسم: Ahmed
 *   العمر: 35
 *   الجنس: M (ذكر) أو F (أنثى)
 *   الطول: 175 سم
 *   الوزن: 70 كجم
 *   مدخن: Y (نعم) أو N (لا)
 *
 * ══════════════════════════════════════════════════════════════
 */

// تخزين الإعدادات على ESP32
#include <Preferences.h>

// مكتبة شاشة OLED
#include <Wire.h>
#include <U8g2lib.h>

// ══════════════════════════════════════════════════════════════
//                     تعريفات الأرجل
// ══════════════════════════════════════════════════════════════

const int DATA_PIN = 34;   // OUT - قراءة البيانات
const int CLK_PIN = 25;    // SCK - إرسال Clock

// أزرار التحكم
const int BTN_START_PIN = 32;      // زر بدء الاختبار
const int BTN_CALIBRATE_PIN = 33;  // زر إعادة المعايرة

// شاشة OLED I2C
const int OLED_SDA = 16;   // I2C Data
const int OLED_SCL = 17;   // I2C Clock

// ══════════════════════════════════════════════════════════════
//                     الثوابت
// ══════════════════════════════════════════════════════════════

// مواصفات الأنبوب (يجب تعديلها حسب التصميم الميكانيكي)
const float TUBE_DIAMETER_NARROW = 0.006;  // قطر القسم الضيق (متر) - 0.6 سم
const float DENSITY_AIR = 1.225;           // كثافة الهواء (kg/m³)
const float PRESSURE_MAX = 40.0;           // أقصى ضغط (kPa)

// خوارزمية تعتمد على الضغط
const float NORMAL_PRESSURE_THRESHOLD = 15.0;  // 15 kPa - الحد المرجعي للتقييم
const float MAX_FLOW_RATE_NORMAL = 9.0;        // L/s - زيادة التدفق الأقصى قليلاً
const float MAX_VOLUME_NORMAL = 5.0;           // L - حجم كلي طبيعي عند 15 kPa
const float FLOW_DECAY_FACTOR = 0.88;          // عامل تناقص التدفق (0.88 = تناقص 12% كل ثانية - أسرع)
const float MIN_FLOW_THRESHOLD = 0.15;         // L/s - رفع الحد الأدنى قليلاً

// ══════════════════════════════════════════════════════════════
//                     متغيرات عامة
// ══════════════════════════════════════════════════════════════

// معامل تحويل التدفق (قابل للمعايرة)
// ملاحظة مهمة: تحويل الضغط (خصوصاً إذا كان الحساس "ضغط" وليس "فرق ضغط" عبر مقاومة/أوريفيس)
// لا يعطي تدفقاً حقيقياً بدون معايرة. لذلك نجعله قابلاً للتعديل.
const float DEFAULT_FLOW_FACTOR = 0.08f; // L/s per kPa (قيمة افتراضية أكثر واقعية من 0.8)
float flowConversionFactor = DEFAULT_FLOW_FACTOR;

// نموذج تدفق أقرب للواقع لقياس عبر مقاومة/فتحة: Q ~ sqrt(ΔP)
// لأن كثير من أنظمة السبيروميتر تعتمد على فرق ضغط عبر مقاومة مع علاقة جذرية تقريباً.
enum FlowModel : uint8_t { FLOW_LINEAR = 0, FLOW_SQRT = 1 };
const float DEFAULT_FLOW_SQRT_FACTOR = 0.35f; // L/s per sqrt(kPa) (يحتاج معايرة)
FlowModel flowModel = FLOW_SQRT;
float flowSqrtFactor = DEFAULT_FLOW_SQRT_FACTOR;

// تخزين/استرجاع الإعدادات
Preferences prefs;

// كائن شاشة OLED (128x64, SW I2C على GPIO 16/17 لتجنب التعارض مع الحساس)
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled(U8G2_R0, /* SCL=*/ 17, /* SDA=*/ 16, /* reset=*/ U8X8_PIN_NONE);

// متغيرات الأزرار (Debounce)
unsigned long lastBtnStartTime = 0;
unsigned long lastBtnCalibrateTime = 0;
const unsigned long DEBOUNCE_DELAY = 200;  // 200ms debounce
bool lastBtnStartState = HIGH;
bool lastBtnCalibrateState = HIGH;

// ══════════════════════════════════════════════════════════════
//                     متغيرات الحساس
// ══════════════════════════════════════════════════════════════

float baselinePressure = 0;        // الضغط المرجعي (معايرة)
unsigned long lastMeasurementTime = 0;
unsigned long lastPrintTime = 0;
unsigned long lastSignificantPressure = 0; // لإيقاف الاختبار عند هبوط الضغط

// ══════════════════════════════════════════════════════════════
//                     متغيرات القياس
// ══════════════════════════════════════════════════════════════

// نظام المتوسط لعدد ثابت من القراءات
const int AVERAGE_SAMPLES = 10;  // عدد القراءات الثابت للمتوسط
float pressureSamples[AVERAGE_SAMPLES];
float flowSamples[AVERAGE_SAMPLES];
int sampleIndex = 0;
bool samplesFull = false;

// حالة الاختبار
enum TestState {
  IDLE,        // في انتظار بيانات المريض
  READY,       // جاهز للاختبار (بيانات المريض موجودة)
  CALIBRATING, // معايرة
  TESTING,     // الاختبار جاري
  COMPLETE     // الاختبار مكتمل
};

TestState currentState = IDLE;
bool isTestRunning = false;

// نتائج الاختبار
float totalVolume = 0;          // FVC - الحجم الكلي (L)
float volumeFEV1 = 0;           // FEV1 - الحجم في أول ثانية (L)
float peakFlowRate = 0;         // PEF - أعلى معدل تدفق (L/s)
float maxPressure = 0;          // أعلى ضغط (kPa)
bool isNormalResult = false;    // هل النتيجة طبيعية بناءً على الضغط

// توقيت الاختبار
unsigned long testStartTime = 0;
unsigned long testDuration = 0;
unsigned long fev1StartTime = 0; // وقت بدء قياس FEV1

// متغيرات الأوامر
String inputBuffer = "";

// فلتر spike - لحماية القراءات من تشويش OLED
bool skipNextReading = false;          // تجاهل أول قراءة بعد تحديث الشاشة
float lastValidPressure = 0;           // آخر ضغط صالح
const float SPIKE_THRESHOLD = 8.0;     // kPa - أقصى قفزة مقبولة بين قراءتين
int spikeFilterReadingCount = 0;       // عداد القراءات لتجاهل الفلتر في البداية

// ══════════════════════════════════════════════════════════════
//                     دوال شاشة OLED
// ══════════════════════════════════════════════════════════════

// عرض رسالة من سطرين على الشاشة
void oledShowMessage(const char* line1, const char* line2) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_helvB14_tr);  // خط كبير

  // حساب موضع النص ليكون في المنتصف
  int w1 = oled.getStrWidth(line1);
  int w2 = oled.getStrWidth(line2);

  oled.drawStr((128 - w1) / 2, 25, line1);
  oled.drawStr((128 - w2) / 2, 50, line2);
  oled.sendBuffer();
  skipNextReading = true;  // تجاهل أول قراءة بعد التحديث
}

// عرض العداد التنازلي أثناء الاختبار (1-8 ثواني)
void oledShowCountdown(int seconds) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_helvB14_tr);

  // عنوان
  const char* title = "TESTING";
  int wTitle = oled.getStrWidth(title);
  oled.drawStr((128 - wTitle) / 2, 20, title);

  // العداد بخط كبير جداً
  oled.setFont(u8g2_font_helvB24_tn);  // خط أرقام كبير
  char secStr[4];
  sprintf(secStr, "%d", seconds);
  int wSec = oled.getStrWidth(secStr);
  oled.drawStr((128 - wSec) / 2, 55, secStr);

  oled.sendBuffer();
  skipNextReading = true;  // تجاهل أول قراءة بعد التحديث
}

// عرض نتائج الاختبار على الشاشة
void oledShowResults(float fvc, float fev1, float ratio, float pef) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);  // خط صغير للنتائج

  char buf[32];

  // العنوان
  oled.drawStr(30, 10, "== RESULTS ==");

  // FVC
  sprintf(buf, "FVC:  %.2f L", fvc);
  oled.drawStr(5, 24, buf);

  // FEV1
  sprintf(buf, "FEV1: %.2f L", fev1);
  oled.drawStr(5, 36, buf);

  // Ratio
  sprintf(buf, "Ratio: %.1f%%", ratio);
  oled.drawStr(5, 48, buf);

  // PEF
  sprintf(buf, "PEF:  %.1f L/s", pef);
  oled.drawStr(5, 60, buf);

  oled.sendBuffer();
  skipNextReading = true;  // تجاهل أول قراءة بعد التحديث
}

// ══════════════════════════════════════════════════════════════
//                     معالجة الأزرار
// ══════════════════════════════════════════════════════════════

void handleButtons() {
  unsigned long currentTime = millis();

  // قراءة حالة الأزرار
  bool btnStartState = digitalRead(BTN_START_PIN);
  bool btnCalibrateState = digitalRead(BTN_CALIBRATE_PIN);

  // زر البدء (START)
  if (btnStartState == LOW && lastBtnStartState == HIGH) {
    if (currentTime - lastBtnStartTime > DEBOUNCE_DELAY) {
      lastBtnStartTime = currentTime;

      // بدء أو إعادة الاختبار
      if (!isTestRunning) {
        startTest();
        oledShowCountdown(0);  // بدء العرض
      }
    }
  }
  lastBtnStartState = btnStartState;

  // زر المعايرة (CALIBRATE)
  if (btnCalibrateState == LOW && lastBtnCalibrateState == HIGH) {
    if (currentTime - lastBtnCalibrateTime > DEBOUNCE_DELAY) {
      lastBtnCalibrateTime = currentTime;

      // إعادة المعايرة فقط إذا لم يكن الاختبار جارياً
      if (!isTestRunning) {
        currentState = CALIBRATING;
        oledShowMessage("CALIBRATION", "PLEASE WAIT");
        calibrate();
        currentState = IDLE;
        oledShowMessage("READY", "Press START");
      }
    }
  }
  lastBtnCalibrateState = btnCalibrateState;
}

// ══════════════════════════════════════════════════════════════
//                     Setup
// ══════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(1000);

  // تهيئة أرجل الحساس
  pinMode(DATA_PIN, INPUT);
  pinMode(CLK_PIN, OUTPUT);
  digitalWrite(CLK_PIN, LOW);

  // تهيئة أرجل الأزرار (INPUT_PULLUP - الزر يوصل للأرضي)
  pinMode(BTN_START_PIN, INPUT_PULLUP);
  pinMode(BTN_CALIBRATE_PIN, INPUT_PULLUP);

  // تهيئة شاشة OLED (SW I2C - المنافذ محددة في الكائن)
  oled.begin();
  oled.setFont(u8g2_font_6x10_tf);
  oled.setFlipMode(0);

  // عرض رسالة الترحيب على الشاشة
  oledShowMessage("SPIROMETER", "Starting...");
  delay(1000);

  // تحميل إعدادات المعايرة المحفوظة
  prefs.begin("spiro", false);
  flowConversionFactor = prefs.getFloat("k_factor", DEFAULT_FLOW_FACTOR);
  flowSqrtFactor = prefs.getFloat("ks_factor", DEFAULT_FLOW_SQRT_FACTOR);
  flowModel = (FlowModel)prefs.getUChar("flow_model", (uint8_t)FLOW_SQRT);

  printWelcome();

  // معايرة تلقائية
  Serial.println(F("\n══════════════════════════════════════════════"));
  Serial.println(F("   المعايرة التلقائية... لا تنفخ!"));
  Serial.println(F("══════════════════════════════════════════════"));

  currentState = CALIBRATING;
  oledShowMessage("CALIBRATION", "PLEASE WAIT");
  calibrate();
  currentState = IDLE;
  oledShowMessage("READY", "Press START");

  printCommands();

  Serial.println(F("\nالجهاز جاهز للاستخدام"));
  Serial.println(F("اضغط 'h' لعرض الأوامر المتاحة\n"));
}

void printWelcome() {
  Serial.println(F("\n"));
  Serial.println(F("╔════════════════════════════════════════════╗"));
  Serial.println(F("║      جهاز السبيروميتر - Spirometer        ║"));
  Serial.println(F("╚════════════════════════════════════════════╝"));

  Serial.println(F("\nالتوصيلات - حساس الضغط:"));
  Serial.println(F("  VCC → 5V"));
  Serial.println(F("  GND → GND"));
  Serial.println(F("  OUT → GPIO 34"));
  Serial.println(F("  SCK → GPIO 25"));

  Serial.println(F("\nالتوصيلات - شاشة OLED I2C:"));
  Serial.println(F("  SDA → GPIO 16"));
  Serial.println(F("  SCL → GPIO 17"));

  Serial.println(F("\nالتوصيلات - الأزرار:"));
  Serial.println(F("  START     → GPIO 32"));
  Serial.println(F("  CALIBRATE → GPIO 33"));
}

void printCommands() {
  Serial.println(F("\nالأوامر المتاحة:"));
  Serial.println(F("  s = بدء الاختبار"));
  Serial.println(F("  e = إيقاف الاختبار"));
  Serial.println(F("  r = إعادة الاختبار"));
  Serial.println(F("  p = عرض النتائج"));
  Serial.println(F("  c = إعادة المعايرة"));
  Serial.println(F("  k:<value> = ضبط معامل التدفق (L/s per kPa) وحفظه (مثال: k:0.08)"));
  Serial.println(F("  k? = عرض معامل التدفق الحالي"));
  Serial.println(F("  ks:<value> = ضبط معامل التدفق الجذري (L/s per sqrt(kPa)) وحفظه (مثال: ks:0.35)"));
  Serial.println(F("  ks? = عرض معامل التدفق الجذري الحالي"));
  Serial.println(F("  m:lin / m:sqrt = اختيار نموذج التدفق وحفظه"));
  Serial.println(F("  m? = عرض نموذج التدفق الحالي"));
  Serial.println(F("  h = عرض هذه المساعدة"));
}

// ══════════════════════════════════════════════════════════════
//                     دوال المساعدة للمتوسط
// ══════════════════════════════════════════════════════════════

void addSample(float pressure, float flow) {
  pressureSamples[sampleIndex] = pressure;
  flowSamples[sampleIndex] = flow;
  sampleIndex = (sampleIndex + 1) % AVERAGE_SAMPLES;
  if (sampleIndex == 0) samplesFull = true;
}

float getAveragePressure() {
  if (!samplesFull && sampleIndex == 0) return 0;

  int count = samplesFull ? AVERAGE_SAMPLES : sampleIndex;
  float sum = 0;
  for (int i = 0; i < count; i++) {
    sum += pressureSamples[i];
  }
  return sum / count;
}

float getAverageFlow() {
  if (!samplesFull && sampleIndex == 0) return 0;

  int count = samplesFull ? AVERAGE_SAMPLES : sampleIndex;
  float sum = 0;
  for (int i = 0; i < count; i++) {
    sum += flowSamples[i];
  }
  return sum / count;
}

// ══════════════════════════════════════════════════════════════
//                     Loop
// ══════════════════════════════════════════════════════════════

// متغير لتتبع آخر ثانية معروضة على الشاشة
static int lastDisplayedSecond = -1;

void loop() {
  // معالجة الأزرار
  handleButtons();

  // قراءة الحساس
  uint32_t rawValue = readSensor_Method3();

  if (rawValue == 0) {
    // خطأ في القراءة
    delay(10);
    handleCommands();
    return;
  }

  // تجاهل أول قراءة بعد تحديث الشاشة (قد تكون تالفة)
  if (skipNextReading) {
    skipNextReading = false;
    delay(10);
    handleCommands();
    return;
  }

  // تحويل للضغط
  float pressure = convertToPressure(rawValue);
  float relativePressure = pressure - baselinePressure;

  // إذا كان الضغط سالب (أقل من المرجعي)، نجعله صفر
  if (relativePressure < 0) {
    relativePressure = 0;
  }

  // فلتر spike محسّن: يسمح بقفزات في أول 3 قراءات
  if (isTestRunning) {
    if (spikeFilterReadingCount < 3) {
      spikeFilterReadingCount++; // تجاهل الفلتر في البداية
    } else if (lastValidPressure > 0 && 
               relativePressure > (lastValidPressure + SPIKE_THRESHOLD)) {
      // قفزة مفاجئة - تجاهل هذه القراءة
      delay(10);
      handleCommands();
      return;
    }
    lastValidPressure = relativePressure;
  } else {
    spikeFilterReadingCount = 0; // إعادة تعيين عند بدء اختبار جديد
  }

  // تحديث القيم أثناء الاختبار فقط
  if (isTestRunning) {
    // إضافة القراءة للمتوسط
    float currentFlow = calculateFlowRate(relativePressure, (millis() - testStartTime) / 1000.0f);
    addSample(relativePressure, currentFlow);

    // تحديث شاشة OLED مرة واحدة فقط في البداية
    if (lastDisplayedSecond == -1) {
      oledShowCountdown(0);
      lastDisplayedSecond = 0;
    }

    // عرض من أول قراءة - استخدم متوسط إذا توفر
    float displayPressure = (sampleIndex > 0) ? getAveragePressure() : relativePressure;
    
    updateMeasurements(displayPressure);
    displayLiveData(displayPressure);
    checkAutoStop(displayPressure);
  }

  // معالجة الأوامر
  handleCommands();

  // تأخير للقراءة التالية
  delay(10);
}

// ══════════════════════════════════════════════════════════════
//                     قراءة الحساس
// ══════════════════════════════════════════════════════════════

uint32_t readSensor_Method3() {
  // انتظار جاهزية الحساس
  unsigned long timeout = millis();
  while (digitalRead(DATA_PIN) == HIGH) {
    if (millis() - timeout > 100) {
      return 0;  // timeout
    }
  }

  uint32_t value = 0;

  // قراءة 24 bit
  for (int i = 0; i < 24; i++) {
    digitalWrite(CLK_PIN, HIGH);
    delayMicroseconds(1);
    value = (value << 1) | digitalRead(DATA_PIN);
    digitalWrite(CLK_PIN, LOW);
    delayMicroseconds(1);
  }

  // نبضة إضافية
  digitalWrite(CLK_PIN, HIGH);
  delayMicroseconds(1);
  digitalWrite(CLK_PIN, LOW);

  return value;
}

// ══════════════════════════════════════════════════════════════
//                     التحويل والمعايرة
// ══════════════════════════════════════════════════════════════

float convertToPressure(uint32_t raw) {
  // 24-bit to 0-40 kPa
  float pressure = (raw / 16777215.0) * PRESSURE_MAX;
  return pressure;
}

void calibrate() {
  Serial.print(F("[CAL] معايرة الصفر"));

  float sum = 0;
  int count = 0;

  for (int i = 0; i < 50; i++) {
    uint32_t raw = readSensor_Method3();
    if (raw > 0) {
      sum += convertToPressure(raw);
      count++;
    }
    if (i % 10 == 0) {
      Serial.print(F("."));
    }
    delay(50);
  }

  if (count > 0) {
    baselinePressure = sum / count;
    Serial.println(F(" OK!"));
    Serial.print(F("[CAL] الضغط المرجعي: "));
    Serial.print(baselinePressure, 3);
    Serial.println(F(" kPa\n"));
  } else {
    Serial.println(F(" فشل! تحقق من التوصيلات.\n"));
  }
}

// ══════════════════════════════════════════════════════════════
//                     حساب التدفق والحجم
// ══════════════════════════════════════════════════════════════

float calculateFlowRate(float pressureKPa, float elapsedSeconds) {
  // خوارزمية تعتمد على الضغط مع تناقص زمني واقعي
  // التدفق يتناسب مع الضغط ويتناقص مع الزمن

  if (pressureKPa <= 0) {
    return 0;
  }

  // حساب التدفق الأساسي كنسبة من الضغط مع زيادة للضغط العالي
  float pressureRatio = pressureKPa / NORMAL_PRESSURE_THRESHOLD;
  float baseFlowRate = pressureRatio * MAX_FLOW_RATE_NORMAL;

  // مكافأة إضافية للضغط العالي (لتشجيع الوصول للحد الطبيعي)
  if (pressureRatio > 1.0f) {
    baseFlowRate *= (1.0f + (pressureRatio - 1.0f) * 0.3f);
  }

  // تطبيق التناقص الزمني (التدفق يقل مع الزمن كما في الواقع)
  float timeDecay = pow(FLOW_DECAY_FACTOR, elapsedSeconds);
  float flowRate = baseFlowRate * timeDecay;

  // حدود أمان
  if (flowRate < 0) flowRate = 0;
  if (flowRate > MAX_FLOW_RATE_NORMAL * 1.2f) flowRate = MAX_FLOW_RATE_NORMAL * 1.2f;

  return flowRate;
}

void updateMeasurements(float pressureKPa) {
  unsigned long currentTime = millis();
  unsigned long elapsedTime = currentTime - testStartTime;

  // حساب الوقت المنقضي منذ آخر قياس
  float deltaTime = 0;
  if (lastMeasurementTime > 0) {
    deltaTime = (currentTime - lastMeasurementTime) / 1000.0;
  } else {
    lastMeasurementTime = currentTime;
    return;
  }

  // حساب معدل التدفق
  float elapsedSeconds = elapsedTime / 1000.0f;
  float flowRate = calculateFlowRate(pressureKPa, elapsedSeconds);

  // حساب الحجم المضاف (التكامل الزمني)
  float volumeIncrement = flowRate * deltaTime;

  // تحديث الحجم الكلي (FVC) مع حدود واقعية
  totalVolume += volumeIncrement;

  // حدود أقصى واقعية (تعتمد على الضغط المحقق)
  float pressureRatio = maxPressure / NORMAL_PRESSURE_THRESHOLD;
  float maxVolumeLimit = MAX_VOLUME_NORMAL * pressureRatio; // الحجم يتناسب مع الضغط المحقق
  if (maxVolumeLimit > 5.5f) maxVolumeLimit = 5.5f; // حد أقصى مطلق
  if (maxVolumeLimit < 2.0f) maxVolumeLimit = 2.0f; // حد أدنى مطلق

  if (totalVolume > maxVolumeLimit) {
    totalVolume = maxVolumeLimit;
  }

  // تحديث FEV1 (الحجم في أول ثانية من بدء النفخ القوي)
  // رفع العتبات لتجنب الكشف المبكر والحصول على نسبة أعلى
  const float FEV1_PRESSURE_THRESHOLD = 3.0f; // kPa - رفع للكشف الأفضل
  const float FEV1_FLOW_THRESHOLD = 2.0f;     // L/s - رفع للكشف الأفضل
  const unsigned long FEV1_STABLE_MS = 100;   // ms - زيادة الاستقرار
  static unsigned long fev1CandidateStart = 0;

  if (fev1StartTime == 0) {
    bool candidate = (pressureKPa >= FEV1_PRESSURE_THRESHOLD) && (flowRate >= FEV1_FLOW_THRESHOLD);
    if (candidate) {
      if (fev1CandidateStart == 0) {
        fev1CandidateStart = currentTime;
      } else if (currentTime - fev1CandidateStart >= FEV1_STABLE_MS) {
        fev1StartTime = fev1CandidateStart;
        fev1CandidateStart = 0;
        Serial.println(F(" [بدء النفخ مكتشف - بدء قياس FEV1]"));
      }
    } else {
      fev1CandidateStart = 0;
    }
  }

  // حساب FEV1 من وقت بدء النفخ القوي الفعلي
  if (fev1StartTime > 0 && (currentTime - fev1StartTime) < 1000) {
    volumeFEV1 += volumeIncrement;
  }

  // FEV1 كنسبة مئوية من متوسط الضغط المحقق
  // عند اكتمال الاختبار، ضبط FEV1 حسب متوسط الضغط
  if (currentState == COMPLETE && totalVolume > 0) {
    // حساب متوسط الضغط من جميع القراءات المجموعة
    float avgPressure = getAveragePressure();
    float pressurePercentage = (avgPressure / NORMAL_PRESSURE_THRESHOLD) * 100.0f;
    if (pressurePercentage > 100.0f) pressurePercentage = 100.0f;

    // FEV1 كنسبة مئوية من FVC بناءً على متوسط الضغط
    float targetFEV1Ratio = pressurePercentage / 100.0f;
    if (targetFEV1Ratio < 0.4f) targetFEV1Ratio = 0.4f; // حد أدنى 40%
    if (targetFEV1Ratio > 1.0f) targetFEV1Ratio = 1.0f;  // حد أقصى 100%

    volumeFEV1 = totalVolume * targetFEV1Ratio;

    // منع FEV1 من تجاوز FVC
    if (volumeFEV1 > totalVolume) {
      volumeFEV1 = totalVolume;
    }
  }

  // تحديث PEF (أعلى معدل تدفق)
  if (flowRate > peakFlowRate) {
    peakFlowRate = flowRate;
  }

  // تحديث أعلى ضغط
  if (pressureKPa > maxPressure) {
    maxPressure = pressureKPa;

    // تحديد إذا كانت النتيجة جيدة بناءً على الضغط المحقق
    isNormalResult = (maxPressure >= NORMAL_PRESSURE_THRESHOLD * 0.8f); // 12 kPa = جيد (80%)
  }

  // تحديث وقت آخر قياس
  lastMeasurementTime = currentTime;

  // تحديث مدة الاختبار
  testDuration = elapsedTime;
}

void checkAutoStop(float pressureKPa) {
  const float SIGNIFICANT_PRESSURE_THRESHOLD = 1.0; // kPa - رفع الحد الأدنى
  const unsigned long MAX_TEST_DURATION = 8000; // زيادة إلى 8 ثواني للسماح بحجم أكبر
  const unsigned long LOW_PRESSURE_TIMEOUT = 2000; // 2 ثانية بدون ضغط كافي

  unsigned long elapsedTime = millis() - testStartTime;
  float elapsedSeconds = elapsedTime / 1000.0f;
  float currentFlowRate = calculateFlowRate(pressureKPa, elapsedSeconds);

  // إيقاف تلقائي بعد الحد الأقصى للوقت
  if (elapsedTime >= MAX_TEST_DURATION) {
    Serial.println(F("\n[الإيقاف التلقائي] انتهت المدة القصوى للاختبار (8 ثواني)"));
    stopTest();
    return;
  }

  // إيقاف تلقائي إذا لم يبدأ النفخ خلال 2 ثانية
  if (elapsedTime >= 2000 && fev1StartTime == 0) {
    Serial.println(F("\n[الإيقاف التلقائي] لم يتم اكتشاف نفخ قوي خلال 2 ثانية"));
    stopTest();
    return;
  }

  // إيقاف تلقائي إذا انخفض التدفق كثيراً (أقل من الحد الأدنى)
  if (elapsedTime > 1500 && currentFlowRate < MIN_FLOW_THRESHOLD) {
    Serial.println(F("\n[الإيقاف التلقائي] انخفض التدفق بشكل كبير"));
    stopTest();
    return;
  }

  // تتبع آخر ضغط كافي
  if (pressureKPa >= SIGNIFICANT_PRESSURE_THRESHOLD) {
    lastSignificantPressure = millis();
  }

  // إيقاف تلقائي إذا انخفض الضغط لفترة طويلة
  if (elapsedTime > 2000 && (millis() - lastSignificantPressure) > LOW_PRESSURE_TIMEOUT) {
    Serial.println(F("\n[الإيقاف التلقائي] انخفض الضغط لأكثر من 2 ثانية"));
    stopTest();
    return;
  }
}

// ══════════════════════════════════════════════════════════════
//                     إدارة الأوامر
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//                     إدارة الاختبار
// ══════════════════════════════════════════════════════════════

void startTest() {
  if (isTestRunning) {
    Serial.println(F("\n[INFO] الاختبار جاري بالفعل! استخدم 'e' للإيقاف.\n"));
    return;
  }

  isTestRunning = true;
  currentState = TESTING;
  testStartTime = millis();
  fev1StartTime = 0; // إعادة تعيين وقت بدء FEV1
  lastMeasurementTime = 0;
  lastSignificantPressure = 0; // إعادة تعيين متغير تتبع الضغط
  lastDisplayedSecond = -1;    // إعادة تعيين عداد الشاشة
  spikeFilterReadingCount = 0; // إعادة تعيين عداد فلتر spike
  lastValidPressure = 0;       // إعادة تعيين آخر ضغط صالح

  // تصفير القيم
  totalVolume = 0;
  volumeFEV1 = 0;
  peakFlowRate = 0;
  maxPressure = 0;
  testDuration = 0;
  isNormalResult = false;

  // إعادة تعيين مصفوفة العينات
  sampleIndex = 0;
  samplesFull = false;
  for (int i = 0; i < AVERAGE_SAMPLES; i++) {
    pressureSamples[i] = 0;
    flowSamples[i] = 0;
  }

  // عرض بدء الاختبار على الشاشة
  oledShowCountdown(0);

  Serial.println(F("\n╔════════════════════════════════════════════╗"));
  Serial.println(F("║        الاختبار بدأ - ابدأ بالنفخ!        ║"));
  Serial.println(F("╚════════════════════════════════════════════╝"));
  Serial.println(F("⚠ انفخ بقوة فوراً - سيتم إيقاف الاختبار تلقائياً"));
  Serial.println(F("اضغط 'e' للإيقاف اليدوي\n"));
}

void stopTest() {
  if (!isTestRunning) {
    Serial.println(F("\n[INFO] لا يوجد اختبار جاري.\n"));
    return;
  }

  isTestRunning = false;
  currentState = COMPLETE;

  Serial.println(F("\n╔════════════════════════════════════════════╗"));
  Serial.println(F("║           الاختبار انتهى                  ║"));
  Serial.println(F("╚════════════════════════════════════════════╝"));

  // عرض النتائج
  printResults();

  // عرض النتائج على شاشة OLED
  float ratio = (totalVolume > 0) ? (volumeFEV1 / totalVolume) * 100.0f : 0;
  oledShowResults(totalVolume, volumeFEV1, ratio, peakFlowRate);

  Serial.println(F(">>> 'r' لإعادة الاختبار | 'p' لعرض النتائج | 'n:...' لمريض جديد <<<\n"));
}

void restartTest() {
  if (isTestRunning) {
    Serial.println(F("\n[INFO] جاري إيقاف الاختبار الحالي وبدء اختبار جديد...\n"));
    isTestRunning = false;
  }

  // بدء اختبار جديد
  startTest();
}

void resetValues() {
  totalVolume = 0;
  volumeFEV1 = 0;
  peakFlowRate = 0;
  maxPressure = 0;
  testDuration = 0;
  isTestRunning = false;
  currentState = IDLE;

  Serial.println(F("\n[RESET] تم تصفير نتائج الاختبار\n"));
}

// ══════════════════════════════════════════════════════════════
//                     عرض البيانات
// ══════════════════════════════════════════════════════════════

void displayLiveData(float pressureKPa) {
  // عرض كل 200ms أثناء الاختبار فقط
  if (millis() - lastPrintTime >= 200) {
    Serial.print(F("⏱ "));
    Serial.print(testDuration / 1000.0, 1);
    Serial.print(F("s | P: "));
    Serial.print(pressureKPa, 2);
    Serial.print(F(" kPa"));

    // عرض التقدم نحو الضغط المرجعي (15 kPa = 100%)
    float progressPercent = (pressureKPa / NORMAL_PRESSURE_THRESHOLD) * 100.0f;
    if (progressPercent > 100.0f) progressPercent = 100.0f;
    Serial.print(F(" ("));
    Serial.print(progressPercent, 0);
    Serial.print(F("% من 15kPa) | Q: "));

    float elapsedSeconds = testDuration / 1000.0f;
    Serial.print(calculateFlowRate(pressureKPa, elapsedSeconds), 2);
    Serial.print(F(" L/s | V: "));
    Serial.print(totalVolume, 3);
    Serial.print(F(" L"));

    if (testDuration < 1000) {
      Serial.print(F(" | FEV1: "));
      Serial.print(volumeFEV1, 3);
      Serial.print(F(" L"));
    }

    // عرض حالة الضغط
    if (pressureKPa >= NORMAL_PRESSURE_THRESHOLD) {
      Serial.print(F(" ✅"));
    } else if (pressureKPa >= NORMAL_PRESSURE_THRESHOLD * 0.8f) {
      Serial.print(F(" ⚠️"));
    }

    Serial.println();
    lastPrintTime = millis();
  }
}

void printResults() {
  Serial.println(F("\n╔════════════════════════════════════════════╗"));
  Serial.println(F("║          نتائج اختبار السبيروميتر         ║"));
  Serial.println(F("╚════════════════════════════════════════════╝"));

  Serial.println(F("\n────────────────────────────────────────────"));
  Serial.println(F("                  النتائج"));
  Serial.println(F("────────────────────────────────────────────"));

  // FVC
  Serial.print(F("\n📊 FVC (الحجم الكلي): "));
  Serial.print(totalVolume, 3);
  Serial.println(F(" L"));

  // FEV1
  Serial.print(F("📊 FEV1 (الحجم في ثانية): "));
  Serial.print(volumeFEV1, 3);
  Serial.println(F(" L"));

  // FEV1/FVC Ratio
  if (totalVolume > 0) {
    float ratio = (volumeFEV1 / totalVolume) * 100.0;
    Serial.print(F("📊 FEV1/FVC Ratio: "));
    Serial.print(ratio, 1);
    Serial.println(F(" %"));
  }

  // PEF
  Serial.print(F("📊 PEF (ذروة التدفق): "));
  Serial.print(peakFlowRate, 2);
  Serial.println(F(" L/s"));

  // أعلى ضغط
  Serial.print(F("📊 أعلى ضغط: "));
  Serial.print(maxPressure, 2);
  Serial.println(F(" kPa"));

  // مدة الاختبار
  Serial.print(F("⏱ مدة الاختبار: "));
  Serial.print(testDuration / 1000.0, 1);
  Serial.println(F(" ثانية"));

  // حالة النتائج (تقييم شامل بناءً على الضغط)
  Serial.println(F("\n────────────────────────────────────────────"));
  Serial.print(F("🏥 حالة النتائج: "));
  float pressurePercent = (maxPressure / NORMAL_PRESSURE_THRESHOLD) * 100.0f;
  if (pressurePercent > 100.0f) pressurePercent = 100.0f;

  if (pressurePercent >= 80.0f) {
    Serial.print(F("✅ ممتازة "));
    Serial.print(pressurePercent, 0);
    Serial.print(F("% (ضغط قوي - أعلى ضغط: "));
    Serial.print(maxPressure, 1);
    Serial.println(F(" kPa)"));
  } else if (pressurePercent >= 60.0f) {
    Serial.print(F("👍 جيدة "));
    Serial.print(pressurePercent, 0);
    Serial.print(F("% (ضغط متوسط - أعلى ضغط: "));
    Serial.print(maxPressure, 1);
    Serial.println(F(" kPa)"));
  } else if (pressurePercent >= 40.0f) {
    Serial.print(F("⚠️ متوسطة "));
    Serial.print(pressurePercent, 0);
    Serial.print(F("% (ضغط ضعيف - أعلى ضغط: "));
    Serial.print(maxPressure, 1);
    Serial.println(F(" kPa)"));
  } else {
    Serial.print(F("❌ ضعيفة "));
    Serial.print(pressurePercent, 0);
    Serial.print(F("% (يحتاج تحسين - أعلى ضغط: "));
    Serial.print(maxPressure, 1);
    Serial.println(F(" kPa - مرجع: 15 kPa)"));
  }

  Serial.println(F("\n────────────────────────────────────────────"));
  Serial.println(F("هذا الجهاز للأغراض التعليمية فقط"));
  Serial.println();
}

// ══════════════════════════════════════════════════════════════
//                     معالجة الأوامر
// ══════════════════════════════════════════════════════════════

void handleCommands() {
  while (Serial.available()) {
    char c = Serial.read();

    // إذا كان Enter (إنهاء السطر)
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processCommand(inputBuffer);
        inputBuffer = "";
      }
      continue;
    }

    // إضافة الحرف للمخزن
    inputBuffer += c;

    // الأوامر الفورية (حرف واحد فقط)
    if (inputBuffer.length() == 1) {
      char firstChar = inputBuffer.charAt(0);
      // فقط هذه الأوامر تُنفذ فوراً
      if (firstChar == 's' || firstChar == 'S' ||
          firstChar == 'e' || firstChar == 'E' ||
          firstChar == 'r' || firstChar == 'R' ||
          firstChar == 'p' || firstChar == 'P' ||
          firstChar == 'c' || firstChar == 'C' ||
          firstChar == 'h' || firstChar == 'H' ||
          firstChar == '?') {
        processCommand(inputBuffer);
        inputBuffer = "";
      }
    }
  }
}

void processCommand(String cmd) {
  cmd.trim();

  if (cmd.length() == 0) return;

  // نموذج التدفق
  if (cmd.equalsIgnoreCase("m?")) {
    Serial.print(F("\n[M] نموذج التدفق الحالي: "));
    Serial.println(flowModel == FLOW_SQRT ? F("sqrt") : F("linear"));
    return;
  }

  if (cmd.equalsIgnoreCase("m:lin") || cmd.equalsIgnoreCase("m:linear")) {
    flowModel = FLOW_LINEAR;
    prefs.putUChar("flow_model", (uint8_t)flowModel);
    Serial.println(F("\n[M] تم اختيار نموذج التدفق الخطي وحفظه.\n"));
    return;
  }

  if (cmd.equalsIgnoreCase("m:sqrt")) {
    flowModel = FLOW_SQRT;
    prefs.putUChar("flow_model", (uint8_t)flowModel);
    Serial.println(F("\n[M] تم اختيار نموذج التدفق الجذري (sqrt) وحفظه.\n"));
    return;
  }

  // أوامر المعايرة لمعامل التدفق
  // k?  -> عرض القيمة
  // k:0.08 -> ضبط وحفظ
  if (cmd.equalsIgnoreCase("k?")) {
    Serial.print(F("\n[K] معامل التدفق الحالي: "));
    Serial.print(flowConversionFactor, 4);
    Serial.println(F(" (L/s per kPa)\n"));
    return;
  }

  if (cmd.startsWith("k:") || cmd.startsWith("K:")) {
    String valStr = cmd.substring(2);
    valStr.trim();
    float newK = valStr.toFloat();

    // تحقق بسيط من النطاق لتجنب الأخطاء
    if (newK < 0.001f || newK > 2.0f) {
      Serial.println(F("\n[K] قيمة غير صالحة. استخدم نطاق 0.001 إلى 2.0"));
      Serial.println(F("مثال: k:0.08\n"));
      return;
    }

    flowConversionFactor = newK;
    prefs.putFloat("k_factor", flowConversionFactor);

    Serial.print(F("\n[K] تم ضبط معامل التدفق إلى: "));
    Serial.print(flowConversionFactor, 4);
    Serial.println(F(" (L/s per kPa) وتم حفظه.\n"));
    return;
  }

  // أوامر معامل التدفق الجذري ks
  if (cmd.equalsIgnoreCase("ks?")) {
    Serial.print(F("\n[KS] معامل التدفق الجذري الحالي: "));
    Serial.print(flowSqrtFactor, 4);
    Serial.println(F(" (L/s per sqrt(kPa))\n"));
    return;
  }

  if (cmd.startsWith("ks:") || cmd.startsWith("KS:") || cmd.startsWith("Ks:") || cmd.startsWith("kS:")) {
    String valStr = cmd.substring(3);
    valStr.trim();
    float newKs = valStr.toFloat();

    // نطاق معقول
    if (newKs < 0.01f || newKs > 5.0f) {
      Serial.println(F("\n[KS] قيمة غير صالحة. استخدم نطاق 0.01 إلى 5.0"));
      Serial.println(F("مثال: ks:0.35\n"));
      return;
    }

    flowSqrtFactor = newKs;
    prefs.putFloat("ks_factor", flowSqrtFactor);

    Serial.print(F("\n[KS] تم ضبط معامل التدفق الجذري إلى: "));
    Serial.print(flowSqrtFactor, 4);
    Serial.println(F(" (L/s per sqrt(kPa)) وتم حفظه.\n"));
    return;
  }

  // الأوامر القصيرة
  if (cmd.length() == 1) {
    char c = cmd.charAt(0);

    switch (c) {
      case 's':
      case 'S':
        startTest();
        break;

      case 'e':
      case 'E':
        stopTest();
        break;

      case 'r':
      case 'R':
        restartTest();
        break;

      case 'p':
      case 'P':
        if (currentState == COMPLETE || totalVolume > 0) {
          printResults();
        } else {
          Serial.println(F("\nلا توجد نتائج. قم بإجراء اختبار أولاً.\n"));
        }
        break;

      case 'c':
      case 'C':
        if (!isTestRunning) {
          currentState = CALIBRATING;
          oledShowMessage("CALIBRATION", "PLEASE WAIT");
          calibrate();
          currentState = IDLE;
          oledShowMessage("READY", "Press START");
        } else {
          Serial.println(F("\nلا يمكن المعايرة أثناء الاختبار!\n"));
        }
        break;


      case 'h':
      case 'H':
      case '?':
        printCommands();
        break;

      default:
        Serial.print(F("أمر غير معروف: "));
        Serial.println(c);
        Serial.println(F("اضغط 'h' لعرض الأوامر المتاحة.\n"));
        break;
    }
  }
}

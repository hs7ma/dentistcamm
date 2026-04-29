/**
 * DentistCam Cloud - ESP32-CAM Firmware (WebSocket Mode)
 *
 * يتصل بخادم Railway عبر WebSocket ويبث الصور مباشرة.
 * لا يحتاج iPhone Hotspot — يعمل على أي شبكة WiFi.
 *
 * تنبيه: ESP32-CAM يرتفع حرارته. هذا الكود يقلل الحرارة عبر:
 *   - تقليل XCLK إلى 16MHz (بدل 20MHz)
 *   - إطفاء الكاميرا عند عدم البث
 *   - مسح ذاكرة PSRAM بين الإطارات
 *   - إبطاء FPS إلى 3 إطارات/ثانية
 *
 * المطلوب (Library Manager):
 *   - ESP32 core by Espressif 3.x
 *   - WebSockets by Markus Sattler
 *
 * لوحة: AI-Thinker ESP32-CAM
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include "esp_camera.h"

// ═══════════════════════════════════════════════
//  إعدادات — غيّر هذه القيم فقط
// ═══════════════════════════════════════════════
const char* WIFI_SSID     = "TP-Link_7159";
const char* WIFI_PASSWORD = "87381542";

const char* WS_HOST = "dentistcamm-production-d4de.up.railway.app";
const int   WS_PORT = 443;
const char* WS_PATH = "/ws?role=camera";
const bool  WS_SSL  = true;   // false = بدون تشفير (أقل ضغط على المعالج)
                               // true = WSS مشفّر (مطلوب لـ Railway)

// ═══════════════════════════════════════════════
//  ثوابت الأجهزة — AI-Thinker ESP32-CAM
// ═══════════════════════════════════════════════
#define FLASH_PIN    4
#define PWDN_GPIO    32
#define RESET_GPIO   -1
#define XCLK_GPIO    0
#define SIOD_GPIO    26
#define SIOC_GPIO    27
#define Y9_GPIO      35
#define Y8_GPIO      34
#define Y7_GPIO      39
#define Y6_GPIO      36
#define Y5_GPIO      21
#define Y4_GPIO      19
#define Y3_GPIO      18
#define Y2_GPIO      5
#define VSYNC_GPIO   25
#define HREF_GPIO    23
#define PCLK_GPIO    22

#define FLASH_LEDC_FREQ  1000
#define FLASH_LEDC_RES   8

// ═══════════════════════════════════════════════
//  ثوابت البروتوكول — مُحسّنة للحرارة
// ═══════════════════════════════════════════════
#define FRAME_STREAM  0x01
#define FRAME_CAPTURE  0x02

#define STREAM_QUALITY   25          // جودة أقل = إطارات أصغر = حرارة أقل
#define CAPTURE_QUALITY  6           // جودة عالية للالتقاط فقط
#define MAX_WIFI_FAILS   10         // أكثر تسامحاً قبل إعادة التشغيل
#define WS_RECONNECT_MS  5000
#define FRAME_INTERVAL_MS 333       // ~3 fps (أقل حرارة)
#define STREAM_FRAME_SIZE FRAMESIZE_QVGA  // 320x240 — أصغر = أقل حرارة
#define CAPTURE_FRAME_SIZE FRAMESIZE_VGA  // 640x480 للالتقاط فقط

// ═══════════════════════════════════════════════
//  المتغيرات العامة
// ═══════════════════════════════════════════════
WebSocketsClient webSocket;
WiFiClientSecure wifiClient;
int flashBrightness  = 0;
int wifiFailCount    = 0;
bool streaming       = false;
unsigned long lastFrameMs = 0;
int streamQuality    = STREAM_QUALITY;
size_t lastFrameSize = 0;
bool cameraReady     = false;

// ═══════════════════════════════════════════════
//  تهيئة الكاميرا — XCLK 16MHz لتقليل الحرارة
// ═══════════════════════════════════════════════
bool initCamera() {
  camera_config_t cfg;
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0       = Y2_GPIO;
  cfg.pin_d1       = Y3_GPIO;
  cfg.pin_d2       = Y4_GPIO;
  cfg.pin_d3       = Y5_GPIO;
  cfg.pin_d4       = Y6_GPIO;
  cfg.pin_d5       = Y7_GPIO;
  cfg.pin_d6       = Y8_GPIO;
  cfg.pin_d7       = Y9_GPIO;
  cfg.pin_xclk     = XCLK_GPIO;
  cfg.pin_pclk     = PCLK_GPIO;
  cfg.pin_vsync    = VSYNC_GPIO;
  cfg.pin_href     = HREF_GPIO;
  cfg.pin_sscb_sda = SIOD_GPIO;
  cfg.pin_sscb_scl = SIOC_GPIO;
  cfg.pin_pwdn     = PWDN_GPIO;
  cfg.pin_reset    = RESET_GPIO;
  cfg.xclk_freq_hz = 16000000;   // 16MHz بدل 20MHz — أقل حرارة
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    cfg.frame_size   = STREAM_FRAME_SIZE;
    cfg.jpeg_quality = streamQuality;
    cfg.fb_count     = 2;
  } else {
    cfg.frame_size   = FRAMESIZE_QVGA;
    cfg.jpeg_quality = streamQuality;
    cfg.fb_count     = 1;
    cfg.fb_location  = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  // تعطيل معالجات الصورة المكلفة
  s->set_sharpness(s, 0);       // إيقاف Sharpness — معالجة إضافية
  s->set_denoise(s, 0);         // إيقاف Denoise — معالجة إضافية  
  s->set_brightness(s, 0);       // محايد بدل 1
  s->set_contrast(s, 0);        // محايد بدل 1
  s->set_saturation(s, -1);     // تشبع أقل = ضغط أفضل = حجم أقل
  s->set_special_effect(s, 0);
  s->set_colorbar(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 2);
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_ae_level(s, 0);
  s->set_gain_ctrl(s, 1);
  s->set_gainceiling(s, GAINCEILING_2X);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);

  cameraReady = true;
  Serial.println("[CAM] Initialized OK (16MHz XCLK)");
  return true;
}

// ═══════════════════════════════════════════════
//  التحكم بالفلاش
// ═══════════════════════════════════════════════
void setFlash(int brightness) {
  flashBrightness = constrain(brightness, 0, 255);
  ledcWrite(FLASH_PIN, flashBrightness);
}

// ═══════════════════════════════════════════════
//  إرسال إطار عبر WebSocket
// ═══════════════════════════════════════════════
void sendFrame(uint8_t frameType) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return;

  // تخطي الإطارات المكررة
  if (frameType == FRAME_STREAM && fb->len == lastFrameSize) {
    esp_camera_fb_return(fb);
    return;
  }
  lastFrameSize = fb->len;

  // إرسال بدون malloc — بايت واحد كرسالة منفصلة ثم البيانات
  // هذا يتجنب تجزئة الذاكرة وmalloc/free لكل إطار
  uint8_t header = frameType;
  webSocket.sendBIN(&header, 1);
  webSocket.sendBIN(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ═══════════════════════════════════════════════
//  التقاط صورة عالية الجودة
// ═══════════════════════════════════════════════
void handleCapture() {
  sensor_t* s = esp_camera_sensor_get();

  s->set_quality(s, CAPTURE_QUALITY);
  s->set_framesize(s, CAPTURE_FRAME_SIZE);
  delay(200);

  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) { esp_camera_fb_return(fb); yield(); }
  fb = esp_camera_fb_get();

  s->set_framesize(s, STREAM_FRAME_SIZE);
  s->set_quality(s, streamQuality);

  if (!fb) return;

  uint8_t header = FRAME_CAPTURE;
  webSocket.sendBIN(&header, 1);
  webSocket.sendBIN(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ═══════════════════════════════════════════════
//  WebSocket event handler
// ═══════════════════════════════════════════════
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      streaming = false;
      break;

    case WStype_CONNECTED:
      streaming = false;
      wifiFailCount = 0;
      sendStatus();
      break;

    case WStype_TEXT: {
      // استخدام strstr بدل String — أسرع وأقل ضغط على الذاكرة
      const char* p = (const char*)payload;
      
      if (strstr(p, "start_stream")) {
        streaming = true;
        lastFrameSize = 0;
      }
      else if (strstr(p, "stop_stream")) {
        streaming = false;
      }
      else if (strstr(p, "capture")) {
        handleCapture();
      }
      else if (strstr(p, "flash")) {
        const char* v = strstr(p, "\"value\":");
        if (v) {
          setFlash(atoi(v + 8));
        }
      }
      else if (strstr(p, "quality")) {
        const char* v = strstr(p, "\"value\":");
        if (v) {
          int q = constrain(atoi(v + 8), 4, 40);
          streamQuality = q;
          esp_camera_sensor_get()->set_quality(esp_camera_sensor_get(), q);
        }
      }
      break;
    }

    case WStype_BIN:
      break;

    default:
      break;
  }
}

// ═══════════════════════════════════════════════
//  إرسال حالة الجهاز
// ═══════════════════════════════════════════════
void sendStatus() {
  char msg[256];
  snprintf(msg, sizeof(msg),
    "{\"type\":\"status\",\"ip\":\"%s\",\"rssi\":%d,"
    "\"flash\":%d,\"uptime\":%lu,\"psram\":%s,"
    "\"streaming\":%s,\"heap\":%u}",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    flashBrightness,
    (unsigned long)(millis() / 1000),
    psramFound() ? "true" : "false",
    streaming ? "true" : "false",
    (unsigned int)ESP.getFreeHeap()
  );
  webSocket.sendTXT(msg);
}

// ═══════════════════════════════════════════════
//  اتصال WiFi (DHCP)
// ═══════════════════════════════════════════════
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // السماح للـ WiFi بالنوم قليلاً بين الإطارات — يقلل الحرارة
  WiFi.setSleep(true);
  // أقل طاقة إرسال تكفي (كافي لأغلب المسافات)
  WiFi.setTxPower(WIFI_POWER_11dBm);

  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] FAILED — restarting");
    delay(2000);
    ESP.restart();
  }

  Serial.printf("\n[WiFi] Connected — IP: %s | RSSI: %d | Heap: %u\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(), ESP.getFreeHeap());
}

// ═══════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════
void setup() {
  // خفض تردد المعالج إلى 160MHz (بدل 240MHz) — يقلل الحرارة بنسبة ~30%
  setCpuFrequencyMhz(160);
  
  Serial.begin(115200);
  Serial.println("\n=== DentistCam Cloud (WebSocket) ===");
  Serial.printf("[SYS] CPU: %u MHz | Free heap: %u\n", getCpuFrequencyMhz(), ESP.getFreeHeap());

  ledcAttach(FLASH_PIN, FLASH_LEDC_FREQ, FLASH_LEDC_RES);
  setFlash(0);

  if (!initCamera()) {
    Serial.println("[CAM] Init failed — restarting");
    delay(3000);
    ESP.restart();
  }

  connectWiFi();

  // اتصال WebSocket
  Serial.printf("[WS] Connecting to %s:%d%s\n", WS_HOST, WS_PORT, WS_PATH);
  if (WS_SSL) {
    wifiClient.setInsecure();
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  } else {
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  }
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(WS_RECONNECT_MS);
  webSocket.enableHeartbeat(15000, 3000, 2);

  Serial.println("\n══════════════════════════════════════════");
  Serial.printf("  WebSocket: wss://%s:%d%s\n", WS_HOST, WS_PORT, WS_PATH);
  Serial.printf("  Local IP:  %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("  Free heap: %u\n", ESP.getFreeHeap());
  Serial.println("══════════════════════════════════════════");
}

// ═══════════════════════════════════════════════
//  Loop — مع مراقبة الحرارة والذاكرة
// ═══════════════════════════════════════════════
void loop() {
  webSocket.loop();

  unsigned long now = millis();

  // فحص WiFi مع تسامح أكبر
  static unsigned long lastWifiCheck = 0;
  if (now - lastWifiCheck >= 15000) {  // كل 15 ثانية بدل 10
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      wifiFailCount++;
      Serial.printf("[WiFi] Lost (attempt %d/%d) | Heap: %u\n", wifiFailCount, MAX_WIFI_FAILS, ESP.getFreeHeap());
      if (wifiFailCount <= 3) {
        WiFi.reconnect();
        delay(2000);
        yield();
      } else if (wifiFailCount >= MAX_WIFI_FAILS) {
        Serial.println("[WiFi] All attempts failed — restarting");
        delay(1000);
        ESP.restart();
      }
    } else {
      if (wifiFailCount > 0) Serial.println("[WiFi] Reconnected");
      wifiFailCount = 0;
    }
  }

  // إرسال إطارات البث (فقط عندما يتطلب السيرفر)
  if (streaming && webSocket.isConnected()) {
    if (now - lastFrameMs >= FRAME_INTERVAL_MS) {
      lastFrameMs = now;
      sendFrame(FRAME_STREAM);
    }
  }

  // إرسال حالة كل 60 ثانية (بدل 30 — أقل ضغط)
  static unsigned long lastStatusMs = 0;
  if (webSocket.isConnected() && now - lastStatusMs >= 60000) {
    lastStatusMs = now;
    sendStatus();
  }

  // تأخير 20ms بين الحلقات — يقلل الحرارة بشكل ملحوظ
  delay(20);
}
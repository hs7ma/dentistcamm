/**
 * DentistCam Cloud - ESP32-CAM Firmware (WebSocket Mode)
 *
 * يتصل بخادم Railway عبر WebSocket ويبث الصور مباشرة.
 * لا يحتاج iPhone Hotspot — يعمل على أي شبكة WiFi.
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

// عنوان خادم Railway (بدون https:// وبدون wss://)
const char* WS_HOST = "dentistcamm-production.up.railway.app";
const int   WS_PORT = 443;
const char* WS_PATH = "/ws?role=camera";
const bool  WS_SSL  = true;

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
//  ثوابت البروتوكول
// ═══════════════════════════════════════════════
#define FRAME_STREAM  0x01
#define FRAME_CAPTURE  0x02

#define STREAM_QUALITY   15
#define CAPTURE_QUALITY  6
#define MAX_WIFI_FAILS   5
#define WS_RECONNECT_MS  5000
#define FRAME_INTERVAL_MS 66   // ~15 fps

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

// ═══════════════════════════════════════════════
//  تهيئة الكاميرا
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
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    cfg.frame_size   = FRAMESIZE_VGA;
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
  s->set_brightness(s, 1);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
  s->set_sharpness(s, 2);
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

  Serial.println("[CAM] Initialized OK");
  return true;
}

// ═══════════════════════════════════════════════
//  التحكم بالفلاش
// ═══════════════════════════════════════════════
void setFlash(int brightness) {
  flashBrightness = constrain(brightness, 0, 255);
  ledcWrite(FLASH_PIN, flashBrightness);
  Serial.printf("[FLASH] brightness=%d\n", flashBrightness);
}

// ═══════════════════════════════════════════════
//  إرسال إطار عبر WebSocket
// ═══════════════════════════════════════════════
void sendFrame(uint8_t frameType) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[FRAME] Capture failed");
    return;
  }

  size_t totalLen = 1 + fb->len;
  uint8_t* buf = (uint8_t*)malloc(totalLen);
  if (buf) {
    buf[0] = frameType;
    memcpy(buf + 1, fb->buf, fb->len);
    webSocket.sendBIN(buf, totalLen);
    free(buf);
  }
  esp_camera_fb_return(fb);
}

// ═══════════════════════════════════════════════
//  التقاط صورة عالية الجودة وإرسالها
// ═══════════════════════════════════════════════
void handleCapture() {
  sensor_t* s = esp_camera_sensor_get();
  s->set_quality(s, CAPTURE_QUALITY);

  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) { esp_camera_fb_return(fb); yield(); }
  fb = esp_camera_fb_get();

  s->set_quality(s, streamQuality);

  if (!fb) {
    Serial.println("[CAPTURE] Failed");
    return;
  }

  size_t totalLen = 1 + fb->len;
  uint8_t* buf = (uint8_t*)malloc(totalLen);
  if (buf) {
    buf[0] = FRAME_CAPTURE;
    memcpy(buf + 1, fb->buf, fb->len);
    webSocket.sendBIN(buf, totalLen);
    free(buf);
  }
  esp_camera_fb_return(fb);
  Serial.printf("[CAPTURE] Sent %zu bytes\n", fb->len);
}

// ═══════════════════════════════════════════════
//  WebSocket event handler
// ═══════════════════════════════════════════════
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      streaming = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[WS] Connected to %s\n", payload);
      streaming = false;
      wifiFailCount = 0;
      // إرسال حالة الجهاز فوراً
      sendStatus();
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.printf("[WS] Text: %s\n", (char*)payload);

      if (msg == "{\"cmd\":\"start_stream\"}" || msg.indexOf("start_stream") >= 0) {
        streaming = true;
        Serial.println("[WS] Streaming started");
      }
      else if (msg == "{\"cmd\":\"stop_stream\"}" || msg.indexOf("stop_stream") >= 0) {
        streaming = false;
        Serial.println("[WS] Streaming stopped");
      }
      else if (msg.indexOf("capture") >= 0) {
        handleCapture();
      }
      else if (msg.indexOf("flash") >= 0) {
        int valStart = msg.indexOf("\"value\":");
        if (valStart >= 0) {
          int val = msg.substring(valStart + 8).toInt();
          setFlash(val);
        }
      }
      else if (msg.indexOf("quality") >= 0) {
        int valStart = msg.indexOf("\"value\":");
        if (valStart >= 0) {
          int q = msg.substring(valStart + 8).toInt();
          q = constrain(q, 4, 40);
          streamQuality = q;
          sensor_t* s = esp_camera_sensor_get();
          s->set_quality(s, q);
          Serial.printf("[WS] Quality set to %d\n", q);
        }
      }
      break;
    }

    case WStype_BIN:
      // لا نتوقع بيانات ثنائية من السيرفر
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
    "\"streaming\":%s}",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    flashBrightness,
    (unsigned long)(millis() / 1000),
    psramFound() ? "true" : "false",
    streaming ? "true" : "false"
  );
  webSocket.sendTXT(msg);
}

// ═══════════════════════════════════════════════
//  اتصال WiFi (DHCP)
// ═══════════════════════════════════════════════
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

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

  Serial.printf("\n[WiFi] Connected — IP: %s | RSSI: %d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// ═══════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== DentistCam Cloud (WebSocket) ===");

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
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH, "", "arduino");
  } else {
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH, "arduino");
  }
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(WS_RECONNECT_MS);

  Serial.println("\n══════════════════════════════════════════");
  Serial.printf("  WebSocket: wss://%s:%d%s\n", WS_HOST, WS_PORT, WS_PATH);
  Serial.printf("  Local IP:  %s\n", WiFi.localIP().toString().c_str());
  Serial.println("══════════════════════════════════════════");
}

// ═══════════════════════════════════════════════
//  Loop
// ═══════════════════════════════════════════════
void loop() {
  webSocket.loop();

  // فحص WiFi
  static unsigned long lastWifiCheck = 0;
  unsigned long now = millis();
  if (now - lastWifiCheck >= 10000) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      wifiFailCount++;
      Serial.printf("[WiFi] Lost (attempt %d/%d)\n", wifiFailCount, MAX_WIFI_FAILS);
      if (wifiFailCount <= 2) {
        WiFi.reconnect();
        delay(3000);
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

  // إرسال إطارات البث
  if (streaming && webSocket.isConnected()) {
    if (now - lastFrameMs >= FRAME_INTERVAL_MS) {
      lastFrameMs = now;
      sendFrame(FRAME_STREAM);
    }
  }

  // إرسال حالة كل 30 ثانية
  static unsigned long lastStatusMs = 0;
  if (webSocket.isConnected() && now - lastStatusMs >= 30000) {
    lastStatusMs = now;
    sendStatus();
  }

  delay(5);
}
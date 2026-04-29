/**
 * DentistCam - ESP32-CAM Firmware (iPhone Hotspot Mode)
 *
 * يعمل كخادم HTTP محلي عبر iPhone Hotspot ويقدّم:
 *   GET  /           → معلومات الجهاز (JSON)
 *   GET  /stream     → MJPEG stream مباشر
 *   GET  /capture    → صورة JPEG واحدة عالية الجودة
 *   GET  /flash?v=N  → ضبط الفلاش (0-255)
 *   GET  /quality?v=N→ ضبط جودة JPEG (4-40)
 *
 * IP ثابت ومضمون: 172.20.10.10
 *   - يُضبط مباشرة قبل الاتصال بـ WiFi (بدون DHCP)
 *   - لا حاجة لإعادة ضبط الواجهة عند كل تشغيل
 *
 * المتطلبات على iPhone:
 *   - Personal Hotspot مفعّل
 *   - "Maximize Compatibility" مفعّل (2.4GHz لتوافق ESP32)
 *
 * المتطلبات (Library Manager):
 *   - ESP32 core by Espressif 3.x
 *
 * لوحة: AI-Thinker ESP32-CAM
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "esp_http_server.h"

// ─────────────────────────────────────────────
//  إعدادات WiFi — غيّر هذه القيم فقط
// ─────────────────────────────────────────────
const char* WIFI_SSID     = "Ahmed kh";
const char* WIFI_PASSWORD = "12345678";

// IP ثابت لـ iPhone hotspot (النطاق المسموح 172.20.10.2-14)
// 10 = بعيد عن 2 (أول توزيع DHCP) وعن 14 (آخر توزيع)
const uint8_t IPHONE_STATIC_OCTET = 10;

// ─────────────────────────────────────────────
//  ثوابت الأجهزة — AI-Thinker ESP32-CAM
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  LEDC للفلاش
// ─────────────────────────────────────────────
#define FLASH_LEDC_FREQ     1000
#define FLASH_LEDC_RES      8

// ─────────────────────────────────────────────
//  MJPEG stream boundary
// ─────────────────────────────────────────────
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY     = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART         = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ─────────────────────────────────────────────
//  المتغيرات العامة
// ─────────────────────────────────────────────
httpd_handle_t streamHttpd = NULL;  // منفذ 81 — MJPEG فقط
httpd_handle_t ctrlHttpd   = NULL;  // منفذ 80 — تحكم + status
int flashBrightness = 0;
int streamQuality   = 15;           // جودة JPEG للبث (أعلى = أصغر = أسلس)
const int CAPTURE_QUALITY = 6;      // جودة التقاط الصور (أقل = أعلى جودة)
const int MAX_WIFI_FAILS  = 5;      // عدد المحاولات الفاشلة قبل إعادة التشغيل
int wifiFailCount = 0;              // عداد فشل WiFi المتتالي

// ─────────────────────────────────────────────
//  تهيئة الكاميرا
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  التحكم بالفلاش
// ─────────────────────────────────────────────
void setFlash(int brightness) {
  flashBrightness = constrain(brightness, 0, 255);
  ledcWrite(FLASH_PIN, flashBrightness);
  Serial.printf("[FLASH] brightness=%d\n", flashBrightness);
}

// ─────────────────────────────────────────────
//  CORS helper
// ─────────────────────────────────────────────
static void setCorsHeaders(httpd_req_t* req) {
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, OPTIONS");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "*");
}

// ─────────────────────────────────────────────
//  Handler: GET /stream — MJPEG
// ─────────────────────────────────────────────
static esp_err_t streamHandler(httpd_req_t* req) {
  camera_fb_t* fb = NULL;
  esp_err_t res = ESP_OK;
  char partBuf[64];

  res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  setCorsHeaders(req);
  httpd_resp_set_hdr(req, "X-Framerate", "15");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[STREAM] Capture failed");
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    size_t hlen = snprintf(partBuf, sizeof(partBuf), STREAM_PART, fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, partBuf, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
    vTaskDelay(pdMS_TO_TICKS(33));
  }
  return res;
}

// ─────────────────────────────────────────────
//  Handler: GET /capture — صورة واحدة عالية الجودة
// ─────────────────────────────────────────────
static esp_err_t captureHandler(httpd_req_t* req) {
  sensor_t* s = esp_camera_sensor_get();
  s->set_quality(s, CAPTURE_QUALITY);

  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) { esp_camera_fb_return(fb); yield(); }
  fb = esp_camera_fb_get();

  s->set_quality(s, streamQuality);

  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  setCorsHeaders(req);
  esp_err_t res = httpd_resp_send(req, (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ─────────────────────────────────────────────
//  Handler: GET /flash?v=N
// ─────────────────────────────────────────────
static esp_err_t flashHandler(httpd_req_t* req) {
  char query[32] = {0};
  char valBuf[8] = {0};
  int brightness = 0;

  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    if (httpd_query_key_value(query, "v", valBuf, sizeof(valBuf)) == ESP_OK) {
      brightness = atoi(valBuf);
    }
  }

  setFlash(brightness);

  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  char resp[48];
  snprintf(resp, sizeof(resp), "{\"ok\":true,\"brightness\":%d}", flashBrightness);
  return httpd_resp_send(req, resp, strlen(resp));
}

// ─────────────────────────────────────────────
//  Handler: GET /quality?v=N
// ─────────────────────────────────────────────
static esp_err_t qualityHandler(httpd_req_t* req) {
  char query[32] = {0};
  char valBuf[8] = {0};
  int q = streamQuality;

  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    if (httpd_query_key_value(query, "v", valBuf, sizeof(valBuf)) == ESP_OK) {
      q = atoi(valBuf);
    }
  }
  q = constrain(q, 4, 40);
  streamQuality = q;
  sensor_t* s = esp_camera_sensor_get();
  s->set_quality(s, q);

  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  char resp[48];
  snprintf(resp, sizeof(resp), "{\"ok\":true,\"quality\":%d}", q);
  return httpd_resp_send(req, resp, strlen(resp));
}

// ─────────────────────────────────────────────
//  Handler: GET / — معلومات الجهاز
// ─────────────────────────────────────────────
static esp_err_t statusHandler(httpd_req_t* req) {
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);

  char resp[256];
  snprintf(resp, sizeof(resp),
    "{\"device\":\"DentistCam\",\"ip\":\"%s\",\"rssi\":%d,"
    "\"flash\":%d,\"uptime\":%lu,\"psram\":%s}",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    flashBrightness,
    (unsigned long)(millis() / 1000),
    psramFound() ? "true" : "false"
  );
  return httpd_resp_send(req, resp, strlen(resp));
}

// ─────────────────────────────────────────────
//  Handler: OPTIONS (CORS preflight)
// ─────────────────────────────────────────────
static esp_err_t optionsHandler(httpd_req_t* req) {
  setCorsHeaders(req);
  httpd_resp_set_status(req, "204 No Content");
  return httpd_resp_send(req, NULL, 0);
}

// ─────────────────────────────────────────────
//  تشغيل خوادم HTTP
// ─────────────────────────────────────────────
void startServers() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_uri_handlers = 8;
  config.stack_size = 8192;

  // ── خادم التحكم — منفذ 80 ──
  config.server_port = 80;
  config.ctrl_port   = 32768;
  if (httpd_start(&ctrlHttpd, &config) == ESP_OK) {
    httpd_uri_t statusUri   = { "/",        HTTP_GET, statusHandler,  NULL };
    httpd_uri_t captureUri  = { "/capture", HTTP_GET, captureHandler, NULL };
    httpd_uri_t flashUri    = { "/flash",   HTTP_GET, flashHandler,   NULL };
    httpd_uri_t qualityUri  = { "/quality", HTTP_GET, qualityHandler, NULL };
    httpd_uri_t optStatus   = { "/",        HTTP_OPTIONS, optionsHandler, NULL };
    httpd_uri_t optCapture  = { "/capture", HTTP_OPTIONS, optionsHandler, NULL };
    httpd_uri_t optFlash    = { "/flash",   HTTP_OPTIONS, optionsHandler, NULL };
    httpd_uri_t optQuality  = { "/quality", HTTP_OPTIONS, optionsHandler, NULL };
    httpd_register_uri_handler(ctrlHttpd, &statusUri);
    httpd_register_uri_handler(ctrlHttpd, &captureUri);
    httpd_register_uri_handler(ctrlHttpd, &flashUri);
    httpd_register_uri_handler(ctrlHttpd, &qualityUri);
    httpd_register_uri_handler(ctrlHttpd, &optStatus);
    httpd_register_uri_handler(ctrlHttpd, &optCapture);
    httpd_register_uri_handler(ctrlHttpd, &optFlash);
    httpd_register_uri_handler(ctrlHttpd, &optQuality);
    Serial.println("[HTTP] Control server on :80");
  }

  // ── خادم البث — منفذ 81 ──
  config.server_port = 81;
  config.ctrl_port   = 32769;
  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    httpd_uri_t streamUri = { "/stream", HTTP_GET, streamHandler, NULL };
    httpd_register_uri_handler(streamHttpd, &streamUri);
    Serial.println("[HTTP] Stream server  on :81");
  }
}

// ─────────────────────────────────────────────
//  إعداد IP ثابت لـ iPhone Hotspot
//  iPhone Hotspot دائماً يستخدم: 172.20.10.0/28
//    - Gateway: 172.20.10.1
//    - Subnet:  255.255.255.240 (/28)
//    - النطاق المسموح: 172.20.10.2 — 172.20.10.14
//  نضبط IP ثابت مباشرة قبل الاتصال — أسرع وأضمن
// ─────────────────────────────────────────────
void configureStaticIP() {
  // قيم iPhone Hotspot الثابتة (لا تتغير)
  IPAddress staticIP(172, 20, 10, IPHONE_STATIC_OCTET);  // 172.20.10.10
  IPAddress gateway (172, 20, 10, 1);
  IPAddress subnet  (255, 255, 255, 240);
  IPAddress dns     (8, 8, 8, 8);  // Google DNS

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // أداء أفضل للبث

  // ضبط IP الثابت قبل الاتصال — لا DHCP إطلاقاً
  if (!WiFi.config(staticIP, gateway, subnet, dns)) {
    Serial.println("[WiFi] Static IP config FAILED");
  } else {
    Serial.printf("[WiFi] Static IP set: %s\n", staticIP.toString().c_str());
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting to iPhone Hotspot");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] FAILED — restarting");
    Serial.println("[WiFi] تأكد من:");
    Serial.println("  1) iPhone Personal Hotspot مفعّل");
    Serial.println("  2) Maximize Compatibility (ON)");
    Serial.println("  3) WIFI_SSID و WIFI_PASSWORD صحيحان في الكود");
    delay(2000);
    ESP.restart();
  }

  Serial.printf("\n[WiFi] Connected — IP: %s | GW: %s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str());
}

// ─────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== DentistCam ESP32 (Local HTTP) ===");

  ledcAttach(FLASH_PIN, FLASH_LEDC_FREQ, FLASH_LEDC_RES);
  setFlash(0);

  if (!initCamera()) {
    Serial.println("[CAM] Init failed — restarting");
    delay(3000);
    ESP.restart();
  }

  configureStaticIP();
  startServers();

  Serial.println("\n══════════════════════════════════════════");
  Serial.printf("  Stream:  http://%s:81/stream\n",  WiFi.localIP().toString().c_str());
  Serial.printf("  Capture: http://%s/capture\n",     WiFi.localIP().toString().c_str());
  Serial.printf("  Status:  http://%s/\n",            WiFi.localIP().toString().c_str());
  Serial.println("══════════════════════════════════════════");
  Serial.printf("→ ضع هذا الـ IP في إعدادات التطبيق: %s\n",
                WiFi.localIP().toString().c_str());
  Serial.println();
}

// ─────────────────────────────────────────────
//  Loop — فحص WiFi فقط
// ─────────────────────────────────────────────
void loop() {
  static unsigned long lastCheck = 0;
  unsigned long now = millis();

  if (now - lastCheck >= 10000) {
    lastCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      wifiFailCount++;
      Serial.printf("[WiFi] Lost connection (attempt %d/%d)\n", wifiFailCount, MAX_WIFI_FAILS);

      if (wifiFailCount <= 2) {
        Serial.println("[WiFi] Trying reconnect...");
        WiFi.reconnect();
        delay(3000);
        yield();
        if (WiFi.status() == WL_CONNECTED) {
          wifiFailCount = 0;
          Serial.println("[WiFi] Reconnected successfully");
        }
      } else if (wifiFailCount < MAX_WIFI_FAILS) {
        Serial.println("[WiFi] Waiting for connection...");
        delay(2000);
        yield();
      } else {
        Serial.println("[WiFi] All attempts failed — restarting");
        delay(1000);
        ESP.restart();
      }
    } else {
      if (wifiFailCount > 0) {
        Serial.println("[WiFi] Connection restored");
      }
      wifiFailCount = 0;
    }
  }
  delay(100);
}

## ESP32 Environment Controller

This project provides a Node.js dashboard and firmware for an ESP32 board that reads temperature/humidity from a DHT22 sensor and controls four relays (fan, slide-door motor, water pump, heater). Relays can be managed automatically using configurable thresholds or overridden manually from the web interface.

---

### Project Structure

- `server.js` – Express backend that stores the most recent DHT22 readings, computes automatic relay states, and exposes REST endpoints for the ESP32 and web UI.
- `public/index.html` – Single-page dashboard that displays live telemetry, relay states, and allows manual overrides or threshold updates.
- `firmware/esp32_dht22_relay_controller.ino` – ESP32 (Arduino) sketch that reads the sensor, posts data to the backend, and applies relay commands.

---

### Requirements

- Node.js 18+ (LTS recommended)
- npm (bundled with Node.js)
- ESP32 board (e.g., ESP32 DevKit V1) with the Arduino IDE or PlatformIO toolchain
- DHT22 (AM2302) sensor
- 4-channel relay module compatible with 3.3V logic

---

### Backend Setup (Node.js)

1. Install dependencies:
   ```
   npm install
   ```
2. Create a `.env` file (optional) to override defaults:
   ```
   PORT=3000
   CORS_ORIGIN=http://localhost:3000
   FAN_ON_TEMP=30
   FAN_OFF_TEMP=28
   HEATER_ON_TEMP=20
   HEATER_OFF_TEMP=22
   PUMP_ON_HUMIDITY=40
   PUMP_OFF_HUMIDITY=55
   MOTOR_OPEN_TEMP=32
   MOTOR_CLOSE_TEMP=30
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open `http://localhost:3000` in a browser. When the ESP32 is online, the dashboard will show live readings and relay statuses.

---

### REST API Overview

- `POST /api/sensor` – ESP32 posts readings: `{ "temperature": 24.8, "humidity": 61.2, "deviceId": "my-esp32" }`
- `GET /api/relays` – ESP32 polls for relay commands; response includes `state` and `mode` per relay.
- `GET /api/status` – UI polling endpoint returning sensor snapshot, relay states, and thresholds.
- `POST /api/relays/:relayId` – UI override. Send `{ "mode": "manual", "state": true }` to force ON, or `{ "mode": "auto" }` to return to automatic control.
- `PUT /api/thresholds` – UI updates automation thresholds. Payload example:
  ```
  {
    "fan": { "on": 30, "off": 28, "comparison": "above" },
    "heater": { "on": 20, "off": 22, "comparison": "below" }
  }
  ```

---

### ESP32 Firmware

1. Open `firmware/esp32_dht22_relay_controller.ino` in the Arduino IDE (or copy into PlatformIO).
2. Install the required libraries via the Arduino Library Manager:
   - `DHT sensor library` (by Adafruit)
   - `Adafruit Unified Sensor`
   - `ArduinoJson`
3. Update the configuration block near the top:
   - `WIFI_SSID` and `WIFI_PASSWORD`
   - `API_BASE_URL` (e.g., `http://192.168.1.50:3000`)
   - `DEVICE_ID`
   - GPIO pins for the DHT22 data line and each relay
   - Set `RELAY_ACTIVE_HIGH` to match your relay board (most modules are active-low, which is the default)
4. Flash the firmware to your ESP32.
5. Monitor the Serial Console (115200 baud) to confirm Wi-Fi connection, sensor readings, and relay updates.

---

### Hardware Notes

- Power the DHT22 with 3.3V and use a 10K pull-up resistor between `VCC` and `DATA`.
- Use a dedicated 5V supply for the relay module if it draws significant current. Connect grounds between the ESP32 and relay board.
- Assign ESP32 GPIOs that support digital output (avoid strapping pins such as GPIO0, GPIO2, GPIO15 unless you understand the boot implications).

---

### Testing Tips

- Use the dashboard to toggle relays manually and verify that the ESP32 updates outputs immediately.
- Temporarily adjust thresholds to force automatic activation (e.g., lower the heater OFF threshold to observe state changes).
- Check the backend console logs for HTTP errors or invalid payloads.
- If running the server and ESP32 on different networks, configure port forwarding or VPN so the ESP32 can reach the API.

---

### Next Steps

- Secure the endpoints (API keys, token auth) before exposing them to untrusted networks.
- Persist historical readings and relay logs using a database (e.g., SQLite, InfluxDB).
- Add email/SMS alerts when sensor readings exceed safe limits.


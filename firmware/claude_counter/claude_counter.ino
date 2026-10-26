// Claude Usage Meter - USB serial mode
//
// Board settings (Tools menu): ESP32S3 Dev Module,
//   USB Mode: Hardware CDC and JTAG, USB CDC On Boot: Enabled
// With CDC On Boot enabled, Serial runs over the USB-C port, which is
// what bridge/serial-bridge.cjs writes to.

#include <Arduino_GFX_Library.h>
#include <ArduinoJson.h>

// Display pin configuration (Waveshare ESP32-S3-Touch-LCD-2)
#define PIN_LCD_SCLK 39
#define PIN_LCD_MOSI 38
#define PIN_LCD_MISO 40
#define PIN_LCD_DC   42
#define PIN_LCD_RST  -1
#define PIN_LCD_CS   45
#define PIN_LCD_BL   1

// Colors
#define BLACK   0x0000
#define WHITE   0xFFFF
#define RED     0xF800
#define GREEN   0x07E0
#define BLUE    0x001F
#define YELLOW  0xFFE0
#define ORANGE  0xFD20
#define GRAY    0x7BEF
#define DARK    0x2104

// Initialize display
Arduino_DataBus *bus = new Arduino_ESP32SPI(
  PIN_LCD_DC, PIN_LCD_CS, PIN_LCD_SCLK, PIN_LCD_MOSI, PIN_LCD_MISO);

Arduino_GFX *gfx = new Arduino_ST7789(
  bus, PIN_LCD_RST, 1 /* rotation */, true /* IPS */,
  240 /* width */, 320 /* height */);

// A rate-limit window; present is false when the bridge sends null
struct Window {
  bool present;
  float percent;
  uint32_t resetsAtEpoch;  // 0 if unknown
};

// State
Window fiveHour = {false, 0, 0};
Window sevenDay = {false, 0, 0};
int contextPercent = -1;     // -1 if unknown
uint32_t hostEpochAtRx = 0;  // host clock when the last message arrived (0 if not sent)
bool dataStale = true;
bool hasData = false;
unsigned long lastUpdate = 0;
unsigned long lastDraw = 0;

void setup() {
  Serial.setRxBufferSize(1024);  // default 256 can drop bytes from a full JSON line
  Serial.begin(115200);

  // Init display
  gfx->begin();
  pinMode(PIN_LCD_BL, OUTPUT);
  digitalWrite(PIN_LCD_BL, HIGH);

  gfx->fillScreen(BLACK);
  gfx->setTextSize(2);
  gfx->setCursor(40, 100);
  gfx->setTextColor(WHITE);
  gfx->println("Waiting for data...");
  gfx->setTextSize(1);
  gfx->setCursor(60, 140);
  gfx->setTextColor(GRAY);
  gfx->println("(via USB Serial)");

  delay(1000);
  Serial.println("Claude Meter READY");
}

void loop() {
  // Check for serial data
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.length() > 0 && line[0] == '{') {
      parseJson(line);
    }
  }

  // Mark as stale if no update in 60 seconds (redraw once on the transition)
  if (hasData && !dataStale && (millis() - lastUpdate > 60000)) {
    dataStale = true;
    drawUI();
  }

  // While stale, refresh every 30s so "Updated" and countdowns keep moving
  if (hasData && dataStale && (millis() - lastDraw > 30000)) {
    drawUI();
  }

  delay(10);
}

void parseWindow(JsonVariant v, Window &w) {
  if (v.isNull()) {
    w.present = false;
    return;
  }
  w.present = true;
  w.percent = v["usedPercent"].as<float>();
  w.resetsAtEpoch = v["resetsAtEpoch"].as<uint32_t>();
}

void parseJson(String json) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, json);

  if (error) {
    Serial.printf("JSON error: %s (%d bytes)\n", error.c_str(), json.length());
    return;
  }

  // Extract values; null windows show as "--" rather than keeping old numbers
  parseWindow(doc["fiveHour"], fiveHour);
  parseWindow(doc["sevenDay"], sevenDay);
  contextPercent = doc["context"].isNull() ? -1 : doc["context"]["usedPercent"].as<int>();
  hostEpochAtRx = doc["nowEpoch"].as<uint32_t>();
  dataStale = doc["stale"].as<bool>();

  hasData = true;
  lastUpdate = millis();

  Serial.printf("OK: 5hr=%s%.1f%%, 7day=%s%.1f%%\n",
    fiveHour.present ? "" : "(none) ", fiveHour.percent,
    sevenDay.present ? "" : "(none) ", sevenDay.percent);

  drawUI();
}

// Host clock estimate: last received epoch plus time since it arrived
uint32_t currentEpoch() {
  if (hostEpochAtRx == 0) return 0;
  return hostEpochAtRx + (millis() - lastUpdate) / 1000;
}

void formatRemaining(uint32_t resetsAt, char *buf, size_t len) {
  uint32_t now = currentEpoch();
  if (resetsAt == 0 || now == 0) {
    buf[0] = '\0';
    return;
  }
  if (resetsAt <= now) {
    snprintf(buf, len, "resets now");
    return;
  }

  unsigned long diff = resetsAt - now;
  unsigned long days = diff / 86400;
  unsigned long hours = (diff % 86400) / 3600;
  unsigned long minutes = (diff % 3600) / 60;

  if (days > 0) {
    snprintf(buf, len, "resets in %lud %luh", days, hours);
  } else if (hours > 0) {
    snprintf(buf, len, "resets in %luh %lum", hours, minutes);
  } else {
    snprintf(buf, len, "resets in %lum", minutes);
  }
}

void drawUI() {
  lastDraw = millis();
  gfx->fillScreen(BLACK);

  // Title
  gfx->setTextSize(2);
  gfx->setCursor(60, 15);
  gfx->setTextColor(WHITE);
  gfx->println("Claude Usage");

  // Status indicator
  uint16_t statusColor = dataStale ? ORANGE : GREEN;
  gfx->fillCircle(300, 20, 8, statusColor);

  // Connection mode
  gfx->setTextSize(1);
  gfx->setCursor(10, 18);
  gfx->setTextColor(GRAY);
  gfx->print("USB");

  // 5-Hour meter
  drawMeter(30, 60, "5 Hour", fiveHour);

  // 7-Day meter
  drawMeter(30, 140, "7 Day", sevenDay);

  // Footer: last update on the left, context (secondary) on the right
  gfx->setTextSize(1);
  gfx->setCursor(10, 220);
  gfx->setTextColor(GRAY);
  if (hasData) {
    int secAgo = (millis() - lastUpdate) / 1000;
    gfx->printf("Updated %ds ago", secAgo);
  } else {
    gfx->print("Waiting for data...");
  }

  if (contextPercent >= 0) {
    char ctx[16];
    snprintf(ctx, sizeof(ctx), "Ctx %d%%", contextPercent);
    gfx->setCursor(310 - strlen(ctx) * 6, 220);
    gfx->print(ctx);
  }
}

void drawMeter(int x, int y, const char* label, const Window &w) {
  int barWidth = 220;
  int barHeight = 30;
  float percent = constrain(w.percent, 0.0f, 100.0f);
  int fillWidth = (int)(barWidth * percent / 100.0);

  // Determine color based on percent
  uint16_t barColor = GREEN;
  if (w.percent >= 95) {
    barColor = RED;
  } else if (w.percent >= 80) {
    barColor = ORANGE;
  }

  // Label
  gfx->setTextSize(2);
  gfx->setCursor(x, y);
  gfx->setTextColor(WHITE);
  gfx->println(label);

  // Background bar
  gfx->fillRect(x, y + 25, barWidth, barHeight, DARK);

  if (!w.present) {
    gfx->setTextSize(2);
    gfx->setCursor(x + barWidth + 8, y + 28);
    gfx->setTextColor(GRAY);
    gfx->print("--");
    return;
  }

  // Reset countdown, right-aligned with the end of the bar
  char reset[24];
  formatRemaining(w.resetsAtEpoch, reset, sizeof(reset));
  if (reset[0]) {
    gfx->setTextSize(1);
    gfx->setTextColor(GRAY);
    gfx->setCursor(x + barWidth - strlen(reset) * 6, y + 6);
    gfx->print(reset);
  }

  // Fill bar
  if (fillWidth > 0) {
    gfx->fillRect(x, y + 25, fillWidth, barHeight, barColor);
  }

  // Percentage text
  gfx->setTextSize(2);
  gfx->setCursor(x + barWidth + 8, y + 28);
  gfx->setTextColor(barColor);
  gfx->printf("%.0f%%", w.percent);
}

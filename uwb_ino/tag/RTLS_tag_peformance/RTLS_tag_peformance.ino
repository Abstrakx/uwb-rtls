#include <SPI.h>
#include "DW1000Ranging.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "link.h"

#define EN_UWB 5
#define SPI_SCK 14
#define SPI_MISO 16
#define SPI_MOSI 18
#define DW_CS 33

const uint8_t PIN_RST = 7;
const uint8_t PIN_IRQ = 13;
const uint8_t PIN_SS = 33;

const char *ssid = "HUAWEI-0495";
const char *password = "MH83R8HFGR2";
const char *host = "192.168.8.152";   
const int port = 5000;

struct MyLink *uwb_data;
long runtime = 0;
String all_json = "";

void setup() {
  pinMode(EN_UWB, OUTPUT);
  digitalWrite(EN_UWB, HIGH);
  Serial.begin(115200);

  // ===== WiFi Connect =====
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected ✅");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  // ===== Init UWB =====
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);
  DW1000Ranging.initCommunication(PIN_RST, PIN_SS, PIN_IRQ);

  DW1000Ranging.attachNewRange(newRange);
  DW1000Ranging.attachNewDevice(newDevice);
  DW1000Ranging.attachInactiveDevice(inactiveDevice);

  DW1000.enableLedBlinking();
  DW1000.setGPIOMode(MSGP0, LED_MODE);

  // Jalankan sebagai TAG
  DW1000Ranging.startAsTag("6D:00:22:EA:82:60:3B:9C", DW1000.MODE_LONGDATA_RANGE_LOWPOWER);

  uwb_data = init_link();
  runtime = millis();
}

void loop() {
  DW1000Ranging.loop();

  // setiap 100ms kirim data JSON ke server Flask
  if ((millis() - runtime) > 100) {
    make_link_json(uwb_data, &all_json);
    send_http(&all_json);
    runtime = millis();
  }
}

void newRange() {
  fresh_link(uwb_data,
             DW1000Ranging.getDistantDevice()->getShortAddress(),
             DW1000Ranging.getDistantDevice()->getRange(),
             DW1000Ranging.getDistantDevice()->getRXPower());
}

void newDevice(DW1000Device *device) {
  Serial.print("New anchor detected: ");
  Serial.println(device->getShortAddress(), HEX);
  add_link(uwb_data, device->getShortAddress());
}

void inactiveDevice(DW1000Device *device) {
  Serial.print("Anchor inactive: ");
  Serial.println(device->getShortAddress(), HEX);
  delete_link(uwb_data, device->getShortAddress());
}

void send_http(String *msg_json) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String("http://") + host + ":" + port + "/uwb/update";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    int code = http.POST(*msg_json);
    if (code > 0) {
      Serial.printf("[HTTP] POST... code: %d\n", code);
    } else {
      Serial.printf("[HTTP] POST failed: %d\n", code);
    }
    http.end();
  } else {
    Serial.println("WiFi not connected ❌");
  }
}
#include <SPI.h>
#include "DW1000Ranging.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Preferences.h>
#include "link.h"

// ===== Pin Config =====
#define EN_UWB 5
#define SPI_SCK 14
#define SPI_MISO 16
#define SPI_MOSI 18
#define DW_CS 33

const uint8_t PIN_RST = 7;
const uint8_t PIN_IRQ = 13;
const uint8_t PIN_SS = 33;

// ===== WiFi & Server Config =====
const char *ssid = "HUAWEI-0495";
const char *password = "MH83R8HFGR2";

String serverIP = "192.168.8.141";   // Default
int serverPort = 5000;

// ===== Objects =====
WebServer server(80);
Preferences preferences;
struct MyLink *uwb_data;

long runtime = 0;
String all_json = "";

// ===== HTML PAGE =====
String htmlPage() {
  String page = "<html><head><title>UWB Config</title>"
                "<style>body{font-family:sans-serif;margin:30px;}input{margin:5px;padding:6px;}button{padding:8px;}</style>"
                "</head><body>"
                "<h2>RTLS UWB Tag Configuration</h2>"
                "<form action='/save' method='POST'>"
                "Server IP: <input name='ip' value='" + serverIP + "'><br>"
                "Server Port: <input name='port' value='" + String(serverPort) + "'><br>"
                "<button type='submit'>Confirm</button>"
                "</form>"
                "<p>Current IP: " + serverIP + ":" + String(serverPort) + "</p>"
                "</body></html>";
  return page;
}

// ===== Handlers =====
void handleRoot() {
  server.send(200, "text/html", htmlPage());
}

void handleSave() {
  if (server.hasArg("ip") && server.hasArg("port")) {
    serverIP = server.arg("ip");
    serverPort = server.arg("port").toInt();

    // Save to flash memory
    preferences.begin("uwb", false);
    preferences.putString("ip", serverIP);
    preferences.putInt("port", serverPort);
    preferences.end();

    server.send(200, "text/html",
                "<html><body><h3>✅ Saved!</h3>"
                "<p>New Server: " + serverIP + ":" + String(serverPort) + "</p>"
                "<a href='/'>Back</a></body></html>");
    Serial.printf("✅ New Server Config: %s:%d\n", serverIP.c_str(), serverPort);
  } else {
    server.send(400, "text/plain", "Missing arguments");
  }
}

void setup() {
  pinMode(EN_UWB, OUTPUT);
  digitalWrite(EN_UWB, HIGH);
  Serial.begin(115200);

  // ===== Load Saved Config =====
  preferences.begin("uwb", true);
  serverIP = preferences.getString("ip", serverIP);
  serverPort = preferences.getInt("port", serverPort);
  preferences.end();
  Serial.printf("Server target: %s:%d\n", serverIP.c_str(), serverPort);

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
  Serial.print("ESP IP: ");
  Serial.println(WiFi.localIP());

  // ===== Web Config Server =====
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.begin();
  Serial.println("Web config running at: http://" + WiFi.localIP().toString());

  // ===== Init UWB =====
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);
  DW1000Ranging.initCommunication(PIN_RST, PIN_SS, PIN_IRQ);
  DW1000Ranging.attachNewRange(newRange);
  DW1000Ranging.attachNewDevice(newDevice);
  DW1000Ranging.attachInactiveDevice(inactiveDevice);
  DW1000.enableLedBlinking();
  DW1000.setGPIOMode(MSGP0, LED_MODE);

  // Start as TAG
  DW1000Ranging.startAsTag("6D:00:22:EA:82:60:3B:9C",
                           DW1000.MODE_LONGDATA_RANGE_LOWPOWER);

  uwb_data = init_link();
  runtime = millis();
}

void loop() {
  DW1000Ranging.loop();
  server.handleClient();

  // every 100 ms send JSON data
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
    String url = "http://" + serverIP + ":" + String(serverPort) + "/uwb/update";
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

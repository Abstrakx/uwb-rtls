#include <SPI.h>
#include "DW1000Ranging.h"

// ===== Pin Config =====
#define EN_UWB 5
#define SPI_SCK 14
#define SPI_MISO 16
#define SPI_MOSI 18
#define DW_CS 33

const uint8_t PIN_RST = 7;
const uint8_t PIN_IRQ = 13;
const uint8_t PIN_SS  = 33;

// ===== Data Struktur untuk Anchor =====
struct AnchorData {
  float range;
  float rssi;
  unsigned long lastUpdate;
};

AnchorData anchors[20];
uint8_t anchorAddrList[20];
int anchorCount = 0;

unsigned long printTimer = 0;

void setup() {
  pinMode(EN_UWB, OUTPUT);
  digitalWrite(EN_UWB, HIGH);

  Serial.begin(115200);
  delay(500);
  Serial.println("Starting UWB Multi-Anchor Tag...");

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);

  DW1000Ranging.initCommunication(PIN_RST, PIN_SS, PIN_IRQ);
  DW1000Ranging.attachNewRange(newRange);
  DW1000Ranging.attachNewDevice(newDevice);
  DW1000Ranging.attachInactiveDevice(inactiveDevice);

  DW1000.enableLedBlinking();
  DW1000.setGPIOMode(MSGP0, LED_MODE);

  // Start TAG
  DW1000Ranging.startAsTag("6D:00:22:EA:82:60:3B:9C",
                            DW1000.MODE_LONGDATA_RANGE_LOWPOWER);

  Serial.println("UWB Tag Active...");
}

void loop() {
  DW1000Ranging.loop();

  // Print anchor list every 200ms
  if (millis() - printTimer > 200) {
    printAllAnchors();
    printTimer = millis();
  }
}

void newRange() {
  auto dev = DW1000Ranging.getDistantDevice();
  uint16_t addr = dev->getShortAddress();

  // cek apakah anchor sudah ada di list
  int idx = findAnchorIndex(addr);
  if (idx == -1) return;  // safety

  anchors[idx].range = dev->getRange();
  anchors[idx].rssi = dev->getRXPower();
  anchors[idx].lastUpdate = millis();
}

void newDevice(DW1000Device *device) {
  uint16_t addr = device->getShortAddress();
  if (findAnchorIndex(addr) == -1) {
    anchorAddrList[anchorCount] = addr;
    anchors[anchorCount].range = -1;
    anchors[anchorCount].rssi = -999;
    anchors[anchorCount].lastUpdate = 0;
    anchorCount++;

    Serial.print("New Anchor detected: ");
    Serial.println(addr, HEX);
  }
}

void inactiveDevice(DW1000Device *device) {
  uint16_t addr = device->getShortAddress();
  Serial.print("Anchor inactive: ");
  Serial.println(addr, HEX);
}

int findAnchorIndex(uint16_t addr) {
  for (int i = 0; i < anchorCount; i++) {
    if (anchorAddrList[i] == addr) return i;
  }
  return -1;
}

void printAllAnchors() {
  if (anchorCount == 0) return;

  Serial.println("===== UWB DATA =====");

  for (int i = 0; i < anchorCount; i++) {
    uint16_t addr = anchorAddrList[i];

    char addrStr[6];
    sprintf(addrStr, "%X", addr);

    // tampilkan hanya anchor aktif 1 detik terakhir
    if (millis() - anchors[i].lastUpdate < 1200) {
      Serial.printf("%s | range: %.2f m | rssi: %.2f dBm\n",
                    addrStr,
                    anchors[i].range,
                    anchors[i].rssi);
    } else {
      Serial.printf("%s | inactive\n", addrStr);
    }
  }

  Serial.println("====================");
}

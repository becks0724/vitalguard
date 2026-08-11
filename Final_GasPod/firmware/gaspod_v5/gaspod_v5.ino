#include <Wire.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoOTA.h>
#include "DFRobot_OxygenSensor.h"
#include <Adafruit_BME280.h>

#define PIN_MQ7   1
#define PIN_MQ136 2
#define PIN_LED_R 4
#define PIN_LED_Y 5
#define PIN_VBAT  7
#define PIN_BUZZ  10

// ── 시연용 임계값 (v5: MQ7 하향 — 향 연기 반응) ──
#define O2_WARN 19.2
#define O2_ALARM 18.5
#define MQ7_WARN 150
#define MQ7_ALARM 350
#define MQ136_WARN 1800
#define MQ136_ALARM 2200
#define VBAT_WARN 3.2
#define VBAT_CRIT 3.0
#define VBAT_CAL 2.106        // 분압(100k+100k) 배율+ADC 보정 — 2026-07-31 충전 CV 플래토(서버 3.988V=실제 4.20V) 기준, 104 캡 장착 상태
#define BEEP_MS 5000          // 경보 시 부저 지속시간

const char* SERVER_URL = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/gaspod/telemetry";
const char* DEVICE_ID  = "gaspod-01";
// 서버 수신 인증 토큰 — 서버 APP_UPLOAD_TOKEN 과 동일 값. 플래시 직전 실제 값으로 교체(리포 커밋 시 마스킹).
// 서버가 GASPOD_REQUIRE_TOKEN=true 로 켜지면 이 헤더 없는 요청은 401. 켜기 전이면 없어도 수신됨(soft).
const char* UPLOAD_TOKEN = "<APP_UPLOAD_TOKEN>";
const unsigned long POST_INTERVAL = 5000;

WiFiMulti wifiMulti;
DFRobot_OxygenSensor o2s;
Adafruit_BME280 bme;
bool o2ok=false,bmeok=false,acked=false,blinkOn=false;
bool muted=false;                       // ★ v5: 기본 소리 ON
unsigned long lastRead=0,lastBlink=0,beepUntil=0,lastPost=0;
float o2=21.0,t=0,rh=0,p=0,vbat=0; int mq7=0,mq136=0;
String lastState="CLEAR";
bool wasAlarm=false;

bool isAlarm(){ return (o2ok&&o2>0&&o2<O2_ALARM)||mq7>MQ7_ALARM||mq136>MQ136_ALARM; }
bool isWarn(){  return (o2ok&&o2>0&&o2<O2_WARN) ||mq7>MQ7_WARN ||mq136>MQ136_WARN; }
String stateStr(){ return isAlarm()?"DANGER":(isWarn()?"WARNING":"CLEAR"); }

float readVbat(){
  long s=0; for(int i=0;i<8;i++){ s+=analogReadMilliVolts(PIN_VBAT); delay(2); }
  return (s/8)/1000.0*VBAT_CAL;
}

void postTelemetry(){
  if(WiFi.status()!=WL_CONNECTED) return;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http; http.setTimeout(4000);
  if(!http.begin(client, SERVER_URL)) return;
  http.addHeader("Content-Type","application/json");
  http.addHeader("x-app-upload-token", UPLOAD_TOKEN);  // 서버 수신 인증(정적 토큰)
  char body[360];
  snprintf(body,sizeof(body),
    "{\"device_id\":\"%s\",\"o2\":%.1f,\"temp\":%.1f,\"humidity\":%.0f,\"pressure\":%.1f,"
    "\"mq7_raw\":%d,\"mq136_raw\":%d,\"vbat\":%.2f,\"state\":\"%s\",\"acked\":%s}",
    DEVICE_ID,o2,t,rh,p,mq7,mq136,vbat,stateStr().c_str(),acked?"true":"false");
  int code=http.POST(body);
  Serial.printf("[net] POST %d\n",code);
  http.end();
}

void setup(){
  Serial.begin(115200);
  Wire.begin(8,9);
  analogReadResolution(12);
  pinMode(PIN_LED_R,OUTPUT); pinMode(PIN_LED_Y,OUTPUT);
  pinMode(PIN_BUZZ,OUTPUT); digitalWrite(PIN_BUZZ,LOW);
  o2ok=o2s.begin(ADDRESS_3);
  bmeok=bme.begin(0x76,&Wire);
  wifiMulti.addAP("<WIFI_SSID_1>","<WIFI_PW_1>");
  wifiMulti.addAP("<WIFI_SSID_2>","<WIFI_PW_2>");
  wifiMulti.addAP("<WIFI_SSID_3>","<WIFI_PW_3>");
  wifiMulti.addAP("<WIFI_SSID_4>","<WIFI_PW_4>");   // 발표장 폰 테더링 (2.4GHz 필수)
  wifiMulti.addAP("<WIFI_SSID_5>","<WIFI_PW_5>");   // 작업장 공유기 (2026-08-03)
  Serial.printf("\n[init] O2=%s BME=%s | v5 시연판 (부저ON·MQ7 150/350·OTA·ACK없음)\n",o2ok?"OK":"FAIL",bmeok?"OK":"FAIL");
  Serial.print("[wifi] 접속 중");
  for(int i=0;i<20 && wifiMulti.run()!=WL_CONNECTED;i++){ Serial.print("."); delay(500); }
  if(WiFi.status()==WL_CONNECTED){
    Serial.printf("\n[wifi] %s 연결 (%s)\n",WiFi.SSID().c_str(),WiFi.localIP().toString().c_str());
    ArduinoOTA.setHostname("gaspod-01");
    ArduinoOTA.setPassword("<OTA_PASSWORD>");
    ArduinoOTA.begin();
    Serial.println("[ota] 무선 업데이트 대기 (hostname: gaspod-01)");
  } else Serial.println("\n[wifi] 실패 — 오프라인 모드");
  digitalWrite(PIN_LED_R,HIGH); digitalWrite(PIN_LED_Y,HIGH); delay(800);
  digitalWrite(PIN_LED_R,LOW); digitalWrite(PIN_LED_Y,LOW);
}

void loop(){
  ArduinoOTA.handle();

  // 와이파이 재시도(10초마다) — 핫스팟을 늦게 켜도 자동 접속
  static unsigned long lastWifiTry=0; static bool otaInit=false;
  if(WiFi.status()!=WL_CONNECTED && millis()-lastWifiTry>10000){
    lastWifiTry=millis();
    if(wifiMulti.run()==WL_CONNECTED){
      Serial.printf("[wifi] %s 연결 (%s)\n",WiFi.SSID().c_str(),WiFi.localIP().toString().c_str());
      if(!otaInit){ ArduinoOTA.setHostname("gaspod-01"); ArduinoOTA.setPassword("<OTA_PASSWORD>"); ArduinoOTA.begin(); otaInit=true; }
    }
  }

  while(Serial.available()){
    char c=Serial.read();
    if(c=='b'){ beepUntil=millis()+300; Serial.println("[cmd] 시험음"); }
    else if(c=='m'){ muted=!muted; Serial.printf("[cmd] 음소거=%s\n",muted?"ON":"OFF"); }
  }

  if(millis()-lastRead>2000){
    lastRead=millis();
    o2=o2ok?o2s.getOxygenData(3):-1;
    t=bmeok?bme.readTemperature():-1;
    rh=bmeok?bme.readHumidity():-1;
    p=bmeok?bme.readPressure()/100.0f:-1;
    mq7=analogRead(PIN_MQ7);
    mq136=analogRead(PIN_MQ136);
    vbat=readVbat();
    if(!isAlarm()){ acked=false; }
    // ★ 경보 진입 순간: 부저 5초 시작 (ACK·음소거 아니면)
    if(isAlarm()&&!wasAlarm){ if(!muted&&!acked) beepUntil=millis()+BEEP_MS; }
    wasAlarm=isAlarm();
    digitalWrite(PIN_LED_Y,isWarn()&&!isAlarm());
    const char* bs=vbat<0.5?"미연결":(vbat<VBAT_CRIT?"!!방전임박!!":(vbat<VBAT_WARN?"!저전압!":"OK"));
    Serial.printf("O2:%.1f%% T:%.1fC RH:%.0f%% | MQ7:%d MQ136:%d | VBAT:%.2fV(%s) | %s%s%s\n",
      o2,t,rh,mq7,mq136,vbat,bs,stateStr().c_str(),(isAlarm()&&acked)?" [ACK]":"",muted?" [무음]":"");
    if(stateStr()!=lastState){ lastState=stateStr(); postTelemetry(); lastPost=millis(); }
  }

  if(millis()-lastPost>POST_INTERVAL){ lastPost=millis(); postTelemetry(); }

  if(isAlarm()){
    if(acked) digitalWrite(PIN_LED_R,HIGH);
    else if(millis()-lastBlink>250){ lastBlink=millis(); blinkOn=!blinkOn; digitalWrite(PIN_LED_R,blinkOn); }
  } else digitalWrite(PIN_LED_R,LOW);

  // 부저: 경보 진입 후 5초간 (ACK 시 즉시 중단)
  digitalWrite(PIN_BUZZ, (millis()<beepUntil && !acked) ? HIGH : LOW);
}

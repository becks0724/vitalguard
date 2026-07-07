#include <Wire.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "DFRobot_OxygenSensor.h"
#include <Adafruit_BME280.h>

#define PIN_MQ7   1
#define PIN_MQ136 2
#define PIN_LED_R 4
#define PIN_LED_Y 5
#define PIN_BTN   6
#define PIN_VBAT  7
#define PIN_BUZZ  10

#define O2_WARN 19.2
#define O2_ALARM 18.5
#define MQ7_WARN 500
#define MQ7_ALARM 1000
#define MQ136_WARN 1800
#define MQ136_ALARM 2200
#define VBAT_WARN 3.2
#define VBAT_CRIT 3.0

const char* SERVER_URL = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/gaspod/telemetry";
const char* DEVICE_ID  = "gaspod-01";
const unsigned long POST_INTERVAL = 5000;

WiFiMulti wifiMulti;
DFRobot_OxygenSensor o2s;
Adafruit_BME280 bme;
bool o2ok=false,bmeok=false,acked=false,blinkOn=false,muted=true;
unsigned long lastRead=0,lastBlink=0,beepUntil=0,lastPost=0;
float o2=21.0,t=0,rh=0,p=0,vbat=0; int mq7=0,mq136=0;
String lastState="CLEAR";

bool isAlarm(){ return (o2ok&&o2>0&&o2<O2_ALARM)||mq7>MQ7_ALARM||mq136>MQ136_ALARM; }
bool isWarn(){  return (o2ok&&o2>0&&o2<O2_WARN) ||mq7>MQ7_WARN ||mq136>MQ136_WARN; }
String stateStr(){ return isAlarm()?"DANGER":(isWarn()?"WARNING":"CLEAR"); }

float readVbat(){
  long s=0; for(int i=0;i<8;i++){ s+=analogReadMilliVolts(PIN_VBAT); delay(2); }
  return (s/8)/1000.0*2.0;
}

void postTelemetry(){
  if(WiFi.status()!=WL_CONNECTED) return;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setTimeout(4000);
  if(!http.begin(client, SERVER_URL)) { Serial.println("[net] begin 실패"); return; }
  http.addHeader("Content-Type","application/json");
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
  pinMode(PIN_BTN,INPUT_PULLUP);
  o2ok=o2s.begin(ADDRESS_3);
  bmeok=bme.begin(0x76,&Wire);
  // WiFi AP 2개 — 실제 SSID/비밀번호는 팀 채널 참조(리포 커밋 시 자격증명 마스킹).
  wifiMulti.addAP("<WIFI_SSID_1>","<WIFI_PW_1>");
  wifiMulti.addAP("<WIFI_SSID_2>","<WIFI_PW_2>");
  Serial.printf("\n[init] O2=%s BME=%s | v4 (WiFi+서버전송)\n",o2ok?"OK":"FAIL",bmeok?"OK":"FAIL");
  Serial.print("[wifi] 접속 중");
  for(int i=0;i<20 && wifiMulti.run()!=WL_CONNECTED;i++){ Serial.print("."); delay(500); }
  if(WiFi.status()==WL_CONNECTED) Serial.printf("\n[wifi] %s 연결 (%s)\n",WiFi.SSID().c_str(),WiFi.localIP().toString().c_str());
  else Serial.println("\n[wifi] 실패 — 오프라인 모드(경보는 정상 동작, 전송만 스킵)");
  digitalWrite(PIN_LED_R,HIGH); digitalWrite(PIN_LED_Y,HIGH); delay(800);
  digitalWrite(PIN_LED_R,LOW); digitalWrite(PIN_LED_Y,LOW);
}

void loop(){
  while(Serial.available()){
    char c=Serial.read();
    if(c=='b'){ beepUntil=millis()+300; Serial.println("[cmd] 시험음"); }
    else if(c=='m'){ muted=!muted; Serial.printf("[cmd] 음소거=%s\n",muted?"ON":"OFF"); }
  }

  static unsigned long btnT=0;
  if(digitalRead(PIN_BTN)==LOW && millis()-btnT>300){
    btnT=millis();
    if(isAlarm()&&!acked){ acked=true; Serial.println(">>> ACK"); postTelemetry(); }
    else if(isAlarm()) Serial.println(">>> 버튼 (이미 ACK)");
    else Serial.println(">>> 버튼 (경보 없음)");
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
    if(!isAlarm()) acked=false;
    digitalWrite(PIN_LED_Y,isWarn()&&!isAlarm());
    const char* bs=vbat<0.5?"미연결":(vbat<VBAT_CRIT?"!!방전임박!!":(vbat<VBAT_WARN?"!저전압!":"OK"));
    Serial.printf("O2:%.1f%% T:%.1fC RH:%.0f%% | MQ7:%d MQ136:%d | VBAT:%.2fV(%s) | %s%s%s\n",
      o2,t,rh,mq7,mq136,vbat,bs,stateStr().c_str(),(isAlarm()&&acked)?" [ACK]":"",muted?" [무음]":"");
    // 상태 변화 시 즉시 전송
    if(stateStr()!=lastState){ lastState=stateStr(); postTelemetry(); lastPost=millis(); }
  }

  if(millis()-lastPost>POST_INTERVAL){ lastPost=millis(); postTelemetry(); }

  if(isAlarm()){
    if(acked) digitalWrite(PIN_LED_R,HIGH);
    else if(millis()-lastBlink>250){ lastBlink=millis(); blinkOn=!blinkOn; digitalWrite(PIN_LED_R,blinkOn); }
  } else digitalWrite(PIN_LED_R,LOW);

  if(millis()<beepUntil) digitalWrite(PIN_BUZZ,HIGH);
  else if(isAlarm()&&!acked&&!muted) digitalWrite(PIN_BUZZ,blinkOn);
  else digitalWrite(PIN_BUZZ,LOW);
}

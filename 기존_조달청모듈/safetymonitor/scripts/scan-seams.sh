#!/usr/bin/env bash
# 런타임 경계 호출 지점을 grep 으로 다시 뽑아 docs/seams-callsites.md 를 갱신한다.
#
# ★ 이 스크립트가 존재하는 이유 = **코드가 바뀌면 줄 번호가 바뀐다.**
#   손으로 grep 해서 문서에 적으면 다음 커밋에 바로 낡는다. 색인은 기계가 뽑아야 한다.
#
# 원칙 셋.
#   ① 찾은 것만 적는다 — 추정·설계 의도는 이 스크립트가 만들지 않는다.
#   ② 0 옆에는 통제군을 함께 낸다 — "없다" 와 "조회가 눈멀었다" 는 같은 0으로 보인다.
#      ★ 통제군은 본문과 **같은 자**로 재야 한다(L-98③). 붙이기만 하고 폭이 좁으면
#        구실을 못 한다 — 실측 2건: `from "pg"` 만 봐서 1 vs 본문 3(2026-08-20) ·
#        console.error 표본으로 console.warn 0건을 뒷받침(2026-08-21).
#        그래서 아래 통제군은 본문과 같은 g()/files() 로 뽑는다.
#      ★ 통제군은 **양성**이어야 한다(L-109 가 아니라 L-108) — "있어야 정상인 것" 을 센다.
#        가짜 심볼처럼 **없어야 정상인 것**은 조회가 눈멀어도 0이라 아무것도 못 가른다.
#        판정식 = "조회가 완전히 망가졌다면 이 통제군은 어떤 값을 내나?" 본 조회와 같으면 통제군이 아니다.
#   ③ 넓힌 검색의 결과는 **판정하지 않고 그대로 보인다**(오탐일 수 있다 · 사람이 읽는다).
#
# 사용.  scripts/scan-seams.sh            docs/seams-callsites.md 갱신
#        scripts/scan-seams.sh -          표준출력으로만(파일 안 건드림)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SM="$(cd "$HERE/.." && pwd)"          # 기존_조달청모듈/safetymonitor
ROOT="$(cd "$SM/../.." && pwd)"       # 레포 루트 (Final_GasPod · apps/VitAlGuard-* 가 여기 있다)
OUT="$SM/docs/seams-callsites.md"
[ "${1:-}" = "-" ] && OUT=/dev/stdout

cd "$ROOT"

# 공통 제외. ⚠ 변수 하나에 몰아넣고 전개하면 zsh/bash 에서 깨진다 — 함수로 고정한다.
g() { grep -rn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=Pods \
        --exclude-dir=build --exclude-dir=dist --exclude-dir=.git --exclude-dir=__pycache__ \
        --exclude-dir=.dart_tool --exclude-dir=DerivedData --exclude-dir=ephemeral "$@" 2>/dev/null; }
n() { g "$@" | wc -l | tr -d ' '; }
files() { g -l "$@" | wc -l | tr -d ' '; }

SMR="기존_조달청모듈/safetymonitor"
APP="$SMR/apps/vitalguard_app"
WEB="$SMR/apps/dashboard-web"

{
cat <<HEADER
# 런타임 경계 호출 지점 색인

**이 파일은 \`scripts/scan-seams.sh\` 가 생성한다. 손으로 고치지 말 것** — 다음 실행에 덮인다.
고쳐야 할 것이 있으면 스크립트를 고친다.

grep 으로 실제 코드에서 찾은 것만 적는다. 추정·설계 의도는 넣지 않는다.
없는 것은 0으로 적되 **그 조회가 눈멀지 않았음을 보이는 통제군**을 옆에 둔다.

- 생성 = \`scripts/scan-seams.sh\` (에이전트는 \`/graph-scan\`)
- 기준 커밋 = \`$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')\`
- 제외 = node_modules · .next · Pods · build · dist · __pycache__ · .dart_tool · DerivedData

> 이음새의 **성격·계약·실패 양상**은 \`docs/seams.md\` 에 있다. 이 파일은 **줄 번호 색인**이다.

---
HEADER

# ── 1. HTTP ──────────────────────────────────────────────────────────
echo
echo '## 1. HTTP'
echo
echo '### 1-1. Swift(폰) → 관제 서버'
echo
echo '```'
g -E "URLRequest\(url:|URLSession\.shared\.(data|upload)" --include='*.swift' "$APP/ios" | sed "s|$APP/ios/||"
echo '```'

echo
echo '### 1-2. Dart(폰 UI) → 서버'
echo
DART_HTTP=$(n -E "http\.(get|post|put|delete)|HttpClient|Dio\(" --include='*.dart' "$APP/lib")
echo '```'
echo "직접 호출: ${DART_HTTP}건"
if [ "$DART_HTTP" -eq 0 ]; then
  echo "pubspec http/dio/chopper 의존: $(grep -cE '^\s+(http|dio|chopper):' "$APP/pubspec.yaml" || echo 0)건"
  echo "[통제군] *.dart 에서 import 가 잡히는 파일: $(files 'import' --include='*.dart' "$APP/lib")개"
fi
echo '```'

echo
echo '### 1-3. Python(젯슨 엣지) → cctv-ai · 카메라 기기'
echo
echo '```'
g -E "urlopen|requests\.(get|post)|urllib\.request\.Request" --include='*.py' "$SMR/cctv-ai" "$SMR/ml" | sed "s|$SMR/||"
echo '```'

echo
echo '### 1-4. Arduino(ESP32) → 관제 서버'
echo
echo '```'
g -E "http\.begin|http\.POST|http\.GET|WiFiClientSecure|setInsecure" --include='*.ino' Final_GasPod
echo '```'

echo
echo '### 1-5. TS(관제 서버) → 외부 서비스 — 호스트 상수 정의 지점'
echo
echo '```'
g -oE "\"https://[a-z0-9.-]+" --include='*.ts' "$WEB/lib" "$WEB/app" \
  | grep -v '\.test\.' | sed "s|$WEB/||" | sort -u -t: -k3
echo '```'

echo
echo '### 1-6. 브라우저 → cctv-ai (서버를 안 거친다)'
echo
echo '```'
g -E "NEXT_PUBLIC_AI_CCTV_API|aiApi:" --include='*.tsx' "$WEB/app" | sed "s|$WEB/||"
echo '```'

echo
echo '### 1-7. Cloud Scheduler → 서버 (받는 쪽만 코드에 있다)'
echo
echo '```'
g -E "cronAuth\(|x-cron-key" --include='*.ts' "$WEB/app/api/cron" | sed "s|$WEB/||"
echo '```'

# ── 2. WCSession ─────────────────────────────────────────────────────
echo
echo '## 2. WCSession (워치 ↔ 폰)'
echo
echo '### 현행 앱 — apps/vitalguard_app'
echo
echo '```'
g -E "WCSession\.default\.activate|\.sendMessage\(|\.transferUserInfo\(|\.updateApplicationContext\(|didReceiveMessage|didReceiveUserInfo|didReceiveApplicationContext" \
  --include='*.swift' "$APP/ios" | sed "s|$APP/ios/||"
echo '```'
echo
OLD_WC=$(n -E "\.sendMessage\(|\.transferUserInfo\(|\.updateApplicationContext\(" --include='*.swift' apps 2>/dev/null)
echo "⚠ 구 앱 트리(\`apps/VitAlGuard-*\`)에도 같은 API 가 **${OLD_WC}건** 있다."
echo "   어느 트리가 살아 있는지는 코드로 안 갈린다 — 셋 다 git 추적 중이다."

# ── 3. Swift ↔ Dart 채널 ─────────────────────────────────────────────
echo
echo '## 3. Swift ↔ Dart 채널'
echo
echo '```'
g -E "FlutterMethodChannel\(|FlutterEventChannel\(|MethodChannel\(|EventChannel\(" \
  --include='*.swift' --include='*.dart' "$APP/ios/Runner" "$APP/lib" | sed "s|$APP/||"
echo '```'
echo
echo '계약은 **채널 이름 문자열**뿐이다. 양쪽을 잇는 타입 검사가 없다.'

# ── 4. DB ────────────────────────────────────────────────────────────
echo
echo '## 4. DB 클라이언트'
echo
echo '```'
g -E "new Pool\(|new Client\(|from \"pg\"" --include='*.ts' --include='*.mjs' \
  "$WEB/lib" "$WEB/app" "$SMR/scripts" "$SMR/ml" | grep -v '\.test\.' | sed "s|$SMR/||"
echo '```'
echo
echo "\`lib/db.ts\` 안 \`.query(\` : $(grep -c '\.query(' "$WEB/lib/db.ts")곳"
echo "그 밖에서 \`pool.query\`/\`client.query\` : $(g -E 'pool\.query|client\.query' --include='*.ts' "$WEB/app" "$WEB/lib" | grep -v 'lib/db.ts' | grep -cv '\.test\.')곳"

# ── 5. 없는 것 + 통제군 ──────────────────────────────────────────────
echo
echo '## 5. 없는 것 — 0건과 통제군'
echo

zero() {  # $1=라벨  $2=패턴  $3.. = --include 들
  local label="$1" pat="$2"; shift 2
  local c; c=$(n -E "$pat" "$@" .)
  echo "### $label — ${c}건"
  echo
  if [ "$c" -gt 0 ]; then echo '```'; g -E "$pat" "$@" . | head -10; echo '```'; fi
}

zero "BLE" "CoreBluetooth|CBCentralManager|CBPeripheral|flutter_blue|blue_plus|BLEDevice|NimBLE|BLEServer|BLECharacteristic" \
     --include='*.swift' --include='*.dart' --include='*.ino'
echo '**통제군** — 같은 대상 파일에서 있는 것을 찾으면 나온다.'
echo '```'
echo "*.swift 에서 import : $(files 'import' --include='*.swift' .)개 파일"
echo "*.dart  에서 import : $(files 'import' --include='*.dart' .)개 파일"
echo "*.ino   에서 WiFi   : $(files 'WiFi' --include='*.ino' .)개 파일"
echo '```'
echo
BLE_WIDE=$(n -iE "bluetooth|gatt" --include='*.swift' --include='*.dart' --include='*.ino' .)
echo "⚠ 대소문자 무시 \`bluetooth|gatt\` 로 넓히면 **${BLE_WIDE}건** — 판정하지 않고 그대로 보인다."
if [ "$BLE_WIDE" -gt 0 ]; then
  echo '```'
  g -iE "bluetooth|gatt" --include='*.swift' --include='*.dart' --include='*.ino' . | head -6
  echo '```'
fi
echo

zero "큐 publish/subscribe" "mqtt|MQTT|AWSIoT|IoTDataPlane|@google-cloud/pubsub|bullmq|amqp|new Redis" \
     --include='*.ts' --include='*.mjs' --include='*.py' --include='*.swift' --include='*.dart'
echo '인프라 선언(IaC)은 런타임 발행 호출이 아니다 — 참고로 함께 낸다.'
echo '```'
g -E "aws-cdk-lib/aws-iot|CfnThing" --include='*.ts' "$SMR/backend" | sed "s|$SMR/||" | head -4
echo '```'
echo

zero "Supabase" "@supabase|supabase-js" --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.dart'
echo '**통제군** — 같은 방식으로 이 레포가 실제로 쓰는 DB 클라이언트를 찾으면 나온다.'
echo '```'
# ⚠ 통제군은 본문(4절)과 **같은 넓이**여야 한다. `from "pg"` 만 보면 1개가 나오는데,
#   두 스크립트는 createRequire(…)("pg") 와 동적 import() 로 싣는다 — 좁은 통제군은
#   통제군 구실을 못 한다(실측 2026-08-21 · 1 vs 3).
echo "pg 를 싣는 파일: $(files -E 'new Pool\(|new Client\(|from "pg"|\("pg"\)|/pg/lib/' --include='*.ts' --include='*.mjs' .)개"
echo "  그중 from \"pg\" 로만 잡히는 것: $(files -E 'from "pg"' --include='*.ts' --include='*.mjs' .)개"
echo '```'
echo
echo '이 레포의 DB 는 **캠퍼스 PostgreSQL** 이고 클라이언트는 `pg` 다(4절).'
echo
echo '⚠ 두 분석 스크립트는 `createRequire(…)("pg")` 와 동적 `import()` 로 pg 를 싣는다 —'
echo '  `from "pg"` 만 grep 하면 안 잡힌다. 4절 목록은 `new Pool(` 로 잡은 것이다.'

echo
echo '---'
echo
echo '## 재실행'
echo
echo '```'
echo 'scripts/scan-seams.sh        docs/seams-callsites.md 갱신'
echo 'scripts/scan-seams.sh -      표준출력만'
echo '```'
} > "$OUT"

[ "$OUT" = /dev/stdout ] || echo "생성 완료 — ${OUT#$ROOT/} ($(wc -l < "$OUT" | tr -d ' ')줄)"

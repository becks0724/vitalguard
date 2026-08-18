import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const dashboardRoot = process.cwd();
const routeSource = readFileSync(
  resolve(dashboardRoot, "app/api/assignment/chat/route.ts"),
  "utf8",
);
const assistantSource = readFileSync(
  resolve(
    dashboardRoot,
    "../../../../apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift",
  ),
  "utf8",
);
const previewAppSource = readFileSync(
  resolve(
    dashboardRoot,
    "../../../../apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/VitAlGuardPreviewApp.swift",
  ),
  "utf8",
);
const packageSource = readFileSync(resolve(dashboardRoot, "package.json"), "utf8");
const vitalRouteSource = readFileSync(resolve(dashboardRoot, "app/api/app/vital/route.ts"), "utf8");
const watchSettingsSource = readFileSync(
  resolve(dashboardRoot, "../../../../apps/VitAlGuard-iOS-WatchOS-App/Watch/Sources/ConnectionSettings.swift"),
  "utf8",
);
const watchVitalTransmitterSource = readFileSync(
  resolve(dashboardRoot, "../../../../apps/VitAlGuard-iOS-WatchOS-App/Watch/Sources/VitalTransmitter.swift"),
  "utf8",
);

test("HyperCLOVA key is accepted only from server environment variables", () => {
  assert.doesNotMatch(routeSource, /x-hyperclova-api-key/i);
  assert.doesNotMatch(routeSource, /requestedClovaKey|requestedKey/);
  assert.match(routeSource, /process\.env\.CLOVASTUDIO_API_KEY/);
  assert.match(routeSource, /process\.env\.CLOVA_API_KEY/);
  assert.match(routeSource, /process\.env\.HYPERCLOVA_API_KEY/);
});

test("iPhone assistant calls the authenticated server proxy, never an LLM endpoint", () => {
  assert.match(assistantSource, /fetchServerAnswer/);
  assert.match(assistantSource, /vitalGuardAssistantSessionToken/);
  assert.doesNotMatch(assistantSource, /clovastudio\.stream\.ntruss\.com/);
  assert.doesNotMatch(assistantSource, /api\.openai\.com/);
  assert.doesNotMatch(assistantSource, /x-hyperclova-api-key/i);
});

test("chat bubbles keep assistant messages left and user messages right", () => {
  assert.match(
    assistantSource,
    /if isUser \{\s*row\.addArrangedSubview\(leftSpacer\)\s*row\.addArrangedSubview\(bubbleContainer\)\s*\} else \{\s*row\.addArrangedSubview\(bubbleContainer\)\s*row\.addArrangedSubview\(rightSpacer\)/,
  );
  assert.match(
    assistantSource,
    /messagesContentView\.widthAnchor\.constraint\(equalTo: scroll\.frameLayoutGuide\.widthAnchor, constant: -28\)/,
  );
  assert.doesNotMatch(assistantSource, /row\.addArrangedSubview\(UIView\(\)\)/);
});

test("dashboard and iPhone retrieve the same server-owned chat contract", () => {
  assert.match(routeSource, /ASSIGNMENT_CHAT_CONTRACT/);
  assert.match(assistantSource, /refreshChatContract/);
  assert.match(assistantSource, /followUpWorkerIds/);
  assert.doesNotMatch(assistantSource, /attachmentContext/);
});

test("iPhone renders server-confirmed task summaries inside its existing assistant bubble", () => {
  assert.match(assistantSource, /let taskSummaries: \[TaskSummary\]\?/);
  assert.match(assistantSource, /makeTaskSummaryTable\(taskSummaries\)/);
  assert.match(assistantSource, /서버 판정 작업 목록/);
  assert.match(assistantSource, /taskSummaries: response\.taskSummaries/);
});

test("Debug uses localhost while Release keeps the production HTTPS assistant route", () => {
  assert.match(
    previewAppSource,
    /#if DEBUG[\s\S]*http:\/\/localhost:3000\/api\/assignment\/chat[\s\S]*#else/,
  );
  assert.match(
    previewAppSource,
    /#else\s*return URL\(string: "\\\(VitalGuardLinks\.safetyMonitor\)\/api\/assignment\/chat"\)/,
  );
  assert.doesNotMatch(assistantSource, /x-vitalguard-local-debug/i);
});

test("chat route has no local-debug or shared-key bypass and owns request controls", () => {
  assert.doesNotMatch(routeSource, /hasLocalDebugAccess|VITALGUARD_LOCAL_DEBUG_CHAT|ASSIGNMENT_CHAT_ACCESS_KEY/);
  assert.match(routeSource, /hasAdminMenuAccess/);
  assert.match(routeSource, /consumeToken/);
  assert.match(routeSource, /readBoundedJson/);
  assert.match(routeSource, /export async function GET/);
});

test("local dashboard command loads root env file and binds only to loopback", () => {
  assert.match(packageSource, /--env-file=\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.env\.local/);
  assert.match(packageSource, /dev:local-hyperclova.*-H 127\.0\.0\.1/);
  assert.doesNotMatch(packageSource, /dev:local-hyperclova.*-H 0\.0\.0\.0/);
});

test("vital stream requires an authorized dashboard reader and binds every write to the app JWT worker", () => {
  assert.match(vitalRouteSource, /if \(!verifyBasicAuth\(request\)\)/);
  // 토큰은 반드시 bearerToken → verifyAppJwt 를 거쳐야 한다.
  // 거부 사유 로깅을 위해 한 줄을 두 줄로 나눴으므로(rawToken 경유) 두 형태를 모두 허용한다.
  assert.match(
    vitalRouteSource,
    /verifyAppJwt\((?:bearerToken\(request\)|rawToken|token)\)/,
    "수집 인증이 앱 JWT 검증을 거치지 않는다",
  );
  assert.match(vitalRouteSource, /bearerToken\(request\)/, "Authorization 헤더에서 토큰을 뽑아야 한다");
  assert.match(vitalRouteSource, /bodyIsBoundToWorker\(body, claims\.workerId\)/);
  assert.doesNotMatch(vitalRouteSource, /ingestAuthStatus\(request\)/);
});

test("Watch deletes legacy JWT state and relays vitals through the paired iPhone", () => {
  assert.match(watchSettingsSource, /d\.removeObject\(forKey: "appAuthJWT"\)/);
  assert.match(watchSettingsSource, /purgeLegacyWatchAppJWT\(\)/);
  assert.match(watchVitalTransmitterSource, /relayBatchToPhone/);
  assert.match(watchVitalTransmitterSource, /"watchVitalBatch": batch/);
  assert.match(watchVitalTransmitterSource, /session\.sendMessage\(payload/);
  assert.doesNotMatch(watchVitalTransmitterSource, /URLSession/);
});

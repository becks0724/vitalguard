// 신규 앱(vitalguard_app)용 생체 수신 별칭 — /api/mock/vital 과 동일 핸들러(인증·검증·저장 공유).
// "mock" 이름은 레거시 표기라 신규 클라이언트에는 이 경로를 표준으로 쓴다. 전면 개명은 구 앱 청산 후 별도 트랙.
export { GET, POST } from "../../mock/vital/route";

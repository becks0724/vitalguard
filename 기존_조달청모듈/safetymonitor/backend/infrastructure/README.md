# backend/infrastructure — AWS CDK

> **프로젝트 상태는 [../../docs/progress.md](../../docs/progress.md#quick-summary-30초-안에-읽기) 와 [CLAUDE.md](../../CLAUDE.md) 가 단일 source.** 이 README 는 인프라(CDK) 구조만 기술한다(중복 status 블록 제거 — drift 방지). 요지: AWS 실배포는 결제 문제로 보류, 현재는 Next.js mock receiver + cloudflared 터널 대체 경로로 시연. AWS 보류 해제 시 동일 payload 스키마로 마이그레이션.

AWS CDK (TypeScript) 인프라 코드. Region 고정 `ap-northeast-2` (서울). 실 `cdk deploy` 는 AWS 계정 + 결제카드 + `aws configure` 완료 후 가능.

## 지금까지 작업 (D0~D1 대체 경로)

- `bin/app.ts` — CDK 앱 진입점 (`SafetyMonitor-IotStack-Dev`)
- `lib/iot-stack.ts` — `IotStack` 1개
  - `dynamodb.Table` `safetymonitor-vital-stream-dev` (`workerId` PK + `ts` SK · PAY_PER_REQUEST)
  - `iot.CfnThing` `safetymonitor-demo-worker-01`
- `cdk synth` 통과 — `cdk.out/SafetyMonitor-IotStack-Dev.template.json` 생성
- AWS 보류 대체 경로 — Next.js local/mock receiver + dashboard polling + mock publish script 로 vital payload 검증
- iPhone 실기기 HTTP fallback — HealthKit HR/SpO₂/손목 온도 payload 를 local/mock receiver 로 수신 확인

## 현재 상태

- **합성 (synth)**. 로컬 합성 OK. 실제 AWS 배포 0건
- **스택 수**. 1개 (`IotStack`)
- **리소스**. DDB 테이블 1개 + IoT Thing 1개
- **잔여**. AWS 계정 발급 + `aws configure --profile dev` + `cdk bootstrap` (결제 문제 해소 후 사용자 액션)
- **★ 발표용 대체 경로**. AWS 보류 + 라우터 client isolation 모두 우회. **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:3000`) 으로 `https://<무작위>.trycloudflare.com` 발급(세션마다 회전 — 현재 URL 은 [../../docs/progress.md](../../docs/progress.md#quick-summary-30초-안에-읽기) 참조) → iPhone 의 Flutter 앱은 in-app receiver URL 에 cloudflared URL 입력 → Next.js mock receiver (`POST /api/mock/vital`) 가 수신 → 대시보드 표시. 라우터/Wi-Fi 환경에 무관하게 동작 (발표 장소 Wi-Fi 도 OK)
- **AWS 보류 해제 후 마이그레이션 경로**. IoT Thing/Cert/Rule → Lambda `vital-ingest` → DynamoDB. 동일 payload 스키마라 dashboard 측 변경 최소

## 다음 할 일

### 보류 중 사용자 액션 (AWS 결제 문제 해소 후)

1. AWS 계정 생성 + MFA 활성화
2. IAM 사용자 생성 + Access Key 발급
3. `aws configure --profile dev` 자격 등록
4. `cdk bootstrap aws://<ACCOUNT>/ap-northeast-2 --profile dev` 1회
5. 결제 알람 $10 / $50 / $100 단계 설정 (콘솔 `Billing > Budgets`)

### D1 (폰 앱 → AWS 백엔드 publish, 보류 해제 후)

- `IotStack` 확장 — IoT Thing 2개 이상 (`demo_ios_01` · `demo_and_01`) + 인증서 발급 스크립트
- IoT Rule 추가 — vital 토픽 → Lambda 트리거 (`SELECT * FROM 'safetymonitor/v1/dev/worker/+/vital'`)
- `backend/lambdas/vital-ingest/` 신규 — IoT Rule → DDB put (정규화 + workerId/ts 추출)

### AWS 보류 중 완료된 대체 작업

- Next.js local/mock receiver — `POST /api/mock/vital`
- 5 worker dashboard polling — local in-memory store 조회 (mock-publish.mjs 가상 워커 5명)
- mock publish script — `pnpm mock:publish`
- Flutter HTTP fallback — `MOCK_RECEIVER_URL` 로 local receiver 전송. iPhone 실기기 HR/SpO₂/손목 온도 payload 확인

### D2~D3 (백엔드 → 대시보드 + 위험 감지)

- `DataStack` 분리 — HazardEvent 테이블 추가
- `backend/lambdas/hazard-detect/` — `@safetymonitor/analyzers` 5종 호출 → HazardEvent 생성
- (선택) `AuthStack` — Cognito (현 프로토타입 비범위. 발표 후)

## 명령어

```bash
pnpm install                                                  # 모노레포 루트에서 1회
pnpm --filter @safetymonitor/infrastructure build             # tsc 컴파일
pnpm --filter @safetymonitor/infrastructure synth             # CloudFormation 템플릿 생성
pnpm --filter @safetymonitor/infrastructure diff              # 현 배포 상태와 차이
pnpm --filter @safetymonitor/infrastructure deploy            # 실제 배포 (요금 발생)
```

## 사전 조건

1. AWS 계정 + IAM 사용자 + Access Key
2. `aws configure --profile dev` 자격 등록
3. `cdk bootstrap` (계정·리전당 1회)
4. 결제 알람 단계화

## 스택 구성 (현재)

- `**IotStack**` (`ap-northeast-2`)
  - `dynamodb.Table` — `safetymonitor-vital-stream-dev` (`workerId` PK + `ts` SK · PAY_PER_REQUEST · removal=DESTROY)
  - `iot.CfnThing` — `safetymonitor-demo-worker-01`
  - `CfnOutput` — `VitalTableName` · `DemoThingName`


# VitAlGuard Cloud Run 배포 인수인계

작성일: 2026-07-29  
대상: Cloud Run 배포 담당자  
목적: iPhone·Apple Watch 실데이터와 목업 데이터를 PostgreSQL·관제 대시보드에서 분리 표시하는 릴리스를 안전하게 배포하고 검증한다.

## 1. 이번 릴리스의 결과

| 구분 | 수신 source | DB 표시값 | 저장소 | 실시간 관제·경보 포함 |
| --- | --- | --- | --- | --- |
| 실제 iPhone | `VitAlGuard-iPhone` | `ios_data_vitalguard` | `public.vital_samples` | 포함 |
| 실제 Apple Watch | `VitAlGuard-WatchVitals`, `VitAlGuard-Watch-background` | `watchos_data_vitalguard` | `public.vital_samples` | 포함 |
| 목업 iPhone | `VitAlGuard-Mock-iPhone`, `VitAlGuard-Mock-iOS` | `mockup_ios_data_vitalguard` | `public.data_mockup` | 제외 |
| 목업 Apple Watch | `VitAlGuard-Mock-Watch`, `VitAlGuard-Mock-watchOS` | `mockup_watchos_data_vitalguard` | `public.data_mockup` | 제외 |

- 알 수 없는 `source`는 두 테이블 모두에 저장하지 않는다.
- `data_mockup`은 실데이터 작업자 목록, 경보, `vital_samples` 누적 건수에 포함되지 않는다.
- 과거 행은 출처를 추정하지 않고 `legacy_unclassified_vitalguard`로 보존한다. 삭제·이동하지 않는다.
- 첫 데이터베이스 접근 시 앱이 `data_origin`, `source`, `data_mockup`, `vital_data_origin_summary`를 멱등 생성한다.

## 2. 배포 대상과 사전 조건

| 항목 | 값 |
| --- | --- |
| Google Cloud 프로젝트 | `safetymonitor-498508` |
| 리전 | `asia-northeast3` |
| Cloud Run 서비스 | `vitalguard-dashboard` |
| Artifact Registry 이미지 | `asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard:latest` |
| Cloud Build 파일 | `cloudbuild.dashboard.yaml` |
| 배포 소스 기준 | [GitHub main · `기존_조달청모듈/safetymonitor`](https://github.com/becks0724/vitalguard/tree/main/%EA%B8%B0%EC%A1%B4_%EC%A1%B0%EB%8B%AC%EC%B2%AD%EB%AA%A8%EB%93%88/safetymonitor) |

배포 담당자 권한:

- Cloud Build 실행 권한
- Artifact Registry 읽기 권한
- Cloud Run 서비스 조회·업데이트 권한
- 기존 서비스가 참조하는 Secret Manager 비밀값을 **변경하지 않고** 유지할 수 있는 권한

중요: `DATABASE_URL`, JWT, 관리자 비밀번호, 토큰 등 비밀값은 이 문서·명령줄·채팅에 기록하지 않는다.

## 3. 배포 전 확인

```bash
gcloud auth login
gcloud config set project safetymonitor-498508

# 현재 정상 리비전과 URL을 기록한다. 롤백에 필요하다.
gcloud run services describe vitalguard-dashboard \
  --region asia-northeast3 \
  --project safetymonitor-498508 \
  --format='table(status.url,status.latestReadyRevisionName,spec.template.spec.containers[0].image)'
```

위 명령의 `latestReadyRevisionName`을 별도 안전한 작업 메모에 기록한다. 이 문서나 Git에는 쓰지 않는다.

또한 아래를 확인한다.

1. 현재 서비스에 `DATABASE_URL` 등 기존 런타임 환경변수·Secret Manager 참조가 존재한다.
2. `cloudbuild.dashboard.yaml`의 `_AI_URL` 값은 현재 운영 CCTV AI 서버 주소로 확인한다. 빈 값으로 배포하면 프런트엔드가 localhost로 폴백할 수 있다.
3. 현재 워크트리에는 다른 팀원의 변경이 있으므로, 이 릴리스에 포함할 변경만 검토한다.

## 4. 빌드와 배포

배포 소스 루트에서 실행한다.

```bash
pnpm run typecheck
pnpm --filter @safetymonitor/dashboard-web build
```

그 다음, 확인한 실제 CCTV AI URL을 넣어 이미지를 빌드한다.

```bash
gcloud builds submit \
  --project safetymonitor-498508 \
  --config cloudbuild.dashboard.yaml \
  --substitutions=_AI_URL='https://확인된-운영-CCTV-AI-URL' \
  .
```

빌드 후에는 `latest` 태그가 아닌 이미지 digest를 확인해, 검증한 정확한 이미지만 배포한다.

```bash
gcloud artifacts docker images describe \
  asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard:latest
```

출력에서 `image_summary.digest` 값을 확인해 `SHA256_DIGEST`에 대입한다. 태그 문자열만 배포하지 않는다.

```bash
gcloud run services update vitalguard-dashboard \
  --project safetymonitor-498508 \
  --region asia-northeast3 \
  --image=asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard@SHA256_DIGEST
```

주의:

- `--set-env-vars`, `--clear-env-vars`, `--set-secrets`, `--clear-secrets`를 붙이지 않는다. 이번 배포는 이미지 교체만 해야 기존 DB·인증 비밀값이 보존된다.
- 서비스명, 프로젝트, 리전은 위 표와 다르면 중단하고 관리자에게 확인한다.

## 5. 배포 직후 확인

### 5-1. Cloud Run 리비전과 공개 엔드포인트

```bash
gcloud run services describe vitalguard-dashboard \
  --region asia-northeast3 \
  --project safetymonitor-498508 \
  --format='table(status.url,status.latestReadyRevisionName,spec.template.spec.containers[0].image)'
```

새 리비전이 Ready 상태인지 확인하고, 기존 로그인·대시보드가 정상 열리는지 브라우저에서 확인한다.

### 5-2. TablePlus 검증

TablePlus의 기존 검증 탭에서 실행한다. 개인정보 열·`raw_json`은 발표 화면에 노출하지 않는다.

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vital_samples'
  AND column_name IN ('data_origin', 'source')
ORDER BY column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'data_mockup';

SELECT data_origin, sample_count, worker_count, latest_ts
FROM public.vital_data_origin_summary
ORDER BY data_origin;
```

성공 기준:

- `vital_samples`에 `data_origin`, `source`가 있다.
- `data_mockup` 테이블이 있다.
- `vital_data_origin_summary` 뷰가 조회된다.

### 5-3. 실제 기기 실시간 확인

1. iPhone에서 실제 생체 데이터 1건을 전송한다.
2. Apple Watch에서 실제 생체 데이터 1건을 전송한다.
3. 대시보드 작업자 관제에서 가상 `VW-*` 행 없이 실제 작업자만 보이는지 확인한다.
4. 대시보드의 실시간 수집 표에 `ios_data_vitalguard`와 `watchos_data_vitalguard`가 표시되는지 확인한다.
5. 아래 SQL에서 최신 시각과 건수가 증가하는지 확인한다.

```sql
SELECT data_origin, COUNT(*) AS rows, MAX(ts) AS latest_ts
FROM public.vital_samples
WHERE data_origin IN ('ios_data_vitalguard', 'watchos_data_vitalguard')
GROUP BY data_origin
ORDER BY data_origin;

SELECT COUNT(*) AS mockup_rows_in_real_table
FROM public.vital_samples
WHERE data_origin IN ('mockup_ios_data_vitalguard', 'mockup_watchos_data_vitalguard');
```

`mockup_rows_in_real_table`은 반드시 `0`이어야 한다.

## 6. 목업 확인

목업 전송은 운영 iPhone·Watch 앱이 아닌, 별도 승인된 테스트 클라이언트와 유효한 수집 인증으로만 수행한다.

- iPhone 목업에는 `source: "VitAlGuard-Mock-iPhone"`을 사용한다.
- Watch 목업에는 `source: "VitAlGuard-Mock-Watch"`를 사용한다.
- 대시보드에서는 목업이 `data_mockup` 섹션에만 나타나는지 확인한다.
- 실시간 작업자 목록·경보·실데이터 누적 건수는 변하면 안 된다.

```sql
SELECT data_origin, COUNT(*) AS rows, MAX(ts) AS latest_ts
FROM public.data_mockup
GROUP BY data_origin
ORDER BY data_origin;
```

## 7. 즉시 롤백

배포 후 로그인 실패, DB 연결 실패, 실제 수신 중단, 경보 오작동이 있으면 새 리비전 트래픽을 중지하고 배포 전 기록한 리비전으로 되돌린다.

```bash
gcloud run services update-traffic vitalguard-dashboard \
  --project safetymonitor-498508 \
  --region asia-northeast3 \
  --to-revisions=배포전_리비전명=100
```

롤백 후 대시보드 접속, iPhone·Watch 전송, TablePlus 최신 수신 시각을 다시 확인한다. 원인 분석 전에는 `data_mockup` 또는 `vital_samples`의 데이터를 삭제하지 않는다.

## 8. 인수인계 완료 조건

```text
PASS
- 새 Cloud Run 리비전 Ready
- 기존 환경변수·비밀값 변경 없음
- vital_samples에 data_origin, source 생성
- data_mockup 및 vital_data_origin_summary 생성
- 실제 iPhone과 Watch 데이터가 각 출처명으로 기록
- mockup_rows_in_real_table = 0
- 대시보드에서 실데이터와 data_mockup이 분리 표시
- 롤백 대상 리비전 기록 완료
```

하나라도 충족하지 않으면 배포 완료로 선언하지 않고, 롤백 또는 원인 확인 상태로 기록한다.

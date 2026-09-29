# 문서 촬영 배치·잘린 연필 진단 — 2026-09-29

요청: 가로일 때 촬영 하단 중앙, 수동/자동 토글 그 위, X 오른쪽 위, 카메라 영상 전체 화면. 오른쪽 아래 잘린 연필도 수정.

## 관측

- 문서 스캔은 `CaptureNative.kt`의 `GmsDocumentScanning.getClient(... SCANNER_MODE_FULL)`로 Google Play 서비스의 별도 Activity를 연다.
- 실제 전경 `com.google.android.gms/.mlkit.docscan.ui.DocumentScanningActivity`. `com.google.android.gms.optional_mlkit_docscan_ui` 소유 촬영 버튼은[2595,843][2757,1005], 닫기는[0,1729][102,1831], 자동/수동은하단에 있었다. 앱 Compose의 `CameraScreen`은 별도의 사진 촬영 화면이다.
- 연필은 `com.lenovo.penservice`의 `FloatingCollapseView` 시스템 오버레이. Window좌표(2868,1716), 크기76×153, 화면2944×1840. 아래끝1869로29px 넘는다. SDK나 앱의 주석 버튼이 아니다.
- Google 공식 설정은 갤러리 허용·페이지 수·결과 형식·기능 모드이며 버튼 위치나 viewfinder 배치를 제공하지 않는다. 요청한 자유 배치에는 앱 소유의 별도 문서 촬영/자동촬영/테두리 보정 구현이 필요하다.

## 진행 상태

- UI/Window/공식 SDK 설정을 읽어 확인했다. 카메라를 열어 관찰하고 닫았으며 촬영 결과를 승인/저장하지 않았다.
- 사용자에게 자체 문서 촬영 화면 교체 vs Google 스캔 유지, 시스템 펜 버튼 위치 이동 vs 숨김 선호를 비동기로 질문했다. 답변 전에는 기존 Google 스캔/시스템 펜 설정을 바꾸지 않았다.
- Google 제공 UI에 다른 앱 권한으로 버튼을 겹쳐 놓거나 숨겨진 SDK 리소스를 수정하는 우회 구현은 하지 않는다.
- 근거: https://developers.google.com/ml-kit/vision/doc-scanner/android , https://developers.google.com/android/reference/com/google/mlkit/vision/documentscanner/GmsDocumentScannerOptions.Builder
- 실기기 캡처/계층은 로컬 `artifacts/scanner-layout-20260929/`에 보관한다.

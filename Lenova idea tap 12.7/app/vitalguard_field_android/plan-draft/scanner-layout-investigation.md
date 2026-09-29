# 문서 촬영 배치·잘린 연필 진단 — 2026-09-29

요청: 가로일 때 촬영 하단 중앙, 수동/자동 토글 그 위, X 오른쪽 위, 카메라 영상 전체 화면. 오른쪽 아래 잘린 연필도 수정.

## 관측

- 문서 스캔은 `CaptureNative.kt`의 `GmsDocumentScanning.getClient(... SCANNER_MODE_FULL)`로 Google Play 서비스의 별도 Activity를 연다.
- 실제 전경 `com.google.android.gms/.mlkit.docscan.ui.DocumentScanningActivity`. `com.google.android.gms.optional_mlkit_docscan_ui` 소유 촬영 버튼은[2595,843][2757,1005], 닫기는[0,1729][102,1831], 자동/수동은하단에 있었다. 앱 Compose의 `CameraScreen`은 별도의 사진 촬영 화면이다.
- 연필은 `com.lenovo.penservice`의 `FloatingCollapseView` 시스템 오버레이. Window좌표(2868,1716), 크기76×153, 화면2944×1840. 아래끝1869로29px 넘는다. SDK나 앱의 주석 버튼이 아니다.
- Google 공식 설정은 갤러리 허용·페이지 수·결과 형식·기능 모드이며 버튼 위치나 viewfinder 배치를 제공하지 않는다. 요청한 자유 배치에는 앱 소유의 별도 문서 촬영/자동촬영/테두리 보정 구현이 필요하다.

## 진행 상태

- UI/Window/공식 SDK 설정을 읽어 확인했다. 카메라를 열어 관찰하고 닫았으며 촬영 결과를 승인/저장하지 않았다.
- 사용자 후속 답변: **Google 제공 화면이면 유지**, **레노버 연필은 숨김**. 자체 스캐너 교체/문서 버튼 재배치는 진행하지 않는다.
- 레노버 기본 설정 `펜 → 스타일러스 도구 상자`를 껐다. `secure pen_set_show_button`1→0, 설정 스위치 해제 확인. `FloatingCollapseView`와`FloatingExpandView` 모두 `mHasSurface=false`/`isVisible=false`, 앱 화면에서도 연필 버튼 사라짐을 확인했다.
- 손글씨(`pen_set_freewrite_on=1`), 두 빠른 노트 설정(각1), 펜 버튼 바로가기(`show_hide_menu`)는 유지했다. 실제 펜 획을 추가로 그려 시험하지는 않았다. 펜 서비스 제거/비활성화·앱 데이터 삭제는 하지 않았다.
- 복원은 같은 설정의 ‘스타일러스 도구 상자’를 켠다. 기기 설정만 바꿨고 앱 버전은1.3.10/code15 그대로다. 근거 `artifacts/pen-toolbar-hidden-20260929/`.
- Google 제공 UI에 다른 앱 권한으로 버튼을 겹쳐 놓거나 숨겨진 SDK 리소스를 수정하는 우회 구현은 하지 않는다.
- 근거: https://developers.google.com/ml-kit/vision/doc-scanner/android , https://developers.google.com/android/reference/com/google/mlkit/vision/documentscanner/GmsDocumentScannerOptions.Builder
- 실기기 캡처/계층은 로컬 `artifacts/scanner-layout-20260929/`에 보관한다.

package com.vitalguard.field.ui.help

import com.vitalguard.field.R

data class GuideRow(val icon: Int, val label: String, val instruction: String)
data class GuideSection(val id: String, val title: String, val icon: Int, val rows: List<GuideRow>)

val usageGuideSections = listOf(
    GuideSection("start", "시작하기", R.drawable.ic_book, listOf(
        GuideRow(R.drawable.ic_person, "정식 앱·로그인", "VitAlGuard 현장을 열고 계정으로 로그인합니다. 테스트용 · VG는 검증용 앱입니다."),
        GuideRow(R.drawable.ic_person, "회원정보", "로그아웃 위의 이름 또는 사람 아이콘을 눌러 본인 정보를 봅니다. 전화번호는 앞3자리·뒤2자리만 표시합니다."),
        GuideRow(R.drawable.ic_site, "메뉴 이동", "사이드바에서 현장·경보·기록·전송 이력·설정·사용 방법을 고릅니다. 다른 메뉴를 다녀오면 보던 화면을 유지하고, 선택 중인 메뉴를 한 번 더 누르면 초기 화면으로 돌아갑니다. 꺾쇠는 메뉴 펼치기·접기입니다."),
        GuideRow(R.drawable.ic_info, "아이콘 이름", "아이콘을 길게 누르면 기능 이름을 볼 수 있습니다. 회색으로 비활성화된 버튼은 현재 사용할 수 없습니다."),
        GuideRow(R.drawable.ic_previous, "이전 화면", "왼쪽 꺾쇠로 이전 화면에 돌아갑니다. 기록 입력 중에는 저장 상태를 확인한 뒤 이동합니다."),
        GuideRow(R.drawable.ic_receipt_clock, "수신 상태", "상단 연결 상태와 마지막 수신 시각을 확인합니다. 미수신이나 오래된 자료를 현재 정상 상태로 판단하지 않습니다."),
    )),
    GuideSection("site", "현장·경보", R.drawable.ic_alert, listOf(
        GuideRow(R.drawable.ic_weather, "현장 카드", "기상·작업자·가스 카드를 눌러 상세를 봅니다. 새로고침 아이콘으로 현장 정보를 다시 받습니다."),
        GuideRow(R.drawable.ic_weather, "기상 상세", "아이콘 아래 큰 수치와 단위를 봅니다. 비·눈 배경은 최근 수신한 기상청 강수형태, 바람은 서버 풍속 위험 판정입니다. 오래되거나 수신 실패면 효과를 끕니다. 강수·일사·미세먼지는 오픈메테오 값을 함께 사용하며 WBGT는 참고값입니다."),
        GuideRow(R.drawable.ic_eye, "기상 효과 미리보기", "기상 상세의 눈 모양 버튼에서 비·눈·강풍을 고릅니다. 실제 기상 수치나 판정은 바뀌지 않습니다. 상단 X, 다른 탭 이동, 앱을 내리면 미리보기가 끝납니다."),
        GuideRow(R.drawable.ic_person, "작업자 게이지", "전체 인원이100%입니다. 정상은 초록, 주의는 노랑, 위험은 빨강입니다. 파란 미수신은 아직 데이터로 판정하지 못한 인원입니다."),
        GuideRow(R.drawable.ic_gas_cloud, "가스·AED-alert", "가스는 표시된 값·단위·수신 시각을 함께 봅니다. AED-alert의 연동 대기는 실제 기기 상태가 아직 연결되지 않았다는 뜻입니다."),
        GuideRow(R.drawable.ic_filter, "경보 조회 필터", "조회 필터를 열고 대응 상태·경보 종류를 고릅니다. 체크는 적용, X는 선택 취소, 원형 화살표는 필터 초기화입니다."),
        GuideRow(R.drawable.ic_check, "대응 확인", "상세 체크는 해당 경보, 목록 오른쪽 체크는 현재 필터의 미대응 경보 전체를 확인 처리합니다. 대상·발생 시각을 확인하고 누릅니다. 처리 중에는 중복 입력을 막으며 위험 해제나 사고 종결을 뜻하지 않습니다."),
        GuideRow(R.drawable.ic_close, "하단 알림 닫기", "알림 띠의 X는 화면 안내만 숨깁니다. 경보를 대응완료로 처리하는 버튼은 아닙니다."),
    )),
    GuideSection("record", "사진·기록", R.drawable.ic_record, listOf(
        GuideRow(R.drawable.ic_calendar_today, "워크 캘린더", "날짜나 기록이 있는 시간 칸을 눌러 목록을 열고 사진을 선택합니다. 달력 아이콘은 오늘, 좌우 꺾쇠는 이전·다음 주입니다."),
        GuideRow(R.drawable.ic_camera, "사진 촬영", "카메라 아이콘으로 촬영 화면을 열고 촬영 버튼을 누릅니다. 처리된 사진은 기록에 추가됩니다."),
        GuideRow(R.drawable.ic_scan, "서류 스캔", "스캔 아이콘을 누르면 Google 문서 스캔 화면이 열립니다. 문서를 촬영·보정한 뒤 완료하면 앱으로 돌아옵니다."),
        GuideRow(R.drawable.ic_record, "주석 그리기", "사진 상세의 연필을 눌러 주석을 그립니다. 펜 도구·색·굵기를 고르고 저장 아이콘으로 보관합니다. 손가락은 그리기가 아닌 화면 이동·확대에 사용합니다."),
        GuideRow(R.drawable.ic_note, "메모·말로 입력", "메모 아이콘을 눌러 직접 입력하거나 말로 입력합니다. 음성 인식은 후보를 선택하고 내용을 고친 뒤 전체 문장 확인 체크와 저장을 누릅니다."),
        GuideRow(R.drawable.ic_microphone, "음성 녹음", "마이크로 시작하고 정지 아이콘으로 끝냅니다. 재생으로 들어본 뒤 저장합니다. 다시 녹음과 취소는 원형 화살표·X입니다."),
        GuideRow(R.drawable.ic_eye, "원문·첨부 확인", "OCR 아이콘으로 인식 원문을 펼칩니다. 주석본 보기 전환으로 주석을 확인하고 음성 옆 재생 아이콘으로 듣습니다. 서버 주석 수는 확인된 최소 개수일 수 있습니다."),
        GuideRow(R.drawable.ic_upload, "기록 전송 시점", "사진 상세를 닫으면 저장한 사진·주석·메모·음성이 자동 전송됩니다. 오프라인이면 기기에 보관하고 연결 후 이어서 보냅니다."),
        GuideRow(R.drawable.ic_trash, "사진·첨부 삭제", "휴지통으로 삭제를 시작합니다. 사진 삭제는 확인창의 대상을 읽고 확정합니다. 완료된 사진의 삭제 가능 여부는 서버에서 판단합니다."),
    )),
    GuideSection("transfer", "전송 이력", R.drawable.ic_outbox, listOf(
        GuideRow(R.drawable.ic_outbox, "무엇을 보여주나요", "현재 계정의 완료·전송 중·실패·결과 불명 기록을 봅니다. 상태와 작성 당시 현장으로 목록을 걸러볼 수 있습니다."),
        GuideRow(R.drawable.ic_state_empty, "기기에 보관", "대기 중인 기록은 연결 후 자동으로 전송됩니다. 작성 중인 사진의 추가 기록은 상세를 닫아야 전송을 시작합니다."),
        GuideRow(R.drawable.ic_state_clock, "전송 중", "서버 응답을 기다립니다. 같은 항목을 반복해서 보내지 않습니다."),
        GuideRow(R.drawable.ic_state_check, "완료", "서버에서 확인한 기록입니다. 기기의 완료 이력은7일 뒤 정리되지만 서버 원본은 기록 탭에서 다시 볼 수 있습니다."),
        GuideRow(R.drawable.ic_upload, "실패", "오류 내용을 확인하고 연결을 확인한 뒤 전송 아이콘을 누릅니다. 다시 로그인이 필요하면 작성 계정으로 로그인한 뒤 재개합니다."),
        GuideRow(R.drawable.ic_refresh, "결과 불명", "이미 서버에 반영됐을 수 있습니다. 새로고침으로 서버 상태를 먼저 조회합니다. 미등록이 확인된 경우에만 같은 작업을 재시도합니다."),
        GuideRow(R.drawable.ic_receipt_clock, "재조회 시점", "결과 불명은 화면 진입·앱 복귀 때 자동 조회합니다.30초 안에는 조회를 반복하지 않습니다. 조회 기능이 없는 경우에는 관제웹에서 미등록을 먼저 확인합니다."),
        GuideRow(R.drawable.ic_info, "기록 정보", "기록 카드 오른쪽 위 i를 누르면 왼쪽 말풍선에서 현장·작업 ID를 봅니다. i를 다시 누르거나 화면을 터치하면 닫힙니다."),
    )),
    GuideSection("cctv", "CCTV", R.drawable.ic_video, listOf(
        GuideRow(R.drawable.ic_cameras, "카메라 선택", "현장 대시보드의 영상 보기를 누르고 떠 있는 목록에서 CAM-01 또는 CAM-03을 선택합니다. 영상 화면의 카메라 탭으로도 전환합니다."),
        GuideRow(R.drawable.ic_settings, "갱신 간격", "설정 → CCTV 갱신 간격에서 실시간~2초 슬라이더를 조절합니다. 실시간은 연속 영상, 다른 값은 화면에 표시하는 간격입니다."),
        GuideRow(R.drawable.ic_fit, "확대·원래 크기", "영상을 누르면 큰 화면으로 뜹니다. 두 손가락을 벌려 확대하고 드래그로 이동합니다. 네 모서리 아이콘은 원래 크기·중앙으로 복귀합니다."),
        GuideRow(R.drawable.ic_previous, "보기 종료", "이전 버튼으로 영상을 닫거나 앱을 내리면 영상 수신이 멈춥니다. 연결 실패 시에는 네트워크와 현장 장비 상태를 확인합니다."),
    )),
    GuideSection("settings", "설정", R.drawable.ic_settings, listOf(
        GuideRow(R.drawable.ic_person, "작업 손", "한 원 안에서 사용할 손을 누릅니다. 채워진 손이 현재 선택입니다. 왼손은 실행 버튼 왼쪽·사이드바 오른쪽, 오른손은 반대이며 계정별로 기억합니다."),
        GuideRow(R.drawable.ic_video, "CCTV 선택 기억", "갱신 간격은 이 기기의 현재 계정에 저장됩니다. 다른 계정의 선택과 섞이지 않습니다."),
        GuideRow(R.drawable.ic_record, "레노버 연필 버튼", "기기 설정 → 펜 → 스타일러스 도구 상자에서 표시 여부를 바꿉니다. 앱의 주석 기능과 별도입니다."),
        GuideRow(R.drawable.ic_logout, "로그아웃", "기록을 저장한 뒤 로그아웃합니다. 기록은 작성 계정에 속하므로 이어 작업할 때 같은 계정으로 로그인합니다."),
    )),
)

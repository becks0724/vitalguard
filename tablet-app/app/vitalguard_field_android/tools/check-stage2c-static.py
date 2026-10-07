#!/usr/bin/env python3
"""2c 구조/참조/검사 산출물 확인. Gradle·네트워크·ADB·렌더링을 실행하지 않는다."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
repo = root.parents[2]
main = root / 'app/src/main/kotlin/com/vitalguard/field'
sources = {p.relative_to(main).as_posix(): p.read_text() for p in main.rglob('*.kt')}
source = '\n'.join(sources.values())
xml = list((root / 'app/src/main').rglob('*.xml'))
for path in xml:
    ET.parse(path)
android = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(root / 'app/src/main/AndroidManifest.xml').getroot()
activity = next(p for p in manifest.findall('application/activity') if p.get(android + 'name') == '.MainActivity')
assert activity.get(android + 'launchMode') == 'singleTask'
watcher = sources['data/live/ConnectivityWatcher.kt']
for required in ['registerDefaultNetworkCallback', 'unregisterNetworkCallback', 'NET_CAPABILITY_VALIDATED', 'onCapabilitiesChanged', 'onLost']:
    assert required in watcher, required
calendar = sources['ui/record/RecordCalendarScreen.kt']
for required in ['calendar-mini-month', 'calendar-week', 'calendar-all-day', 'calendar-hour-scroll', 'calendar-day-list', 'CircleShape']:
    assert required in calendar, required
assert calendar.count('ExtendedFloatingActionButton(') == 2
assert calendar.count('.verticalScroll(') == 1
assert 'fun RecordHome' not in source and 'fun pendingPhotos' not in source
assert 'HoldBundle' not in source
assert 'send-bundle' not in sources['ui/record/RecordScreens.kt']
assert '전송 이력' in sources['ui/outbox/OutboxScreen.kt']
assert '기록은 저장되면 자동으로 전송됩니다 · 실패한 것만 [전송]을 눌러 주세요' in source
for path in (main / 'data/record').glob('*.kt'):
    assert not re.search(r'^import (android|androidx)\.', path.read_text(), re.M), path
assert len(re.findall(r'\bclass CalendarMedia\b', source)) == 1
drawables = {p.stem for p in (root / 'app/src/main/res/drawable').glob('*.xml')}
references = set(re.findall(r'R\.drawable\.(\w+)', source))
assert references <= drawables, references - drawables
preview = (root / 'app/src/screenshotTest/kotlin/com/vitalguard/field/Stage2cPreviewTest.kt').read_text()
for required in ['fun RecordCalendarPreview()', 'fun OutboxHistoryPreview()', '2026-09-27', 'width=866dp,height=1385dp,dpi=340']:
    assert required in preview, required
assert preview.count('@PreviewTest') == 2
checked = 0
for folder in [root / 'app/src', root / 'tools']:
    for path in folder.rglob('*'):
        if path.is_file() and path.suffix in {'.kt', '.xml', '.py'}:
            data = path.read_text()
            assert data.endswith('\n') and all(line == line.rstrip() for line in data.splitlines()), path
            checked += 1
matched = 0
for name, expected in json.loads((root / 'source-baseline.json').read_text()).items():
    if (('/lib/' in name or '/test/' in name) and name.endswith('.dart')) or name.endswith('.kt'):
        assert hashlib.sha256((repo / name).read_bytes()).hexdigest() == expected, name
        matched += 1
relative = root.relative_to(repo).as_posix()
previous = subprocess.run(['git', 'show', f'HEAD:{relative}/app/build.gradle.kts'], cwd=repo, check=True, capture_output=True, text=True).stdout
assert previous == (root / 'app/build.gradle.kts').read_text(), '의존성/Gradle 설정 변경'
junit = (root / 'build/offline-jvm/junit.log').read_text()
passed = re.search(r'OK \((\d+) tests\)', junit)
assert passed, 'JVM 통과 로그 없음'
api_log = (root / 'build/offline-android-kotlin/compile.log').read_text()
assert ': error:' not in api_log and (root / 'build/offline-android-kotlin/api-check.jar').exists()
audit = {
    'xml_parsed': len(xml), 'drawable_references_resolved': len(references),
    'reference_source_hashes_matched': matched, 'reference_source_scope': 'Flutter lib/test/native Kotlin + capture pilot Kotlin',
    'new_libraries': 0, 'whitespace_files_checked': checked, 'single_task_manifest': True,
    'calendar_capture_fabs': 2, 'calendar_vertical_scroll_containers': 1,
    'old_pending_list_and_review_ui_removed': True, 'calendar_media_model_reused': True,
    'jvm_junit_tests': int(passed.group(1)), 'android_source_api_compile': 'passed',
    'new_preview_definitions': ['RecordCalendarPreview', 'OutboxHistoryPreview'],
    'android_instrumentation_execution': '미확인', 'single_task_hist_device_execution': '미확인',
    'preview_png_render_and_visual_review': '미확인',
    'download_url_app_jwt': '읽기 전용 서버 소스에서 미수용 확인; 실서버 미확인',
    'gradle_executed': False, 'network_executed': False,
}
(root / 'plan-draft/stage2c-static-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(audit, ensure_ascii=False, indent=2))

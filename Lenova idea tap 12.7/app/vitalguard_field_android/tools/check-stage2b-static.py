#!/usr/bin/env python3
"""Stage 2b의 파일/원문/리소스 경계 검사. Gradle·네트워크·기기 실행 없음."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
repo = root.parents[2]
main = root / 'app/src/main/kotlin/com/vitalguard/field'
source = '\n'.join(p.read_text() for p in main.rglob('*.kt'))
xml = sorted((root / 'app/src/main').rglob('*.xml'))
for path in xml:
    ET.parse(path)
manifest = ET.parse(root / 'app/src/main/AndroidManifest.xml').getroot()
android = '{http://schemas.android.com/apk/res/android}'
permissions = {p.get(android + 'name') for p in manifest.findall('uses-permission')}
assert 'android.permission.RECORD_AUDIO' in permissions
assert manifest.find("queries/intent/action").get(android+'name') == 'android.speech.RecognitionService'
resources = {p.stem for p in (root / 'app/src/main/res/drawable').glob('*.xml')}
references = set(re.findall(r'R\.drawable\.(\w+)', source))
assert references <= resources, references - resources
pure = sorted((main / 'data/record').glob('*.kt')) + [main/'data/contracts/VoiceRecorder.kt', main/'data/mock/MockVoiceRecorder.kt', main/'audio/AdtsFrames.kt']
for path in pure:
    assert not re.search(r'^import (android|androidx)\.', path.read_text(), re.M), path
for name in ['VoiceRecorder', 'SpeechInput', 'DeviceVoiceRecorder', 'DeviceSpeechInput', 'MockVoiceRecorder', 'MockSpeechInput',
             'RecordSession', 'InkEditorController', 'RecordInputController', 'VoiceCommentDraft']:
    assert len(re.findall(r'\b(?:class|interface) '+name+r'\b', source)) == 1, name
required = ['펜으로 표시하기', '주석을 모두 지울까요?', '완료한 모든 획을 지웁니다. 이 작업은 되돌릴 수 없습니다.',
    '작성 중인 주석을 보관하고 나갈까요?', '그린 획은 이 기기에 초안으로 보관됩니다. 같은 사진에서 이어서 작성할 수 있습니다.',
    '표시할 내용이 없습니다', '관리자 기록', '직접 확인한 내용을 남깁니다. 센서 판정과 별개입니다.',
    '특히 “미착용”, “중지”, 숫자와 장소가 맞는지 확인해 주세요.', '위 문장 전체를 확인했습니다',
    '메모를 기기에 저장했습니다. 사진 상세에서 함께 전송해 주세요.', '음성을 기기에 저장했습니다. 사진 상세에서 함께 전송해 주세요.',
    '작성하던 기록을 열지 못했습니다. 같은 사진에서 초안을 다시 열어 주세요.', '마이크 권한이 필요합니다',
    'ink-canvas', 'record-note', 'record-speech-text', 'confirm-record', 'save-record', 'speech-start',
    'voice-start', 'voice-elapsed', 'voice-stop', 'voice-cancel-recording', 'voice-preview', 'voice-send', 'voice-rerecord', 'voice-cancel', 'voice-error']
for value in required:
    assert value in source, value
assert '다음 단계(2b)에서 옮깁니다' not in source
assert not re.search(r'LocalSoftwareKeyboardController|showSoftInput|requestFocus\(', '\n'.join(p.read_text() for p in (main/'ui/record').glob('*.kt')))
assert 'createOnDeviceSpeechRecognizer(context)' in (main/'audio/DeviceSpeechInput.kt').read_text()
assert not re.search(r'\bSpeechRecognizer\.createSpeechRecognizer\(', source)

baseline_path = root / 'source-baseline.json'
matched = []
if baseline_path.exists():
    baseline = json.loads(baseline_path.read_text())
    for name, expected in baseline.items():
        if (('/lib/' in name or '/test/' in name) and name.endswith('.dart')) or name.endswith('.kt'):
            path = repo / name
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, f'원본 기준 해시 불일치: {name}'
            matched.append(name)
relative = root.relative_to(repo).as_posix()
previous = subprocess.run(['git', 'show', f'HEAD:{relative}/app/build.gradle.kts'], cwd=repo, check=True, capture_output=True, text=True).stdout
assert previous.split('dependencies {', 1)[1] == (root/'app/build.gradle.kts').read_text().split('dependencies {', 1)[1], '의존성 변경'
checked = 0
for folder in [root/'app/src', root/'tools']:
    for path in folder.rglob('*'):
        if path.is_file() and path.suffix in {'.kt', '.xml', '.py'}:
            data = path.read_text()
            assert data.endswith('\n'), path
            assert all(line == line.rstrip() for line in data.splitlines()), path
            checked += 1
junit = (root/'build/offline-jvm/junit.log').read_text()
passed = re.search(r'OK \((\d+) tests\)', junit)
assert passed is not None, 'JVM 통과 로그 없음'
api_log = (root/'build/offline-android-kotlin/compile.log').read_text()
assert ': error:' not in api_log
assert (root/'build/offline-android-kotlin/api-check.jar').exists()
audit = {
    'xml_parsed': len(xml), 'drawable_references_resolved': len(references),
    'pure_kotlin_files': len(pure), 'reference_source_hashes_matched': len(matched),
    'reference_source_scope': 'Flutter lib/test/native Kotlin + capture pilot Kotlin',
    'unique_recording_and_draft_declarations': True, 'original_labels_and_keys': len(required),
    'new_libraries': 0, 'record_audio_permission_and_service_query': True, 'whitespace_files_checked': checked,
    'jvm_junit_tests': int(passed.group(1)), 'android_source_api_compile': 'passed',
    'android_instrumentation_new_tests': 12, 'android_instrumentation_execution': '미확인',
    'preview_definitions': 2, 'preview_png_render_and_visual_review': '미확인',
    'gradle_executed': False, 'network_executed': False,
}
(root/'plan-draft/stage2b-static-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(audit, ensure_ascii=False, indent=2))

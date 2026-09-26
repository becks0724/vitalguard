#!/usr/bin/env python3
"""Gradle/네트워크 없이 기존 캐시의 Kotlin 2.4.0 + JUnit으로 순수 JVM 경계를 검증한다.
Android 리소스/Compose/계측 검증을 대체하지 않는다. 새 의존성을 내려받지 않는다.
"""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
cache = Path(os.environ.get('FIELD_KOTLIN_CACHE', str(Path.home() / '.gradle/caches/modules-2/files-2.1')))
java = Path(os.environ.get('FIELD_JAVA', '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java'))
def jar(group, name, version):
    matches = list((cache / group / name / version).glob(f'*/{name}-{version}.jar'))
    if len(matches) != 1:
        raise SystemExit(f'기존 캐시 없음/모호함: {group}:{name}:{version}; 네트워크 조회 없이 중단')
    return str(matches[0])
stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.4.0')
coroutines = jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.10.2')
annotations = jar('org.jetbrains', 'annotations', '13.0')
compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.4.0'), stdlib,
    jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.4.0'),
    jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'), coroutines, annotations]
classpath = [stdlib, coroutines, annotations, jar('org.json', 'json', '20240303'),
    jar('junit', 'junit', '4.13.2'), jar('org.hamcrest', 'hamcrest-core', '1.3'),
    jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-test-jvm', '1.10.2')]
main = root / 'app/src/main/kotlin/com/vitalguard/field'
sources = [p for p in (main / 'data').rglob('*.kt') if p.name not in {'DeviceLocalStore.kt', 'NetworkNative.kt'}]
sources += [main / p for p in ['capture/CaptureModels.kt', 'capture/CapturePipeline.kt', 'capture/CaptureAuthor.kt',
    'ui/record/RecordActions.kt', 'ui/outbox/OutboxUiController.kt', 'ui/shell/ShellController.kt',
    'ui/site/SiteSummaryController.kt', 'ui/auth/AuthUiController.kt']]
tests = sorted(p for p in (root / 'app/src/test/kotlin').rglob('*.kt') if p.name != 'BackgroundContrastTest.kt')
output = root / 'build/offline-jvm'
output.mkdir(parents=True, exist_ok=True)
(output / "tmp").mkdir(exist_ok=True)
args = [str(java), "-Djava.io.tmpdir=" + str(output / "tmp"), '-cp', os.pathsep.join(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', os.pathsep.join(classpath),
    '-d', str(output / 'tests.jar')] + [str(p) for p in sorted(sources) + tests]
result = subprocess.run(args, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(output / 'compile.log').write_text(result.stdout)
print(result.stdout, end='')
if result.returncode:
    raise SystemExit(result.returncode)
if '--compile-only' in sys.argv:
    print('Offline pure Kotlin compilation passed (no Gradle).')
    raise SystemExit(0)
classes = ['com.vitalguard.field.' + p.stem for p in tests if p.name.endswith('Test.kt')]
result = subprocess.run([str(java), "-Djava.io.tmpdir=" + str(output / "tmp"), '-cp', os.pathsep.join([str(output / 'tests.jar'), str(root / 'app/src/test/resources')] + classpath),
    'org.junit.runner.JUnitCore'] + classes, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(output / 'junit.log').write_text(result.stdout)
print(result.stdout, end='')
raise SystemExit(result.returncode)

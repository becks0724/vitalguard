#!/usr/bin/env python3
"""캐시 AAR + Android SDK로 Kotlin/Compose 소스의 API 일치만 검사한다. Gradle/네트워크 실행 없음.
R/BuildConfig는 이름 검사 스텁이며 리소스 링크·manifest merge·APK·계측 실행 검증이 아니다.
클래스패스는 정확한 Gradle 의존성 해석 결과가 아니다. 선택 캐시 목록을 로그로 남긴다.
"""
import os
from pathlib import Path
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
cache = Path(os.environ.get('FIELD_KOTLIN_CACHE', str(Path.home() / '.gradle/caches/modules-2/files-2.1')))
java = Path(os.environ.get('FIELD_JAVA', '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java'))
android = Path(os.environ.get('FIELD_ANDROID_JAR', str(Path.home() / 'Library/Android/sdk/platforms/android-37.0/android.jar')))
output = root / 'build/offline-android-kotlin'
output.mkdir(parents=True, exist_ok=True)
(output / "tmp").mkdir(exist_ok=True)
def jar(group, name, version):
    matches = list((cache/group/name/version).glob(f'*/{name}-{version}.jar'))
    if len(matches) != 1: raise SystemExit(f'캐시 없음: {group}:{name}:{version}. 내려받지 않고 중단')
    return str(matches[0])
stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.4.0')
compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.4.0'), stdlib,
    jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.4.0'), jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
    jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.10.2'), jar('org.jetbrains', 'annotations', '13.0')]
plugin = jar('org.jetbrains.kotlin', 'kotlin-compose-compiler-plugin-embeddable', '2.4.0')
classpath = [str(android), stdlib, compiler[-1]]
selected = []
for group in sorted(cache.iterdir()):
    if not (group.name.startswith(('androidx.', 'com.google.', 'org.jetbrains.kotlinx')) or group.name in {'junit','org.hamcrest','com.android.tools.screenshot'}): continue
    for module in sorted(group.iterdir()):
        versions = [v for v in module.iterdir() if re.fullmatch(r'\d+(\.\d+)*', v.name)]
        if module.name == 'screenshot-validation-api': versions = [module/'0.0.1-alpha15']
        if not versions: continue
        version = max(versions, key=lambda v: tuple(int(s) for s in re.findall(r'\d+', v.name)))
        for file in sorted(version.glob('*/*')):
            if file.suffix not in {'.jar','.aar'} or file.name.endswith(('-sources.jar','-javadoc.jar')): continue
            if file.suffix == '.aar' and (group/(module.name+'-android')).exists(): continue
            selected.append(str(file))
            if file.suffix == '.jar': classpath.append(str(file)); continue
            with zipfile.ZipFile(file) as archive:
                for entry in archive.namelist():
                    if entry == 'classes.jar' or (entry.startswith('libs/') and entry.endswith('.jar')):
                        target=output/'aar-jars'/group.name/module.name/version.name/entry
                        target.parent.mkdir(parents=True,exist_ok=True)
                        target.write_bytes(archive.read(entry)); classpath.append(str(target))
(output/'classpath.txt').write_text('\n'.join(selected))
res=root/'app/src/main/res'
resources={}
for folder in res.iterdir():
    kind=folder.name.split('-')[0]
    if kind=='values': continue
    resources.setdefault(kind,set()).update(p.stem for p in folder.iterdir() if p.is_file())
stub=output/'ResourceNames.kt'
stub.write_text('package com.vitalguard.field\nobject BuildConfig { const val VG_MOCK = true }\nobject R {\n' +
    '\n'.join('object '+kind+' {\n'+'\n'.join(f'const val {name} = {index+1}' for index,name in enumerate(sorted(names)))+'\n}' for kind,names in resources.items())+'\n}\n')
sources=[]
for sourceSet in ('main','androidTest','screenshotTest'):
    sources += sorted((root/f'app/src/{sourceSet}/kotlin').rglob('*.kt'))
result=subprocess.run([str(java),"-Djava.io.tmpdir="+str(output/"tmp"),'-cp',os.pathsep.join(compiler),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib','-no-reflect','-jvm-target','17','-Xplugin='+plugin,'-classpath',os.pathsep.join(classpath),
    '-d',str(output/'api-check.jar'),str(stub)]+[str(p) for p in sources],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(output/'compile.log').write_text(result.stdout)
print(result.stdout,end='')
if result.returncode==0: print('Cached Android/Compose source API check passed. Resources/APK/instrumentation remain unverified.')
raise SystemExit(result.returncode)

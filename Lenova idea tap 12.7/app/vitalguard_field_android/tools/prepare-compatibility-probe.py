#!/usr/bin/env python3
"""Prepare an isolated, same-signer READ-ONLY instrumentation APK source tree.

Does not build, install or run anything. The target application's data never leaves
the device. The ordinary app source/manifest are not changed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
destination = args.destination.resolve()
if destination.exists():
    raise SystemExit("Choose a new destination; existing files are not overwritten.")
destination.mkdir(parents=True)
for name in ("build.gradle.kts", "settings.gradle.kts", "gradle.properties", "gradlew", "local.properties"):
    if (source / name).is_file():
        shutil.copy2(source / name, destination / name)
shutil.copytree(source / "gradle", destination / "gradle")
main = destination / "app/src/main"
main.mkdir(parents=True)
shutil.copy2(source / "tools/compatibility-probe/build.gradle.kts", destination / "app/build.gradle.kts")
production = source / "app/src/main/kotlin/com/vitalguard/field"
selected = [production / "data/live" / name for name in ("DeviceLocalStore.kt", "QueuedFileStore.kt", "LocalStorePaths.kt")]
selected += list((production / "data/models").glob("*.kt"))
selected += [production / "data/contracts/FieldContracts.kt", production / "data/OutboxController.kt", production / "data/record/InkStroke.kt"]
for path in selected:
    target = main / "kotlin/com/vitalguard/field" / path.relative_to(production)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
manifest = destination / "app/src/main/AndroidManifest.xml"
ns = "{http://schemas.android.com/apk/res/android}"
ET.register_namespace("android", ns[1:-1])
root = ET.Element("manifest")
ET.SubElement(root, "application", {ns + "name": "android.app.Application",
    ns + "label": "VitAlGuard compatibility probe", ns + "allowBackup": "false"})
ET.SubElement(root, "instrumentation", {
    ns + "name": "com.vitalguard.field.compatibility.StorageCompatibilityProbe",
    ns + "targetPackage": "com.vitalguard.field",
    ns + "functionalTest": "true",
})
ET.ElementTree(root).write(manifest, encoding="utf-8", xml_declaration=True)
probe = source / "tools/compatibility-probe/StorageCompatibilityProbe.kt"
out = destination / "app/src/main/kotlin/com/vitalguard/field/compatibility/StorageCompatibilityProbe.kt"
out.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(probe, out)
hashes = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in selected}
(destination / "probe-source-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
print("Prepared isolated read-only probe source:", destination)
print("Build assembleRelease with -PreleaseSigningProperties=<existing Flutter key.properties>.")
print("Verify the APK signer matches the installed Flutter APK before installing the probe.")

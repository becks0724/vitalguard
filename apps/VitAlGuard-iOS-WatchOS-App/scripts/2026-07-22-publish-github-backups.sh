#!/bin/zsh
# Sync only the Xcode source required to rebuild VitAlGuard on another Mac.
# This script is invoked by the shared Xcode Archive scheme after a successful archive.

set -euo pipefail

script_dir="${0:A:h}"
source_root="${script_dir:h}"
workspace_root="${source_root:h}"
ios_backup_repo="${VITALGUARD_IOS_BACKUP_REPO:-${workspace_root}/2026-07-08-vitalguard-ios-watchos-app-backup-work}"
jodal_repo="${VITALGUARD_JODAL_REPO:-${workspace_root}/2026-07-08-vitalguard-jodalcheong-source-readonly}"
jodal_app_path="apps/VitAlGuard-iOS-WatchOS-App"
workflow_name="2026-07-22-create-github-release.yml"
safety_check_script="${script_dir}/2026-07-22-verify-fall-fail-open.sh"

allowed_paths=(Phone Watch VitAlGuard.xcodeproj project.yml scripts)
sync_directories=(Phone Watch VitAlGuard.xcodeproj scripts)
for required_path in "${allowed_paths[@]}"; do
  [[ -e "${source_root}/${required_path}" ]] || { print -u2 "Missing required source path: ${required_path}"; exit 1; }
done
[[ -x "${safety_check_script}" ]] || { print -u2 "Missing executable fall-safety check."; exit 1; }
"${safety_check_script}" "${source_root}"

versions=(${(f)$(sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([0-9]+(\.[0-9]+)*)"?[[:space:]]*$/\1/p' "${source_root}/project.yml" | sort -u)})
builds=(${(f)$(sed -nE 's/^[[:space:]]*CURRENT_PROJECT_VERSION:[[:space:]]*"?([0-9]+)"?[[:space:]]*$/\1/p' "${source_root}/project.yml" | sort -u)})
(( ${#versions} == 1 && ${#builds} == 1 )) || { print -u2 "All targets must use one shared version and build number."; exit 1; }
version="${versions[1]}"
build="${builds[1]}"
pushed_at="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S KST')"

forbidden_file=$(find "${source_root}/Phone" "${source_root}/Watch" "${source_root}/VitAlGuard.xcodeproj" -type f \( \
  -iname '*.p12' -o -iname '*.cer' -o -iname '*.key' -o -iname '*.pem' -o \
  -iname '*.mobileprovision' -o -iname '*.provisionprofile' -o -iname '*.ipa' -o \
  -iname '*.xcarchive' -o -iname '*.dSYM' \
\) -print -quit)
[[ -z "${forbidden_file}" ]] || { print -u2 "Refusing to publish restricted file: ${forbidden_file}"; exit 1; }

if rg -n --hidden --glob '!*.png' --glob '!*.jpg' --glob '!*.jpeg' --glob '!*.pdf' \
  '(ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}|-----BEGIN( [A-Z]+)? PRIVATE KEY-----|xox[baprs]-|sk-[A-Za-z0-9]{16,})' \
  "${source_root}/Phone" "${source_root}/Watch" "${source_root}/VitAlGuard.xcodeproj" "${source_root}/project.yml"; then
  print -u2 'Refusing to publish a possible credential. Remove it before retrying.'
  exit 1
fi

verify_repo() {
  local repository="$1"
  local expected_remote="$2"
  [[ -d "${repository}/.git" ]] || { print -u2 "Not a Git repository: ${repository}"; exit 1; }
  [[ "$(git -C "${repository}" remote get-url origin)" == "${expected_remote}" ]] || {
    print -u2 "Unexpected origin for ${repository}"; exit 1
  }
  [[ -z "$(git -C "${repository}" status --porcelain)" ]] || {
    print -u2 "Repository has uncommitted changes: ${repository}"; exit 1
  }
  git -C "${repository}" fetch origin main
  if git -C "${repository}" merge-base --is-ancestor HEAD origin/main; then
    git -C "${repository}" merge --ff-only origin/main
  elif ! git -C "${repository}" merge-base --is-ancestor origin/main HEAD; then
    print -u2 "Repository diverged from origin/main; resolve it before publishing."
    exit 1
  fi
}

sync_directory() {
  local destination_root="$1"
  local relative_path="$2"
  mkdir -p "${destination_root}/${relative_path}"
  rsync -a --delete \
    --exclude '.DS_Store' \
    --exclude 'xcuserdata/' \
    --exclude '*.xcuserstate' \
    --exclude 'DerivedData/' \
    --exclude 'build/' \
    --exclude '*.xcarchive' \
    --exclude '*.dSYM' \
    --exclude '*.ipa' \
    --exclude '*.mobileprovision' \
    --exclude '*.provisionprofile' \
    --exclude '*.p12' --exclude '*.cer' --exclude '*.key' --exclude '*.pem' \
    "${source_root}/${relative_path}/" "${destination_root}/${relative_path}/"
}

sync_file() {
  local destination_root="$1"
  mkdir -p "${destination_root}/.github/workflows"
  cp "${source_root}/project.yml" "${destination_root}/project.yml"
  cp "${source_root}/.github/workflows/${workflow_name}" "${destination_root}/.github/workflows/${workflow_name}"
}

commit_tag_and_push() {
  local repository="$1"
  local tag="$2"
  shift 2
  if [[ -n "$(git -C "${repository}" status --porcelain -- "$@")" ]]; then
    if git -C "${repository}" rev-parse -q --verify "refs/tags/${tag}" >/dev/null || \
       git -C "${repository}" ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
      print -u2 "Tag ${tag} already exists; increase the build number before publishing changed source."
      exit 1
    fi
  fi
  git -C "${repository}" add -A -- "$@"
  if ! git -C "${repository}" diff --cached --quiet; then
    git -C "${repository}" commit -m "chore(release): VitAlGuard ${version} (build ${build}) · pushed ${pushed_at}"
    git -C "${repository}" tag -a "${tag}" \
      -m "VitAlGuard ${version} (build ${build})" \
      -m "Version: ${version}" \
      -m "Build: ${build}" \
      -m "Pushed at: ${pushed_at}"
    git -C "${repository}" push origin main
    git -C "${repository}" push origin "${tag}"
  else
    print "No source changes to publish for ${repository}."
  fi
}

verify_repo "${ios_backup_repo}" 'https://github.com/qwertyyjh/VitAlGuard-iOS-WatchOS-App-Backup.git'
verify_repo "${jodal_repo}" 'https://github.com/becks0724/vitalguard.git'

for sync_path in "${sync_directories[@]}"; do
  sync_directory "${ios_backup_repo}" "${sync_path}"
  sync_directory "${jodal_repo}/${jodal_app_path}" "${sync_path}"
done
sync_file "${ios_backup_repo}"

commit_tag_and_push "${ios_backup_repo}" "v${version}-build.${build}" Phone Watch VitAlGuard.xcodeproj project.yml scripts .github/workflows/${workflow_name}
commit_tag_and_push "${jodal_repo}" "vitalguard-v${version}-build.${build}" "${jodal_app_path}"

print "Published VitAlGuard ${version} (build ${build}) at ${pushed_at} to both private GitHub repositories."

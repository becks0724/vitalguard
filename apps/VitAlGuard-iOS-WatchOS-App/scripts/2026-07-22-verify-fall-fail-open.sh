#!/bin/zsh
# Blocks publishing if a low-confidence impact model can silence or create a fall alert.

set -euo pipefail

source_root="${1:?Pass the VitAlGuard source root.}"
fusion_file="${source_root}/Watch/Sources/MLFusion.swift"
workout_file="${source_root}/Watch/Sources/WorkoutManager.swift"

[[ -f "${fusion_file}" && -f "${workout_file}" ]] || {
  print -u2 'Missing fall-detection source files.'
  exit 1
}

if rg -n 'rejectedByImpactML|rescuedByML|ML 구제 낙상|impact ML 근거 부족' "${fusion_file}" "${workout_file}"; then
  print -u2 'Fail-open violation: impact ML must not decide fall alerts.'
  exit 1
fi

if rg -n 'p\.imp\s*(<|>=|<=|>)\s*FallMLPipeline\.impactThreshold' "${fusion_file}"; then
  print -u2 'Fail-open violation: impact threshold must not gate MLFusion alerts.'
  exit 1
fi

rg -q 'if vetoedByML \{ return false \}' "${fusion_file}" || {
  print -u2 'Missing verified work-veto suppression guard.'
  exit 1
}
rg -q 'return candidate\.isFall' "${fusion_file}" || {
  print -u2 'Missing rule-track fail-open alert path.'
  exit 1
}

print 'Fall fail-open safety check passed: only the work-veto may suppress a rule-confirmed fall.'

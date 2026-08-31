// 착용 상태 표식 표본 — 벗음/착용 전이 순간 서버에 즉시 알리는 최소 행(순수 · 시험 가능)
package com.vitalguard.wear.pipeline

object WornMarker {
    /**
     * `worn` + `ts` 두 키만 — 생체값 없는 이벤트 행. 서버 스키마(`worn: boolean` · packages/schemas)와
     * 키 이름이 맞물린다(가드가 대조). 평시 표본의 `worn:true` 는 SampleBuilder 가 싣는다.
     */
    fun build(worn: Boolean, nowMs: Long): Map<String, Any> =
        linkedMapOf<String, Any>("worn" to worn, "ts" to IsoMs.format(nowMs))
}

// 착용 상태 표식 표본 — 벗음/착용 전이 순간 서버에 즉시 알리는 최소 행(순수 · 시험 가능)
package com.vitalguard.wear.pipeline

object WornMarker {
    /**
     * `worn` + `ts` 두 키만 — 생체값 없는 이벤트 행. 서버 스키마(`worn: boolean` · packages/schemas)와
     * 키 이름이 맞물린다(가드가 대조). 평시 표본의 `worn:true` 는 SampleBuilder 가 싣는다.
     */
    fun build(worn: Boolean, nowMs: Long): Map<String, Any> =
        linkedMapOf<String, Any>("worn" to worn, "ts" to IsoMs.format(nowMs))

    /**
     * 미착용 중 배터리 표본 — 충전 구간이 관제에 남는 **유일한** 경로(2026-09-03).
     *
     * 왜 필요한가(실측). 벗으면 `endSensing` 이 엔진을 세우고 빌더를 비우므로 `buildAndReset` 이
     * null 을 낸다 — 앱과 tick 은 멀쩡히 도는데 **행이 아예 안 생긴다.** 그런데 충전은 거의 항상
     * 벗은 상태에서 일어난다. 09-03 실측 = 워치는 `status:2`(무선 독 충전 · +288mA)를 알고 있는데
     * 서버에는 9분간 표본 0건이었다. 관제 배터리 차트의 충전 음영이 **데이터를 받을 수 없었다.**
     *
     * ★ `worn:false` 를 함께 싣는 이유가 둘이다.
     *   ① **사실이다** — 이 표본은 미착용 중에만 만들어진다.
     *   ② 그래서 **서버를 안 고쳐도 된다** — `hasMonitorableSignal` 의 `typeof s.worn === "boolean"`
     *      이 이미 통과시킨다. 게이트에 배터리를 넣는 길도 있었지만, 그러면 폰(iOS)이 매 표본에
     *      싣는 `batteryPct` 까지 행 자격을 얻어 범위가 의도보다 넓어진다.
     *
     * ⚠ **"배터리만으로 행을 만들지 않는다"(BatteryChargeTest)와 부딪치지 않는다.** 그 계약은
     *   `SampleBuilder.buildAndReset` 의 것이고 여기는 별도 경로다. 그 계약의 취지("DB 가 배터리
     *   로그가 된다")도 지켜진다 — 주기 10분에 **자동 로그아웃(미착용 90분)이 상한을 씌워**
     *   미착용 에피소드당 최대 9행이다. 밤새 충전해도 9행에서 멈춘다(자격이 지워지면 안 보낸다).
     *
     * 잔량을 못 읽으면 null — 할 말이 없는 행은 만들지 않는다.
     */
    fun idleBattery(nowMs: Long, pct: Int?, chargeUah: Long?, status: Int?): Map<String, Any>? {
        if (pct == null) return null
        val v = linkedMapOf<String, Any>(
            "worn" to false,
            "ts" to IsoMs.format(nowMs),
            "batteryPct" to pct,
        )
        chargeUah?.let { v["batteryChargeUah"] = it }
        status?.let { v["batteryStatus"] = it }
        return v
    }
}

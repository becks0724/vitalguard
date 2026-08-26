// flush 1회 → 병합 항목 1건 — 서버 UNIQUE(worker_id, ts) 계약상 한 flush 의 모든 값은 한 항목에 실린다
package com.vitalguard.wear.pipeline

import com.vitalguard.wear.source.LocationFix

/**
 * iOS 배치 병합 규칙의 이식. 다른 점 하나 — iOS 는 여러 심박 항목을 배치에 담고 서버가
 * ts 충돌로 뒤 항목을 조용히 버렸다(2026-08-14 가드 주석). 여기서는 처음부터 **한 항목**만
 * 만든다. 실질 도착률은 같고(플러시당 1행) 유실이 설계가 된다.
 *
 * 값 규칙 — **측정된 것만 싣는다.** 빈 필드를 0 으로 채우면 "측정했는데 0" 이 되고,
 * 직전 값 복사 전송은 DB 에 가짜 밀도를 만든다(구 앱 HRV 사고). 측정 시각은 ts(전송 시각)와
 * 별개 키(heartRateMeasuredAt·spo2MeasuredAt)로 싣는다 — 세 시각 구분 계약.
 */
class SampleBuilder {

    private var bpm: Int? = null
    private var bpmAtMs: Long? = null
    private var spo2Pct: Int? = null
    private var spo2AtMs: Long? = null
    private var hrvMs: Double? = null
    private var skinC: Double? = null
    private var ambientC: Double? = null
    private var energyKcal = 0.0
    private var steps = 0
    private var flights = 0

    fun heartRate(bpm: Int, atMs: Long) { this.bpm = bpm; this.bpmAtMs = atMs }
    fun spo2(pct: Int, atMs: Long) { this.spo2Pct = pct; this.spo2AtMs = atMs }
    fun hrvSdnn(ms: Double) { this.hrvMs = ms }
    fun skinTemp(objectC: Double, ambientC: Double?) { this.skinC = objectC; this.ambientC = ambientC }

    /** 걸음·오른층·에너지는 **구간 증분** — 하루 누적을 보내면 서버 상한(5000·500)에서 통째로 스트립된다. */
    fun addEnergyKcal(delta: Double) { energyKcal += delta }
    fun addSteps(delta: Int) { steps += delta }
    fun addFlights(delta: Int) { flights += delta }

    /**
     * 병합 항목을 만들고 버퍼를 비운다(측정 순간 값의 1회 소비 — 복사 전송 구조적 차단).
     * 실을 것이 하나도 없으면 null — 단, iOS 규칙대로 **무동작 지속만은 단독 전송**한다
     * (벗어둔 것인지 쓰러진 것인지를 가르는 재료가 정확히 그 구간에 필요하다).
     */
    fun buildAndReset(
        sentAtMs: Long,
        stillSec: Double? = null,
        variabilityMg: Int? = null,
        batteryPct: Int? = null,
        /**
         * 배터리 잔량 **충전카운터**(µAh). 퍼센트는 정수라 1% 계단(445mAh 기준 4,450µAh)
         * 아래를 못 본다 — 6.6%/h 로 떨어져도 한 계단에 9분이 걸린다. 이 값은 µAh 단위라
         * **해상도가 약 100배**이고, 표본 두 개만 있으면 그 사이 소모율이 바로 나온다.
         * 08-26 실측 = 100초에 4,680µAh(→168mAh/h) 를 퍼센트 계단 없이 읽어냈다.
         */
        batteryChargeUah: Long? = null,
        fix: LocationFix? = null,
    ): Map<String, Any>? {
        val v = LinkedHashMap<String, Any>()
        bpm?.let {
            v["heartRate"] = it
            bpmAtMs?.let { at -> v["heartRateMeasuredAt"] = IsoMs.format(at) }
        }
        spo2Pct?.let {
            v["spo2"] = it
            spo2AtMs?.let { at -> v["spo2MeasuredAt"] = IsoMs.format(at) }
        }
        hrvMs?.let { v["hrvSdnnMs"] = it }
        skinC?.let { v["skinTempC"] = it }
        ambientC?.let { v["ambientTempC"] = it }
        if (energyKcal > 0) v["activeEnergyKcal"] = energyKcal
        if (steps > 0) v["steps"] = steps
        if (flights > 0) v["flightsClimbed"] = flights

        val measuredSomething = v.isNotEmpty()
        if (measuredSomething) {
            stillSec?.let { v["motionStillSec"] = it }
            variabilityMg?.let { v["motionVariabilityMg"] = it }
            batteryPct?.let { v["batteryPct"] = it }
            batteryChargeUah?.let { v["batteryChargeUah"] = it }
        } else if (stillSec != null) {
            v["motionStillSec"] = stillSec        // 단독 전송 — iOS flush 의 그 규칙
            batteryPct?.let { v["batteryPct"] = it }
            batteryChargeUah?.let { v["batteryChargeUah"] = it }
        } else {
            reset()
            return null
        }
        // 좌표 4종은 한 덩어리 — 항목이 있을 때만 얹고(행 수 불증가), 일부만 싣지 않는다(iOS 규칙).
        fix?.let {
            v["latitude"] = it.latitude
            v["longitude"] = it.longitude
            v["locationAccuracyMeters"] = it.accuracyMeters
            v["locationTimestamp"] = IsoMs.format(it.atMs)
        }
        v["ts"] = IsoMs.format(sentAtMs)
        reset()
        return v
    }

    private fun reset() {
        bpm = null; bpmAtMs = null; spo2Pct = null; spo2AtMs = null
        hrvMs = null; skinC = null; ambientC = null
        energyKcal = 0.0; steps = 0; flights = 0
    }
}

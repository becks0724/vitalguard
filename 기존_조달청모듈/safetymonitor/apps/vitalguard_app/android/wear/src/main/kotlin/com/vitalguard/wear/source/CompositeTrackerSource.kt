// 소스 합성 — 삼성 SDK 가 막혀도(파트너 미승인·기기 미지원) 순정 심박은 계속 온다
package com.vitalguard.wear.source

/**
 * 왜 합치나 — 두 소스가 서로를 대체하지 않고 **보완**한다.
 *   · 순정(SensorManager)  심박·가속도. 승인 불필요. **항상 되는 바닥**
 *   · 삼성(Sensor SDK)     SpO₂·피부온·주변온·IBI. 개발자 모드 필요
 *
 * 삼성이 실패해도 바닥은 남는다 — 08-25 실기에서 SpO₂·체온이 `--` 였던 이유가
 * "삼성 소스를 아직 안 붙였다" 였고, 그때도 심박은 정상이었다. 그 관계를 구조로 굳힌다.
 *
 * ⚠ 심박이 양쪽에서 올 수 있다. 삼성 쪽이 IBI 를 함께 주므로 **삼성이 오면 그것을 쓰고**,
 *   순정 심박은 삼성이 조용한 동안의 대체로만 둔다(둘 다 실으면 표본이 두 배가 된다).
 */
class CompositeTrackerSource(
    private val primary: TrackerSource,
    private val fallback: TrackerSource,
    /** 삼성 심박이 이 시간 안에 왔으면 순정 심박은 버린다. */
    private val primaryFreshMs: Long = 15_000,
) : TrackerSource {

    /** 삼성 심박의 마지막 도착 시각 — 두 소스가 다른 스레드에서 오므로 원자 변수로 둔다. */
    private val lastPrimaryHrAtMs = java.util.concurrent.atomic.AtomicLong(0L)

    override fun start(listener: TrackerListener) {

        primary.start(object : TrackerListener by listener {
            override fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long) {
                // ★ 비교 기준은 **벽시계 하나로 통일**한다. 삼성 DataPoint.timestamp 와
                //   순정 SensorEvent 의 시간 기준이 다르면 뺄셈이 음수로 감겨 순정 심박이
                //   영구 억제된다(08-25 실기에서 체온만 오고 HR 이 안 뜬 원인 후보 1순위).
                lastPrimaryHrAtMs.set(System.currentTimeMillis())
                listener.onHeartRate(bpm, ibiMs, ibiStatus, atMs)
            }
        })
        fallback.start(object : TrackerListener by listener {
            override fun onHeartRate(bpm: Int, ibiMs: List<Int>, ibiStatus: List<Int>, atMs: Long) {
                // 삼성이 최근에 줬으면 중복이므로 버린다(같은 벽시계로 비교).
                if (System.currentTimeMillis() - lastPrimaryHrAtMs.get() > primaryFreshMs) {
                    listener.onHeartRate(bpm, ibiMs, ibiStatus, atMs)
                }
            }
        })
    }

    override fun stop() {
        runCatching { primary.stop() }
        runCatching { fallback.stop() }
    }
}

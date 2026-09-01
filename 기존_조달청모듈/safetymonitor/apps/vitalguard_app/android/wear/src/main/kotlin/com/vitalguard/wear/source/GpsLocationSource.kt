// LocationSource 실구현 — 폴백은 상시 구독, 위성은 tick 마다 단발 (Play Services 의존 0)
package com.vitalguard.wear.source

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.util.Log
import java.util.concurrent.Executor

/**
 * 배터리 기준 프로파일(08-24 확정)의 위치 60초 듀티 구현. 간격은 상수일 뿐 확정값이 아니다 —
 * 실측 ⑥(1시간 %/h)이 모델을 보정하면 함께 재확정한다.
 *
 * ★ **08-26 = `GPS_PROVIDER` 단독 → `FUSED` 단독.** 위성만 보면 **실내에서 fix 가 영영 안 온다**
 * (실측: 최근 10분 위경도 0건 · 권한은 부여돼 있었으니 공급자 문제였다).
 *
 * ★★ **09-01 = FUSED 단독 → 폴백 상시 구독 + 위성 단발(사용자 지시).** FUSED 로 옮기고 나니 이번엔
 * **위성이 영영 안 켜졌다.** `LocationManager` 의 구형 호출에는 정확도 요구 인자가 없어서, 요구가
 * 없으면 시스템이 제일 싼 것(기지국·wifi)만 내준다. 실측이 그대로였다 —
 * ```
 * gnss  0.00269 mAh   누적 가동 198ms / 8시간 26분      ← 위성이 사실상 한 번도 안 돌았다
 * 좌표 품질  표본 946건 → 좌표 244건 → 오차 50m 이하 78건 = 8.2%
 * ```
 * 구획 이탈 판정은 `fixUsableForJudgment`(>50m 버림)를 통과한 것만 쓰므로, **위치가 전체 표본의
 * 8%로만 돌고 있었다.** 위성을 되살리니 같은 날 실측이 **평균 82.6m → 13.4m · 판정 가능 32% → 100%**
 * 로 갈렸다. FUSED 는 실내 폴백으로 그대로 둔다 — 위성은 실내에서 안 잡히므로 폴백은 필수다.
 *
 * ⚠⚠ **그러나 위성을 '구독' 하면 안 된다.** 같은 날 실측: 구독을 걸어 두면 GNSS 가 계속 켜져 있어
 * 실내 fix 0건 구간에서도 86% 가동, 소모가 **51 → 87.8 mAh/h**(수명 9.3 → 5.4시간)로 뛰었다.
 * 그래서 위성은 [requestSatelliteFix] 의 **단발 요청**으로만 켠다.
 *
 * ⚠ **정확도가 크게 갈린다**(위성 ±5m ↔ 기지국 ±1,500m). 그래서 `accuracyMeters` 를 반드시 함께
 * 싣는다 — 이 값이 없으면 관제는 ±5m 와 ±1,500m 를 구별할 수 없고, 그러면 "건물 안 어디쯤" 이
 * "정확히 여기" 로 읽힌다. 이 프로젝트에는 그 필드가 빠져 **21만 GPS 행에 품질 지표가 없는**
 * 선례가 이미 있다(schemas/vital-stream.ts 주석).
 *
 * ⚠ **배터리** — 위성 연속 가동은 이 기기 전력 모델로 약 49 mAh/h 다(총 소모 51 mAh/h 와 맞먹는다).
 * 단발 요청의 비용은 **fix 소요 시간 ÷ tick 주기** 로 정해진다 — 핫스타트로 몇 초 안에 잡으면 무시할
 * 수준이고, 못 잡는 자리에서는 [fixTimeoutMs] 가 상한을 씌운 뒤 백오프가 간격을 벌린다.
 */
class GpsLocationSource(
    context: Context,
    private val handler: Handler,
    private val intervalMs: Long = 60_000,
    private val maxAgeMs: Long = 120_000,
    private val fixTimeoutMs: Long = 20_000,
) : LocationSource, LocationListener {

    private val manager = context.getSystemService(LocationManager::class.java)

    /** 콜백을 수집 스레드로 받는다 — 큐·엔진은 그 스레드 하나에서만 만진다는 서비스 계약. */
    private val executor = Executor { handler.post(it) }

    /** 위성을 단발로 켤 수 있는 기기인가 — 폴백이 이미 위성이면(구버전) 단발이 불필요하다. */
    private var satelliteOnDemand = false

    /** 요청이 떠 있는 중인가 — 겹쳐 쏘면 GNSS 가 꺼질 틈이 없다. */
    @Volatile private var inFlight = false

    /** 연속 실패 횟수. 실외로 나가면 0 으로 돌아간다. */
    @Volatile private var failures = 0

    /** 이 시각 전에는 위성을 켜지 않는다(백오프). */
    @Volatile private var nextAllowedAtMs = 0L

    /**
     * 떠 있는 타임아웃 예약. **`handler` 는 서비스와 공유한다** — `removeCallbacksAndMessages(null)`
     * 로 싹 지우면 tick 알람 콜백까지 날아간다. 내가 건 것만 이 참조로 회수한다.
     */
    private var pendingTimeout: Runnable? = null

    /** 위성 직접(`GPS_PROVIDER`) — 실외 ±5~15m. **실내에서는 영영 안 온다.** */
    @Volatile private var satelliteFix: LocationFix? = null

    /** 폴백(`FUSED`/네트워크) — 실내에서도 오지만 ±80~400m. 위성이 없을 때의 유일한 좌표다. */
    @Volatile private var fallbackFix: LocationFix? = null

    @SuppressLint("MissingPermission")   // 권한은 CollectorService 기동 전 화면(①)에서 받는다
    override fun start() {
        val available = runCatching { manager.allProviders }.getOrDefault(emptyList())
        val fallback = pickProvider(Build.VERSION.SDK_INT, available)
        subscribe(fallback)
        // ★★ 위성은 **구독하지 않는다.** 09-01 실측: 구독을 걸어 두면 GNSS 가 계속 켜져 있다 —
        //   실내에서 fix 0건인 채 86% 가동, 소모가 51 → 87.8 mAh/h(수명 9.3 → 5.4시간)로 뛰었다.
        //   대신 tick 마다 [requestSatelliteFix] 로 **한 번 재고 끄는** getCurrentLocation 을 쓴다.
        satelliteOnDemand =
            fallback != LocationManager.GPS_PROVIDER && available.contains(LocationManager.GPS_PROVIDER)
        failures = 0
        nextAllowedAtMs = 0L
    }

    /**
     * 위성 단발 요청 — 서비스 tick(120초)이 부른다.
     *
     * `getCurrentLocation` 은 **한 번 재고 GNSS 를 끄는** 플랫폼 호출이다(API 30+ · minSdk 30 확인).
     * 실패하면 백오프로 간격을 벌리고, 움직임이 감지되면 장소가 바뀌었다고 보고 즉시 다시 켠다.
     */
    @SuppressLint("MissingPermission")
    fun requestSatelliteFix(nowMs: Long, movingNow: Boolean) {
        if (!satelliteOnDemand) return
        if (movingNow && failures > 0) {
            Log.i(TAG, "움직임 감지 — 위성 백오프 해제(실패 ${failures}회 초기화)")
            failures = 0
            nextAllowedAtMs = 0L
        }
        if (!shouldRequestSatellite(nowMs, nextAllowedAtMs, inFlight, movingNow)) return
        inFlight = true
        val signal = CancellationSignal()
        // 타임아웃 = 우리가 끊는다. 안 끊으면 못 잡는 자리에서 GNSS 가 계속 돌 수 있다.
        cancelTimeout()
        val timeout = Runnable { if (inFlight) signal.cancel() }
        pendingTimeout = timeout
        handler.postDelayed(timeout, fixTimeoutMs)
        runCatching {
            manager.getCurrentLocation(LocationManager.GPS_PROVIDER, signal, executor) { loc ->
                onSatelliteResult(loc, System.currentTimeMillis())
            }
        }.onFailure {
            inFlight = false
            Log.w(TAG, "위성 단발 요청 실패: ${it.javaClass.simpleName}: ${it.message}")
        }
    }

    private fun cancelTimeout() {
        pendingTimeout?.let { handler.removeCallbacks(it) }
        pendingTimeout = null
    }

    private fun onSatelliteResult(location: Location?, nowMs: Long) {
        inFlight = false
        cancelTimeout()
        if (location == null) {
            failures++
            nextAllowedAtMs = nowMs + backoffMs(failures)
            Log.i(TAG, "위성 fix 실패 ${failures}회 — ${backoffMs(failures) / 1000}s 뒤 재시도")
            return
        }
        satelliteFix = LocationFix(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy.toDouble(),
            atMs = location.time,
        )
        failures = 0
        nextAllowedAtMs = 0L
        Log.i(TAG, "위성 fix 도착 — 정확도 ${location.accuracy}m")
    }

    @SuppressLint("MissingPermission")
    private fun subscribe(provider: String) {
        runCatching { manager.requestLocationUpdates(provider, intervalMs, 0f, this) }
            .onSuccess { Log.i(TAG, "위치 구독 공급자=$provider 간격=${intervalMs / 1000}s") }
            // ★ 실패를 삼키지 않는다 — 종전엔 runCatching 이 조용히 먹어서 "좌표가 왜 없나" 를
            //   기기 로그로 못 갈랐다. 사유가 남아야 공급자 문제인지 권한 문제인지 구별된다.
            .onFailure { Log.w(TAG, "위치 구독 실패(공급자=$provider): ${it.javaClass.simpleName}: ${it.message}") }
    }

    override fun stop() {
        runCatching { manager.removeUpdates(this) }
        cancelTimeout()
        inFlight = false
    }

    override fun currentFix(nowMs: Long): LocationFix? =
        pickFix(satelliteFix, fallbackFix, nowMs, maxAgeMs)

    override fun onLocationChanged(location: Location) {
        val fix = LocationFix(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy.toDouble(),
            atMs = location.time,
        )
        // 공급자 이름으로 가른다. FUSED 가 위성 유래 fix 를 `gps` 로 보고해도 위성 칸에 들어가는 게 맞다.
        if (location.provider == LocationManager.GPS_PROVIDER) {
            if (satelliteFix == null) Log.i(TAG, "위성 fix 첫 도착 — 정확도 ${fix.accuracyMeters}m")
            satelliteFix = fix
        } else {
            fallbackFix = fix
        }
    }

    companion object {
        const val TAG = "VgGps"

        /**
         * 공급자 선택 — 순수 함수라 실기 없이 시험한다.
         *
         * `FUSED_PROVIDER` 는 **API 31+** 상수다(이 워치는 37). minSdk 가 30 이라 하한을 확인하고,
         * 기기가 실제로 그 공급자를 등록했는지도 본다 — 상수가 있어도 공급자가 없는 기기가 있다.
         * 둘 중 하나라도 아니면 위성 GPS 로 떨어진다(종전 동작 = 안전한 폴백).
         */
        internal fun pickProvider(sdkInt: Int, available: Collection<String>): String =
            if (sdkInt >= Build.VERSION_CODES.S && available.contains(LocationManager.FUSED_PROVIDER)) {
                LocationManager.FUSED_PROVIDER
            } else {
                LocationManager.GPS_PROVIDER
            }

        /**
         * 두 공급자의 fix 중 하나를 고른다 — **신선한 것 중 가장 정확한 것.**
         *
         * ★ "위성이면 무조건 우선" 이 아니다. 하늘이 가리면 위성 fix 도 수백 m 로 튀는데, 그걸
         *   맹신하면 더 정확한 폴백을 버리게 된다. 정확도로 고르면 실외에서는 자연히 위성이
         *   이기고(±5~15m ↔ ±80~400m) 실내에서는 폴백이 이긴다 — 의도한 우선순위가 규칙 하나로 나온다.
         *
         * ⚠ 정확도가 **0 이하면 최후순위**로 민다. `Location.accuracy` 는 값이 없을 때 0 을 내는데,
         *   그대로 비교하면 **품질 미상이 항상 이긴다.** 단독 후보일 때는 그래도 쓴다(없는 것보단 낫다).
         */
        /**
         * 위성을 지금 켤 것인가 — 순수 함수라 실기 없이 시험한다.
         *
         * ⚠ `inFlight` 를 먼저 본다. 겹쳐 쏘면 **GNSS 가 꺼질 틈이 없어** 상시 구독과 같아진다 —
         *   이 게이트가 막으려던 바로 그 상태다.
         * ★ 움직였으면 백오프를 무시한다. 실내에서 실외로 나가는 전이가 정확히 그 순간이다.
         */
        internal fun shouldRequestSatellite(
            nowMs: Long,
            nextAllowedAtMs: Long,
            inFlight: Boolean,
            movingNow: Boolean,
        ): Boolean = when {
            inFlight -> false
            movingNow -> true
            else -> nowMs >= nextAllowedAtMs
        }

        /**
         * 실패 누적에 따른 재시도 간격. 첫 실패는 **바로 다음 tick**(120초)에 다시 본다 —
         * 잠깐 처마 밑이었을 수 있다. 계속 실패하면 실내로 보고 간격을 벌린다.
         */
        internal fun backoffMs(failures: Int): Long = when {
            failures <= 1 -> 0L
            failures == 2 -> 5 * 60_000L
            failures == 3 -> 10 * 60_000L
            else -> 15 * 60_000L
        }

        internal fun pickFix(
            satellite: LocationFix?,
            fallback: LocationFix?,
            nowMs: Long,
            maxAgeMs: Long,
        ): LocationFix? = listOfNotNull(satellite, fallback)
            .filter { nowMs - it.atMs <= maxAgeMs }
            .minByOrNull { if (it.accuracyMeters > 0.0) it.accuracyMeters else Double.MAX_VALUE }
    }
}

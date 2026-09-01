// LocationSource 실구현 — 위성·폴백 두 공급자를 60초 듀티로 함께 받는다 (Play Services 의존 0)
package com.vitalguard.wear.source

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.util.Log

/**
 * 배터리 기준 프로파일(08-24 확정)의 위치 60초 듀티 구현. 간격은 상수일 뿐 확정값이 아니다 —
 * 실측 ⑥(1시간 %/h)이 모델을 보정하면 함께 재확정한다.
 *
 * ★ **08-26 = `GPS_PROVIDER` 단독 → `FUSED` 단독.** 위성만 보면 **실내에서 fix 가 영영 안 온다**
 * (실측: 최근 10분 위경도 0건 · 권한은 부여돼 있었으니 공급자 문제였다).
 *
 * ★★ **09-01 = FUSED 단독 → 위성 + FUSED 둘 다 구독(사용자 지시).** FUSED 로 옮기고 나니 이번엔
 * **위성이 영영 안 켜졌다.** `LocationManager` 의 구형 호출에는 정확도 요구 인자가 없어서, 요구가
 * 없으면 시스템이 제일 싼 것(기지국·wifi)만 내준다. 실측이 그대로였다 —
 * ```
 * gnss  0.00269 mAh   누적 가동 198ms / 8시간 26분      ← 위성이 사실상 한 번도 안 돌았다
 * 좌표 품질  표본 946건 → 좌표 244건 → 오차 50m 이하 78건 = 8.2%
 * ```
 * 구획 이탈 판정은 `fixUsableForJudgment`(>50m 버림)를 통과한 것만 쓰므로, **위치가 전체 표본의
 * 8%로만 돌고 있었다.** 그래서 위성을 따로 구독해 되살린다. FUSED 는 실내 폴백으로 그대로 둔다 —
 * 위성은 실내에서 안 잡히므로 폴백은 선택이 아니라 필수다.
 *
 * ⚠ **정확도가 크게 갈린다**(위성 ±5m ↔ 기지국 ±1,500m). 그래서 `accuracyMeters` 를 반드시 함께
 * 싣는다 — 이 값이 없으면 관제는 ±5m 와 ±1,500m 를 구별할 수 없고, 그러면 "건물 안 어디쯤" 이
 * "정확히 여기" 로 읽힌다. 이 프로젝트에는 그 필드가 빠져 **21만 GPS 행에 품질 지표가 없는**
 * 선례가 이미 있다(schemas/vital-stream.ts 주석).
 *
 * ⚠ **배터리** — 위성 연속 가동은 이 기기 전력 모델로 약 49 mAh/h 다(총 소모 51 mAh/h 와 맞먹는다).
 * 다만 **깨우기 횟수는 안 늘어난다** — 위치를 찾으려는 깨우기(8시간 433회)는 이미 내고 있던 비용이고,
 * 위성은 그 깨어 있는 시간 안에서 fix 를 뜬다. 실측 증가분은 fix 소요 시간에 달렸다.
 */
class GpsLocationSource(
    context: Context,
    private val intervalMs: Long = 60_000,
    private val maxAgeMs: Long = 120_000,
) : LocationSource, LocationListener {

    private val manager = context.getSystemService(LocationManager::class.java)

    /** 위성 직접(`GPS_PROVIDER`) — 실외 ±5~15m. **실내에서는 영영 안 온다.** */
    @Volatile private var satelliteFix: LocationFix? = null

    /** 폴백(`FUSED`/네트워크) — 실내에서도 오지만 ±80~400m. 위성이 없을 때의 유일한 좌표다. */
    @Volatile private var fallbackFix: LocationFix? = null

    @SuppressLint("MissingPermission")   // 권한은 CollectorService 기동 전 화면(①)에서 받는다
    override fun start() {
        val available = runCatching { manager.allProviders }.getOrDefault(emptyList())
        val fallback = pickProvider(Build.VERSION.SDK_INT, available)
        subscribe(fallback)
        // ★ 위성은 **따로** 구독해야 켜진다. FUSED 에 맡기면 정확도 요구가 없어 안 켠다(09-01 실측).
        //   폴백이 이미 GPS 면(구버전 기기) 같은 공급자를 두 번 걸지 않는다 — 중복 등록은 무의미하다.
        if (fallback != LocationManager.GPS_PROVIDER && available.contains(LocationManager.GPS_PROVIDER)) {
            subscribe(LocationManager.GPS_PROVIDER)
        }
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
        // 리스너 하나로 두 공급자를 받으므로 이 한 번이 둘 다 해제한다.
        runCatching { manager.removeUpdates(this) }
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

// IBI(박동 간격) 목록 → SDNN(ms) — 삼성 IBI_LIST 로 HRV 를 직접 계산한다 (애플은 완제품만 줬다)
package com.vitalguard.wear.core

object Sdnn {

    /** 유효 판정 값 — 삼성 `IBI_STATUS_LIST` 의 정상 코드. 실측 ③에서 재확인한다(가정 명시). */
    const val STATUS_VALID = 0

    /**
     * 생리학적 IBI 하한·상한(ms) — 심박 30~220bpm 에 대응한다.
     *
     * ★ **status 만으로는 안 걸러진다**(08-25 실기: HRV 402ms 관측 · 정상은 20~100ms).
     *   삼성이 status=0 으로 주면서도 0 이나 극단값을 섞어 보내는 경우가 있고,
     *   그런 표본 두어 개가 SDNN 을 통째로 망가뜨린다(표준편차는 이상치에 취약하다).
     *   심박 자체가 정상 범위인데 HRV 만 튀면 이 필터가 안 걸린 것이다.
     */
    const val IBI_MIN_MS = 270   // 220bpm
    const val IBI_MAX_MS = 2000  // 30bpm

    /**
     * 연속성 허용 폭 — **직전 유효 박동 대비 이 비율을 넘게 튀면 버린다.**
     *
     * ★ 왜 필요한가(08-25 실기). 생리 범위 필터만으로는 부족했다 —
     *   ```
     *   심박 95bpm(=IBI 632ms) 인데 IBI=[1442, 920, 869] · status 전부 0(정상)
     *   → 1442ms 는 42bpm · 869ms 는 69bpm. 심박과 전혀 정합하지 않는다.
     *   → 광학 센서가 박동을 놓쳐(missed beat) 두세 박동을 하나로 합친 값이다.
     *   → 이 셋의 SDNN = 258.9ms (화면 관측 264와 일치 = 계산은 맞고 재료가 오염)
     *   ```
     *   합쳐진 박동은 **생리 범위 안에 들어와서** 값 범위로는 못 거른다.
     *   직전 박동과의 차이를 보는 것이 HRV 전처리의 표준 기법이다(artifact correction).
     *
     * 0.20 = 20%. 임상 문헌에서 널리 쓰는 값이고, 정상 호흡성 부정맥(RSA)은 통과한다.
     * ⚠ 진짜 부정맥도 함께 걸러진다 — 이 값은 **HRV 표시 전용**이고 부정맥 판정에 쓰지 않는다.
     */
    const val CONTINUITY_TOLERANCE = 0.20

    /**
     * SDNN 을 낼 최소 표본 수 — 미만이면 null(표시 안 함).
     *
     * ★ 5 → 30 (08-25 사용자 결정 A안). 근거는 100초 실측이다 —
     * ```
     * IBI 도착: 26회 중 25회가 빈 배열, 1회만 68개 몰아서
     * 필터 통과: 입력68 → 상태59 → 범위59 → 심박9 → 연속7   (84% 폐기)
     * 그 결과: 21.9 / 37.3 / 63.5ms 로 요동 (같은 사람 · 1분 안)
     * ```
     * 표본이 6~23개로 들쭉날쭉해 SDNN 이 안정되지 않았다. 임상 SDNN 은 **연속 5분 기록**을
     * 전제하는데 우리는 산발적 조각을 모으는 처지라, 표본이 적으면 값이 아니라 잡음이다.
     *
     * ⟹ **30 미만이면 안 보여준다.** 틀린 숫자보다 "못 쟀다" 가 낫다(0 으로 안 채우는 규칙과 같은 뜻).
     * 정지 상태로 오래 착용하면 광학 센서가 박동을 덜 놓쳐 표본이 모이고, 그때 값이 뜬다.
     * ⚠ 이 값은 **표시 문턱**이지 임상 기준이 아니다. 실사용에서 너무 자주 비면 낮춘다.
     */
    const val MIN_SAMPLES = 30

    /**
     * 심박 정합 허용 폭 — **보고된 bpm 에서 환산한 IBI 와 이 비율 넘게 벌어지면 버린다.**
     *
     * ★ 연속성 필터만으로는 못 잡는 구멍이 있다(08-25 실측) —
     *   ```
     *   심박 94bpm(=638ms) 인데 IBI=[855, 915, 920, 889, 787] · status 전부 0
     *   서로는 20% 안이라 연속성을 **전부 통과**한다. 그런데 전부 65~76bpm 대로
     *   심박과 안 맞는다 — 배치가 통째로 놓친 박동이다.
     *   ```
     *   이웃끼리 비교하는 연속성은 **배치 전체가 어긋나면 무력**하다.
     *   심박은 삼성이 자체 알고리즘으로 별도 산출하므로 독립적인 대조 기준이 된다.
     *
     * 0.30 = 30%. 연속성(20%)보다 느슨하게 둔다 — 심박 자체가 평균값이라 순간 IBI 와
     * 차이가 나는 게 정상이고, 여기서 조이면 정상 변동까지 죽는다.
     */
    const val HR_MATCH_TOLERANCE = 0.30

    /**
     * SDNN = NN 간격의 모집단 표준편차(ms). 표본이 2개 미만이면 **0 이 아니라 null** —
     * "변동이 없다" 와 "못 쟀다" 를 가르는 iOS motionVariability 와 같은 규칙이다.
     * status 가 오면 길이가 같은 것만 신뢰하고, 유효(0) 표본만 쓴다.
     */
    /**
     * 연속성 필터 — 첫 표본을 기준으로 삼고, 직전 **유효** 값 대비 허용 폭 안인 것만 남긴다.
     * 기준을 "직전 유효값" 으로 두는 이유 — 버린 값을 기준으로 쓰면 오염이 뒤로 번진다.
     */
    internal fun continuous(ibi: List<Int>): List<Int> {
        if (ibi.size < 2) return ibi
        val out = mutableListOf(ibi.first())
        for (v in ibi.drop(1)) {
            val prev = out.last()
            if (kotlin.math.abs(v - prev).toDouble() / prev <= CONTINUITY_TOLERANCE) out.add(v)
        }
        return out
    }

    /**
     * 심박 정합 필터 — 보고된 bpm 에서 기대 IBI 를 환산해 크게 벗어난 표본을 버린다.
     * bpm 이 없으면(순정 소스 등) 통과시킨다 — 대조 기준이 없으면 거를 근거도 없다.
     */
    internal fun hrConsistent(ibi: List<Int>, bpm: Int?): List<Int> {
        if (bpm == null || bpm <= 0) return ibi
        val expected = 60_000.0 / bpm
        return ibi.filter { kotlin.math.abs(it - expected) / expected <= HR_MATCH_TOLERANCE }
    }

    /** 마지막 계산의 단계별 잔존 수 — "왜 이 값인가" 를 추론이 아니라 수로 답하기 위한 계기. */
    @Volatile
    var lastTrace: String = "-"
        private set

    fun sdnnMs(ibiMs: List<Int>, status: List<Int>? = null, bpm: Int? = null): Double? {
        val byStatus = if (status != null && status.size == ibiMs.size) {
            ibiMs.filterIndexed { i, _ -> status[i] == STATUS_VALID }
        } else {
            ibiMs
        }
        // 생리 범위 밖은 버린다 — status 가 정상이라고 해도 값 자체가 불가능하면 표본이 아니다.
        val inRange = byStatus.filter { it in IBI_MIN_MS..IBI_MAX_MS }
        // 심박 정합 — 배치가 통째로 어긋난 경우를 잡는다(연속성이 못 보는 구멍).
        val matched = hrConsistent(inRange, bpm)
        // 연속성 — 직전 **유효** 박동 대비 20% 넘게 튀면 버린다(개별 이상치 차단).
        val valid = continuous(matched)
        // ⚠ 연속성 필터는 표본을 크게 줄인다 — 2개로 낸 SDNN 은 노이즈다.
        //   부족하면 **null 로 둔다**(0 으로 채우지 않는 전 화면 공통 규칙).
        //   5는 임의값이 아니라 "두 박동 차이 하나" 가 결과를 지배하지 않는 최소선이다.
        lastTrace = "입력${ibiMs.size}→상태${byStatus.size}→범위${inRange.size}→심박${matched.size}→연속${valid.size}"
        if (valid.size < MIN_SAMPLES) return null
        val mean = valid.sumOf { it.toDouble() } / valid.size
        val variance = valid.sumOf { (it - mean) * (it - mean) } / valid.size
        return kotlin.math.sqrt(variance)
    }
}

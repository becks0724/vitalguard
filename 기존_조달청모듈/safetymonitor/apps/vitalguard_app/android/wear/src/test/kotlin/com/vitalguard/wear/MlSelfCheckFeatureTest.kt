// 자가검증 절반을 기기 없이 — 88피처가 파이썬 정답지와 맞는가(ONNX 는 실기 몫)
package com.vitalguard.wear

import com.vitalguard.ml.FeatureExtractor
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs

/**
 * 한 문장 보장 = **`FeatureExtractor` 의 Kotlin 이식이 학습에 쓰인 numpy `features.py` 와
 * 6개 슬라이스 전부에서 1e-5 안으로 같다.**
 *
 * ★ 왜 여기가 값어치 있나. 워치의 [ML 자가검증] 은 두 가지를 함께 본다 —
 *   ① 88피처가 정답지와 맞는가 ② ONNX 확률이 sklearn 과 맞는가.
 *   ②는 네이티브 `.so` 가 필요해 실기에서만 되지만, **①은 순수 Kotlin 이라 여기서 된다**
 *   (`FeatureExtractor` 의 android 참조 0건 — 통제군 `FallMLPipeline` 은 1건).
 *   그리고 갈릴 가능성은 ① 쪽이 훨씬 높다: 나이브 DFT · 백분위 선형보간 · skew/kurt 클램프처럼
 *   **언어마다 조용히 달라지는 것들**이 전부 여기 있다. 모델은 바이트가 같으니 안 갈린다.
 *
 * ★ 이 시험이 초록이면 실기 자가검증에서 남는 위험은 **변환(ONNX)뿐**으로 좁혀진다.
 *   그리고 애플 쪽 실측(08-27 · Core ML · 모듈 6.1.0)이 이미 그 정답지를 통과했다 —
 *   walk·impact 0.037/0.038 · walk·work_veto 0.105/0.105 · fall·impact 0.869/0.869 ·
 *   fall·work_veto 0.110/0.110 · hammer·impact 0.146/0.146 · hammer·work_veto 0.810/0.810.
 *   ONNX 와 Core ML 은 **같은 joblib 에서 나온 형제**라 이 값들과도 맞아야 정상이다.
 *
 * 허용오차 1e-5 = 모듈 `MLSelfCheck` 이 쓰는 그 값이다(정답지 반올림 감안). 임의로 정하지 않는다.
 */
class MlSelfCheckFeatureTest {

    private val TOL = 1e-5

    /** 정답지 위치. **못 찾으면 건너뛰지 않고 실패시킨다** — 조용한 0건이 초록으로 보이면 안 된다. */
    private fun answerKey(): JSONObject {
        val candidates = listOf(
            File("src/main/assets/ml_selfcheck.json"),
            File("wear/src/main/assets/ml_selfcheck.json"),
            File("../wear/src/main/assets/ml_selfcheck.json"),
        )
        val f = candidates.firstOrNull { it.exists() }
            ?: throw AssertionError(
                "ml_selfcheck.json 을 못 찾았다 (작업디렉터리=${File(".").absolutePath}) — " +
                    "정답지가 없으면 이 시험은 아무것도 보장하지 않는다")
        return JSONObject(f.readText())
    }

    @Test
    fun `88피처가 파이썬 정답지와 6슬라이스 전부에서 일치한다`() {
        val cases = answerKey().getJSONArray("cases")
        // 표본 수를 먼저 못 박는다 — 정답지가 줄어도 "전부 통과" 로 보이면 안 된다.
        assertEquals("정답지 케이스 수가 바뀌었다", 3, cases.length())

        var checked = 0
        var worst = 0.0
        var worstAt = ""
        for (ci in 0 until cases.length()) {
            val c = cases.getJSONObject(ci)
            val slices = c.getJSONObject("slices")
            for (task in slices.keys()) {
                val s = slices.getJSONObject(task)
                val axesJ = s.getJSONArray("axes")
                val axes = Array(axesJ.length()) { i ->
                    val row = axesJ.getJSONArray(i)
                    DoubleArray(row.length()) { j -> row.getDouble(j) }
                }
                val got = FeatureExtractor.extract(axes, s.getDouble("fs"))
                val want = s.getJSONArray("features")
                assertEquals("피처 개수가 다르다", FeatureExtractor.COUNT, got.size)
                assertEquals("정답지 피처 개수가 다르다", FeatureExtractor.COUNT, want.length())
                for (i in 0 until want.length()) {
                    val d = abs(got[i] - want.getDouble(i))
                    if (d > worst) { worst = d; worstAt = "${c.getString("name")}·$task[$i]" }
                }
                checked++
            }
        }
        // 6슬라이스를 다 봤는가 — 순회가 조용히 0바퀴 돌면 위 단언은 전부 안 돈다([[L-108]]).
        assertEquals("슬라이스 6개를 다 안 봤다", 6, checked)
        assertTrue(
            "피처가 정답지와 갈렸다 — 최대오차 $worst (허용 $TOL) · 최악 지점 $worstAt",
            worst < TOL,
        )
    }

    @Test
    fun `정답지가 6축 50Hz 입력을 담고 있다`() {
        // 입력 규약이 바뀌면 위 시험이 통과해도 실기와 다른 것을 잰 게 된다.
        val cases = answerKey().getJSONArray("cases")
        for (ci in 0 until cases.length()) {
            val slices = cases.getJSONObject(ci).getJSONObject("slices")
            for (task in slices.keys()) {
                val s = slices.getJSONObject(task)
                assertEquals("정답지 fs 가 50Hz 가 아니다", 50.0, s.getDouble("fs"), 1e-9)
                val row0 = s.getJSONArray("axes").getJSONArray(0)
                assertEquals("정답지 입력이 6축이 아니다", 6, row0.length())
            }
        }
    }
}

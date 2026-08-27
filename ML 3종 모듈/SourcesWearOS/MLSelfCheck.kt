// C2 — 온디바이스 자가검증 (Wear OS 판, Swift MLSelfCheck 동일). 파이썬 정답지와 Kotlin 결과를 대조.
//   ① FeatureExtractor 88피처 == numpy extract (허용 1e-5 절대오차 — 정답지 반올림 감안)
//   ② ONNX 확률 == sklearn predict_proba (허용 0.01 — Core ML 때와 같은 게이트, 실측 변환오차 <1e-6)
// 워치 화면의 [ML 자가검증] 버튼에서 실행. 전부 ✅ 면 파이프라인 이식 성공.
package com.vitalguard.ml

import android.content.Context
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs

object MLSelfCheck {
    fun run(context: Context): String {
        val root = try {
            JSONObject(context.assets.open("ml_selfcheck.json").use { it.readBytes().decodeToString() })
        } catch (_: Exception) {
            return "ml_selfcheck.json 없음 — assets 에 추가 필요"
        }
        val pipeline = FallMLPipeline.create(context)
        val lines = ArrayList<String>()
        var maxFeatDiff = 0.0
        val cases = root.getJSONArray("cases")
        for (ci in 0 until cases.length()) {
            val c = cases.getJSONObject(ci)
            val slices = c.getJSONObject("slices")
            val tasks = ArrayList<String>()
            slices.keys().forEach { tasks.add(it) }
            tasks.sort()
            for (task in tasks) {
                val s = slices.getJSONObject(task)
                val axesJ = s.getJSONArray("axes")
                val axes = Array(axesJ.length()) { i ->
                    val row = axesJ.getJSONArray(i)
                    DoubleArray(row.length()) { j -> row.getDouble(j) }
                }
                val feat = FeatureExtractor.extract(axes, s.getDouble("fs"))
                val featJ = s.getJSONArray("features")
                var fd = 0.0
                for (i in 0 until featJ.length()) fd = maxOf(fd, abs(feat[i] - featJ.getDouble(i)))
                maxFeatDiff = maxOf(maxFeatDiff, fd)
                var probPart = "모델 미탑재"
                if (pipeline != null) {
                    val got = pipeline.prob(task, axes)
                    val want = s.getDouble("prob")
                    val ok = abs(got - want) < 0.01
                    probPart = String.format(Locale.US, "p %.3f/%.3f %s", got, want, if (ok) "✅" else "❌")
                }
                lines.add("${c.getString("name")}·$task feat${if (fd < 1e-5) "✅" else "❌"} $probPart")
            }
        }
        lines.add(String.format(Locale.US, "피처 최대오차 %.1e", maxFeatDiff))
        return lines.joinToString("\n")
    }
}

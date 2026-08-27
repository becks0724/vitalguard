// ML 파이프라인 (Wear OS 판) — Swift FallMLPipeline 과 동일 로직, 추론 런타임만 Core ML → ONNX Runtime.
// 모델 = assets/{work_veto,impact,recovery}.onnx — sklearn 원본(joblib)에서 skl2onnx 로 변환,
// 변환 시 정답지 6건+recovery 206벡터 확률오차 <1e-6 검증(2026-08-27, Core ML 게이트 0.01 대비 여유).
// 임계값 출처 = thresholds.json (4명 LOSO OOF로 산출) — Swift 판과 동일 상수.
package com.vitalguard.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context

class FallMLPipeline private constructor(
    private val env: OrtEnvironment,
    private val workVeto: OrtSession,
    private val impact: OrtSession,
    private val recovery: OrtSession?
) {
    companion object {
        const val VETO_THRESHOLD = 0.675      // work_veto precision≥0.95 운영점 — 이 이상이면 "작업 확실" 기각
        const val IMPACT_THRESHOLD = 0.710    // impact fpr5% 운영점
        const val RECOVERY_THRESHOLD = 0.35   // 비회복 asym(애매하면 위험 쪽)
        const val FS = 50.0

        /** assets 에 모델(.onnx)이 없으면 null — 호출부는 규칙 단독으로 동작(fail-open). */
        fun create(context: Context): FallMLPipeline? = try {
            val env = OrtEnvironment.getEnvironment()
            fun load(name: String): OrtSession =
                env.createSession(context.assets.open(name).use { it.readBytes() })
            val rec = try { load("recovery.onnx") } catch (_: Exception) { null }
            FallMLPipeline(env, load("work_veto.onnx"), load("impact.onnx"), rec)
        } catch (_: Exception) { null }
    }

    /** 융합용 — 충격 윈도에서 (작업확률, 낙상충격확률). 슬라이스: work_veto 3s / impact ±1s. */
    fun probs(window: ImuWindow): Pair<Double, Double> {
        val samples = Array(window.samples.size) { i ->
            DoubleArray(6) { c -> window.samples[i][c].toDouble() }
        }
        val wv = prob(workVeto, slice(samples, window.impactIndex, 3.0))
        val im = prob(impact, slice(samples, window.impactIndex, 2.0))
        return Pair(wv, im)
    }

    /** 회복 모드(12초 윈도) 전용 — 비회복 확률. spanSec = 윈도 벽시계 길이(스로틀링 대응 실효 fs). */
    fun nonrecoveryProb(window: ImuWindow, spanSec: Double): Double? {
        val m = recovery ?: return null
        val samples = Array(window.samples.size) { i ->
            DoubleArray(6) { c -> window.samples[i][c].toDouble() }
        }
        return prob(m, samples, samples.size / spanSec)
    }

    /** 자가검증용 — task 이름("work_veto"/"impact")으로 확률 조회. */
    fun prob(task: String, samples: Array<DoubleArray>): Double =
        prob(if (task == "work_veto") workVeto else impact, samples)

    /** real_loader._slice 동일: 충격 중심 n샘플 (짧으면 전체). */
    private fun slice(samples: Array<DoubleArray>, center: Int, sec: Double): Array<DoubleArray> {
        val n = (sec * FS).toInt()
        val t = samples.size
        if (t <= n) return samples
        val s = maxOf(0, minOf(center - n / 2, t - n))
        return samples.copyOfRange(s, s + n)
    }

    private fun prob(model: OrtSession, samples: Array<DoubleArray>, fs: Double = FS): Double {
        val feat = FeatureExtractor.extract(samples, fs)
        val input = arrayOf(FloatArray(FeatureExtractor.COUNT) { feat[it].toFloat() })
        return try {
            OnnxTensor.createTensor(env, input).use { t ->
                model.run(mapOf("features" to t)).use { r ->
                    @Suppress("UNCHECKED_CAST")
                    val p = (r.get("probabilities").get() as OnnxTensor).value as Array<FloatArray>
                    p[0][1].toDouble()
                }
            }
        } catch (_: Exception) { 0.0 }
    }
}

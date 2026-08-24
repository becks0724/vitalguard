// 실측 ④ — 구글 Health Services 지원 DataType 덤프. 삼성 파트너 승인 없이 되는 범위의 대조군이다.
package com.vitalguard.wear

import android.content.Context
import androidx.health.services.client.HealthServices

object HealthServicesProbe {

    /** passive·measure·exercise 세 클라이언트의 지원 타입을 한 번에 적는다. SpO₂ 유무가 관전 포인트. */
    fun run(context: Context, onResult: (String) -> Unit) {
        val client = HealthServices.getClient(context)
        val lines = StringBuilder()
        val pending = intArrayOf(3) // 세 조회가 다 끝나면 보고한다

        fun done(section: String) {
            synchronized(lines) {
                lines.append(section)
                if (--pending[0] == 0) onResult(lines.toString())
            }
        }

        val direct = Runnable::run // 프로브라 스레드 안 가린다 — 결과만 정확하면 된다

        client.passiveMonitoringClient.getCapabilitiesAsync().let { f ->
            f.addListener({
                done(runCatching {
                    "passive ${f.get().supportedDataTypesPassiveMonitoring.joinToString { it.name }}\n"
                }.getOrElse { "passive 조회 실패: $it\n" })
            }, direct)
        }
        client.measureClient.getCapabilitiesAsync().let { f ->
            f.addListener({
                done(runCatching {
                    "measure ${f.get().supportedDataTypesMeasure.joinToString { it.name }}\n"
                }.getOrElse { "measure 조회 실패: $it\n" })
            }, direct)
        }
        client.exerciseClient.getCapabilitiesAsync().let { f ->
            f.addListener({
                done(runCatching {
                    "exercise ${f.get().supportedExerciseTypes.size}종 운동 지원\n"
                }.getOrElse { "exercise 조회 실패: $it\n" })
            }, direct)
        }
    }
}

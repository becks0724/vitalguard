// 실측 ②③ — 삼성 Sensor SDK 연결과 지원 트래커 전량 덤프. 실패 코드를 감추지 않고 그대로 적는다.
package com.vitalguard.wear

import android.content.Context
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService

object SensorSdkProbe {

    /** 연결 → 지원 트래커 나열 → 해제. 결과는 줄 단위 텍스트 — 화면과 로그 양쪽에 그대로 쓴다. */
    fun run(context: Context, onResult: (String) -> Unit) {
        lateinit var service: HealthTrackingService
        val listener = object : ConnectionListener {
            override fun onConnectionSuccess() {
                val lines = StringBuilder("SDK 연결 성공\n")
                runCatching {
                    val types = service.trackingCapability.supportHealthTrackerTypes
                    lines.append("지원 트래커 ${types.size}종\n")
                    types.forEach { lines.append("  ").append(it.name).append('\n') }
                }.onFailure { lines.append("capability 조회 실패: ").append(it).append('\n') }
                service.disconnectService()
                onResult(lines.toString())
            }

            override fun onConnectionEnded() = Unit

            override fun onConnectionFailed(e: HealthTrackerException) {
                // errorCode 판독 — PACKAGE_NOT_INSTALLED / OLD_PLATFORM_VERSION 은 resolve() 로
                // 갤럭시스토어 설치·갱신 유도가 가능하다. 그 외(미승인 서명)는 개발자 모드가 답이다.
                val why = when (e.errorCode) {
                    HealthTrackerException.PACKAGE_NOT_INSTALLED -> "Health Platform 미설치"
                    HealthTrackerException.OLD_PLATFORM_VERSION -> "Health Platform 구버전"
                    else -> "코드 ${e.errorCode} — 미승인 서명이면 개발자 모드 필요" +
                        " (설정>앱>Health Sensor Service>제목 10회 탭)"
                }
                onResult("SDK 연결 실패: $why\nhasResolution=${e.hasResolution()}")
            }
        }
        service = HealthTrackingService(listener, context)
        service.connectService()
    }
}

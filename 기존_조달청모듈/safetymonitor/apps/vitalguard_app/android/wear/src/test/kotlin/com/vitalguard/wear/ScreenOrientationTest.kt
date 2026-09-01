// 화면 회전 고정 — 손목 움직임을 따라 도는 현상을 매니페스트 선언으로 못 박는다
package com.vitalguard.wear

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ScreenOrientationTest {
    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `화면은 손목 움직임을 따라 돌지 않는다`() {
        // 기기 자동회전이 켜져 있어(실측 accelerometer_rotation=1) 방향을 안 정하면 센서를 따라간다
        // — 착용 중 mRotation=ROTATION_180(뒤집힘) 실측(09-01 워치9).
        val activity = manifest.substringAfter("<activity").substringBefore("</activity>")
        assertTrue("MainActivity 가 아니다", activity.contains(".MainActivity"))
        // ⚠ portrait 는 회전 0 으로 못박아 반대 손목 사용자의 기본 방향까지 뒤집는다. nosensor 여야 한다.
        assertTrue(
            "화면 방향이 고정돼 있지 않다",
            activity.contains("""android:screenOrientation="nosensor""""),
        )
    }
}

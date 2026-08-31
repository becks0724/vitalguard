// 신규 설치 크래시 가드 — 런타임 권한 0개로 CollectorService 를 올리면 FGS(health) 승격이 죽는다(08-31 워치8 실측)
package com.vitalguard.wear

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class FreshInstallGuardTest {
    private val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())

    @Test
    fun `onCreate 는 권한 가드 없이 수집 서비스를 올리지 않는다`() {
        // 무조건 startForegroundService(CollectorService) 면 신규 설치(런타임 권한 0개)에서 SecurityException 즉사.
        val onCreate = activity.substringAfter("override fun onCreate").substringBefore("setContent")
        assertTrue(
            "onCreate 의 수집 서비스 시작이 canStartHealthFgs() 가드로 감싸여 있지 않다",
            onCreate.contains("if (canStartHealthFgs())"),
        )
    }

    @Test
    fun `허용 콜백이 미뤄둔 서비스 시작을 이어받는다`() {
        val launcher = activity
            .substringAfter("permissionLauncher = registerForActivityResult")
            .substringBefore("override fun onCreate")
        assertTrue("권한 허용 후 수집 서비스를 올리는 경로가 없다", launcher.contains("startForegroundService"))
    }
}

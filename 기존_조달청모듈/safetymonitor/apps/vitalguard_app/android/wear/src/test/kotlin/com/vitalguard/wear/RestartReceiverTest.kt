// 자동 시작 리시버 — 되살릴 조건·액션 범위·매니페스트 선언을 못 박는다
package com.vitalguard.wear

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 종전엔 앱 소유 리시버가 **0개**라 재부팅·재설치 뒤 수집이 조용히 멈췄다(09-01 워치8 실측).
 * 화면은 평소와 같아 아무도 모른다 — 그래서 규칙을 테스트로 박는다.
 */
class RestartReceiverTest {
    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `부팅과 앱교체에서만 되살린다`() {
        assertTrue(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, true, true))
        assertTrue(RestartReceiver.shouldRestart(Intent.ACTION_MY_PACKAGE_REPLACED, true, true))
        // ⚠ 액션을 넓히면 Android 12+ 백그라운드 FGS 제한에 걸린다 — 이 둘만 면제 대상이다.
        assertFalse("잠금 부팅까지 받았다", RestartReceiver.shouldRestart(Intent.ACTION_LOCKED_BOOT_COMPLETED, true, true))
        assertFalse("화면 켜짐에도 반응한다", RestartReceiver.shouldRestart(Intent.ACTION_SCREEN_ON, true, true))
        assertFalse("액션 없이도 시작한다", RestartReceiver.shouldRestart(null, true, true))
    }

    @Test
    fun `자격이 없으면 수집을 켜지 않는다`() {
        // 자동 로그아웃(미착용 90분) 뒤 재부팅한 워치는 조용히 있어야 한다 — 올릴 곳 없는 표본만 쌓인다.
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, false, true))
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_MY_PACKAGE_REPLACED, false, true))
    }

    @Test
    fun `권한이 없으면 물러선다 - 부팅 직후 즉사를 막는다`() {
        // 권한 0개에서 FGS(health) 승격은 SecurityException 으로 즉사한다(c7b188f).
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, true, false))
    }

    @Test
    fun `매니페스트가 리시버와 부팅 권한을 선언한다`() {
        assertTrue(
            "RECEIVE_BOOT_COMPLETED 가 없다 — 선언이 없으면 부팅 브로드캐스트가 아예 안 온다",
            manifest.contains("android.permission.RECEIVE_BOOT_COMPLETED"),
        )
        val receiver = manifest.substringAfter("<receiver").substringBefore("</receiver>")
        assertTrue("리시버 이름이 다르다", receiver.contains(".RestartReceiver"))
        // 시스템이 보내는 protected broadcast 라 exported 가 false 면 아예 도달하지 않는다.
        assertTrue("exported 가 아니라 브로드캐스트가 안 온다", receiver.contains("""android:exported="true""""))
        assertTrue("부팅 액션이 없다", receiver.contains("android.intent.action.BOOT_COMPLETED"))
        assertTrue("앱 교체 액션이 없다", receiver.contains("android.intent.action.MY_PACKAGE_REPLACED"))
    }

    @Test
    fun `백그라운드 시작이 location 거부로 앱을 죽이지 않는다`() {
        // 09-01 워치9 실측 — 재설치 뒤 OS 가 서비스를 두 번 되살렸고 두 번 다 SecurityException 으로
        // 즉사했다(pid 11624·11692). ACCESS_FINE_LOCATION 이 '사용 중에만' 권한이라 백그라운드 시작에는
        // 자격이 없다. 생체 수집까지 함께 죽으면 안 되므로 health 로 물러선다.
        val service = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
        val promote = service.substringAfter("val fullTypes").substringBefore("offBody.start")
        assertTrue("승격이 SecurityException 을 안 받는다", promote.contains("catch (e: SecurityException)"))
        assertTrue(
            "폴백이 health 단독이 아니다",
            promote.contains("ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH,"),
        )
    }

    @Test
    fun `백그라운드 시작 거부가 앱을 죽이지 않는다 - 일시 고장이 영구 정지가 되면 안 된다`() {
        // 09-02 워치8 실측 — tick 스레드가 죽자 OS 가 서비스를 되살렸고, 그 재시작이 백그라운드라
        // ForegroundServiceStartNotAllowedException(mAllowStartForeground false) 으로 **또** 죽었다.
        // 같은 크래시 8건 · 219초 무음. 종전 try/catch 는 SecurityException 만 받아 이 갈래를 놓쳤다.
        val service = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
        val promote = service.substringAfter("val fullTypes").substringBefore("offBody.start")
        assertTrue(
            "IllegalStateException 갈래가 없다 — 백그라운드 재시작이 앱을 죽인다",
            promote.contains("catch (e: IllegalStateException)"),
        )
        assertTrue("health 폴백도 같은 거부를 받을 수 있다 — 감싸지 않았다", promote.contains("catch (e2: IllegalStateException)"))

        val giveUp = service.substringAfter("private fun giveUpForeground").substringBefore("\n    }")
        assertTrue("물러설 때 서비스를 안 끝낸다", giveUp.contains("stopSelf()"))
        // ⚠ START_STICKY 면 OS 가 또 백그라운드로 되살려 같은 거부를 무한 반복한다.
        assertTrue("START_NOT_STICKY 가 아니다 — 거부가 무한 반복된다", giveUp.contains("START_NOT_STICKY"))
    }

    @Test
    fun `모션 변동폭 읽기가 동기화돼 있다 - 안 하면 tick 스레드가 죽는다`() {
        // 09-02 실사고 = ConcurrentModificationException @ MotionTracker.variabilityMg.
        // MotionTracker 는 스레드 안전하지 않고 variabilityMg 는 창을 두 번 순회한다. 그 사이
        // IMU 스레드가 onAccelMagG 로 표본을 넣으면 터진다. 형제 함수엔 있는 표시가 여기만 없었다.
        val engine = File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText()
        val decl = engine.substringBefore("fun motionVarNow()")
        assertTrue(
            "motionVarNow 에 @Synchronized 가 없다 — IMU 와 tick 이 같은 창을 동시에 만진다",
            decl.trimEnd().endsWith("@Synchronized"),
        )
    }

    @Test
    fun `매니페스트가 백그라운드 위치를 선언한다`() {
        assertTrue(
            "ACCESS_BACKGROUND_LOCATION 이 없으면 부팅 시작에서 GPS 가 늘 빠진다",
            manifest.contains("android.permission.ACCESS_BACKGROUND_LOCATION"),
        )
    }

    @Test
    fun `백그라운드 위치를 다른 위치 권한과 같이 요청하지 않는다`() {
        // ⚠ Android 11+ 는 전경·배경 위치를 한 요청에 담으면 **요청 전체를 조용히 거절한다.**
        //   넣는 순간 지금 잘 되던 GPS 권한까지 통째로 죽는다. 부여는 설정 또는 pm grant 로 따로.
        val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())
        val request = activity.substringAfter("fun requestSensorPermissions").substringBefore("companion object")
        assertFalse(
            "런타임 요청 배열에 ACCESS_BACKGROUND_LOCATION 이 들어갔다 — 위치 권한 전체가 거절된다",
            request.contains("ACCESS_BACKGROUND_LOCATION"),
        )
    }

    @Test
    fun `권한 판단은 액티비티와 같은 함수를 쓴다`() {
        // 각자 복사해 두면 한쪽만 조건이 바뀌어도 다른 쪽이 부팅 직후 죽는다.
        val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())
        assertTrue(
            "액티비티가 권한 판단을 따로 들고 있다",
            activity.contains("CollectorService.canStartHealthFgs(this)"),
        )
        val receiver = uncommented(File("src/main/kotlin/com/vitalguard/wear/RestartReceiver.kt").readText())
        assertTrue(
            "리시버가 권한 판단을 따로 들고 있다",
            receiver.contains("CollectorService.canStartHealthFgs(context)"),
        )
    }
}

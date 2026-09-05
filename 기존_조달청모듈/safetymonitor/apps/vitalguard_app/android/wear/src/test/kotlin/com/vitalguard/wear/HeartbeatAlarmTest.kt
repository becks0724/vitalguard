// 하트비트 알람 가드 — 뒤에서 죽은 수집 서비스를 프로세스 밖 알람이 되살리는 배선을 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.RestartReceiver.Heartbeat
import com.vitalguard.wear.pipeline.SampleBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **수집 서비스가 뒤에서 죽으면 10분 안에 프로세스 밖 알람이 [RestartReceiver] 를 깨워 다시 올린다.**
 *
 * 왜 필요한가 — 09-02·09-03 워치8 실측. tick 사망 → OS sticky 재기동 → 백그라운드 FGS 거부 → `giveUpForeground`
 * 로 물러선 뒤 **아무것도 앱을 다시 깨우지 않았다**(tick 은 프로세스 안 리스너라 함께 죽는다 —
 * `Unrecognized alarm listener`). 사람이 열기까지 7분, 안 열었으면 무한. docs/wear-fgs-heartbeat R-01~R-07.
 *
 * ★ 구조 검사인 이유 — 리스너형/브로드캐스트형, cancel 유무, 재무장 순서는 값이 아니라 **API 선택**이다.
 *   둘 다 컴파일되고 둘 다 돈다. `TickAlarmTest`·`HrReviveTimestampTest` 와 같은 수법으로 소스를 읽는다.
 *   배선은 **그 함수 본문 안**을 본다 — 이름이 파일 어딘가에 있는 것으로는 부족하다([[L-123]]④).
 */
class HeartbeatAlarmTest {
    private val service = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
    private val receiver = uncommented(File("src/main/kotlin/com/vitalguard/wear/RestartReceiver.kt").readText())
    private val engine = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText())
    private val manifest = File("src/main/AndroidManifest.xml").readText()

    /** 서버 Zod 스키마의 필드명과 **글자 그대로** 같아야 한다 — 다르면 Zod 가 무음 strip 한다. */
    private val WIRE_KEY = "fgsRevivedAt"

    private fun memberBody(src: String, signature: String): String {
        val start = src.indexOf(signature)
        assertTrue("$signature 가 사라졌다", start >= 0)
        val rest = src.substring(start + signature.length)
        val end = listOf("\n    private fun ", "\n    override fun ", "\n    internal fun ", "\n    private val ", "\n    @Volatile", "\n    companion object", "\n    internal companion")
            .mapNotNull { m -> rest.indexOf(m).takeIf { it >= 0 } }
            .minOrNull() ?: rest.length
        return rest.substring(0, end)
    }

    // ── 판정(순수) ─────────────────────────────────────────────────────────

    @Test
    fun `하트비트 판정 표 - 살아 있으면 재무장, 자격 없으면 끊고, 자격과 권한이 있으면 올린다`() {
        assertEquals(Heartbeat.REARM, RestartReceiver.heartbeat(running = true, hasToken = true, canStartFgs = true))
        assertEquals(Heartbeat.REARM, RestartReceiver.heartbeat(running = true, hasToken = false, canStartFgs = false))
        // 로그아웃 상태 — 사슬을 끊는다. 올릴 곳 없는 표본만 쌓인다(RestartReceiver 의 같은 규칙).
        assertEquals(Heartbeat.DROP, RestartReceiver.heartbeat(running = false, hasToken = false, canStartFgs = true))
        assertEquals(Heartbeat.START, RestartReceiver.heartbeat(running = false, hasToken = true, canStartFgs = true))
        // 권한 0개에서 FGS(health) 승격은 SecurityException 즉사(c7b188f) — 올리지 않되 사슬은 유지한다.
        assertEquals(Heartbeat.REARM, RestartReceiver.heartbeat(running = false, hasToken = true, canStartFgs = false))
    }

    // ── 알람의 성질 ────────────────────────────────────────────────────────

    @Test
    fun `하트비트는 프로세스 밖 브로드캐스트 알람이다 - 리스너형이면 프로세스와 함께 죽는다`() {
        val arm = memberBody(service, "internal fun armHeartbeat(")
        assertTrue("PendingIntent.getBroadcast 로 만들지 않는다", service.contains("PendingIntent.getBroadcast("))
        assertTrue("리시버를 명시 컴포넌트로 겨누지 않는다", service.contains("Intent(context, RestartReceiver::class.java).setAction(ACTION_HEARTBEAT)"))
        assertTrue("FLAG_IMMUTABLE 이 없다 — 남이 extra 를 바꿔 넣을 수 있다", service.contains("PendingIntent.FLAG_IMMUTABLE"))
        assertFalse("하트비트가 OnAlarmListener 로 되돌아갔다", arm.contains("OnAlarmListener") || arm.contains("tickAlarm"))
        // 두 갈래 모두 allow-while-idle — 면제(R-03)는 여기서 온다. 정확 알람 권한이 없어도 성질은 남아야 한다.
        assertTrue("정확 갈래가 setExactAndAllowWhileIdle 이 아니다", arm.contains("setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,"))
        assertTrue("후퇴 갈래가 setAndAllowWhileIdle 이 아니다 — 권한 없으면 SecurityException 으로 사슬이 끊긴다", arm.contains("setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,"))
        assertTrue("정확 알람 권한을 먼저 묻지 않는다", arm.contains("canScheduleExactAlarms()"))
    }

    @Test
    fun `주기는 10분이다 - allow-while-idle 조절 한계이자 서버 부재 문턱과 같은 축`() {
        assertEquals(600_000L, CollectorService.HEARTBEAT_MS)
    }

    @Test
    fun `어디서도 하트비트를 취소하지 않는다 - 죽음을 넘어 살아야 하는 알람이다`() {
        val destroy = memberBody(service, "override fun onDestroy()")
        val giveUp = memberBody(service, "private fun giveUpForeground(")
        for ((name, body) in listOf("onDestroy" to destroy, "giveUpForeground" to giveUp)) {
            assertFalse("$name 이 하트비트를 취소한다", Regex("""cancel\([^)]*[Hh]eartbeat""").containsMatchIn(body))
            assertFalse("$name 이 heartbeatIntent 를 만진다", body.contains("heartbeatIntent("))
        }
        assertFalse("서비스 어딘가에서 하트비트 PendingIntent 를 cancel 한다", Regex("""cancel\(\s*heartbeatIntent""").containsMatchIn(service))
    }

    // ── 배선 ───────────────────────────────────────────────────────────────

    @Test
    fun `승격에 성공한 시작만 하트비트를 건다 - 물러선 갈래는 리시버가 잇는다`() {
        val start = memberBody(service, "override fun onStartCommand(")
        val afterPromote = start.substringAfter("offBody.start")   // 승격 try/catch 뒤
        assertTrue("onStartCommand 성공 경로에 armHeartbeat(this) 가 없다 — 첫 사슬이 시작되지 않는다",
            afterPromote.contains("armHeartbeat(this)"))
        assertTrue("armHeartbeat 가 return START_STICKY 뒤에 있다", afterPromote.indexOf("armHeartbeat(this)") < afterPromote.indexOf("return START_STICKY"))
        val giveUp = memberBody(service, "private fun giveUpForeground(")
        assertFalse("giveUpForeground 가 직접 재무장한다 — 리시버의 '먼저 재무장' 과 이중이 된다", giveUp.contains("armHeartbeat"))
    }

    @Test
    fun `리시버는 하트비트를 shouldRestart 앞에서 갈라 받고, 먼저 재무장한 뒤 올린다`() {
        val receive = memberBody(receiver, "override fun onReceive(")
        val branch = receive.indexOf("action == CollectorService.ACTION_HEARTBEAT")
        val gate = receive.indexOf("shouldRestart(")
        assertTrue("onReceive 에 하트비트 분기가 없다", branch >= 0)
        assertTrue("하트비트가 shouldRestart 뒤에 있다 — 부팅 전용 게이트가 하트비트를 버린다", branch < gate)

        val hb = memberBody(receiver, "private fun onHeartbeat(")
        val arm = hb.indexOf("CollectorService.armHeartbeat(context)")
        val start = hb.indexOf("startForegroundService(")
        assertTrue("onHeartbeat 가 재무장하지 않는다 — 한 번 받고 사슬이 끝난다", arm >= 0)
        assertTrue("onHeartbeat 가 서비스를 올리지 않는다", start >= 0)
        assertTrue("시작이 재무장보다 앞이다 — 시작이 거부되면 다음 박동이 없다", arm < start)
        assertTrue("소생 시작에 EXTRA_FROM_HEARTBEAT 를 안 싣는다 — 표식이 안 찍힌다", hb.contains("putExtra(CollectorService.EXTRA_FROM_HEARTBEAT, true)"))
        assertTrue("DROP 이면 재무장도 하지 않아야 한다", hb.indexOf("Heartbeat.DROP) return") < arm)
    }

    @Test
    fun `부팅·재설치 게이트는 그대로다 - 하트비트가 shouldRestart 를 넓히지 않았다`() {
        // R-05 — 넓힌 것은 자체 액션 하나이고 시스템 액션 목록은 불변이다. 기존 부정 단언은 RestartReceiverTest 가 갖는다.
        val gate = memberBody(receiver, "internal fun shouldRestart(")
        assertFalse("shouldRestart 가 하트비트 액션을 받는다", gate.contains("ACTION_HEARTBEAT"))
        assertFalse("매니페스트에 하트비트 intent-filter 가 생겼다 — 명시 인텐트라 불필요하고, 넓히면 남이 액션명으로 때린다",
            manifest.contains("HEARTBEAT"))
    }

    @Test
    fun `소생 표식은 승격 성공 뒤, 하트비트 시작에만 찍는다`() {
        val start = memberBody(service, "override fun onStartCommand(")
        val mark = start.indexOf("fgsRevivedAtMs = System.currentTimeMillis()")
        assertTrue("onStartCommand 가 fgsRevivedAtMs 를 갱신하지 않는다 — 소생이 서버에 영원히 안 보인다", mark >= 0)
        assertTrue("표식이 승격(startForeground) 앞에 찍힌다 — 거부돼 물러선 시작이 소생으로 센다", mark > start.lastIndexOf("startForeground("))
        val guard = start.substring(0, mark).substringAfterLast("if (")
        assertTrue("표식이 EXTRA_FROM_HEARTBEAT 조건 없이 찍힌다 — 액티비티·부팅 시작까지 소생으로 센다", guard.contains("EXTRA_FROM_HEARTBEAT"))
        assertTrue("서비스가 엔진에 공급자를 안 넘긴다", Regex("""fgsRevivedAtMs\s*=\s*\{\s*fgsRevivedAtMs\s*\}""").containsMatchIn(service))
        assertTrue("엔진이 flush 에서 그 값을 안 읽는다", engine.contains("fgsRevivedAtMs = fgsRevivedAtMs()"))
    }

    // ── 표본 ───────────────────────────────────────────────────────────────

    @Test
    fun `측정값이 있으면 소생 시각을 함께 싣는다`() {
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, fgsRevivedAtMs = 1_500L)!!
        assertEquals("1970-01-01T00:00:01.500Z", v[WIRE_KEY])
    }

    @Test
    fun `무동작 단독 전송에서도 함께 싣는다 - 미착용 구간의 소생이 여기서만 보인다`() {
        val v = SampleBuilder().buildAndReset(sentAtMs = 2_000L, stillSec = 300.0, batteryPct = 84, fgsRevivedAtMs = 1_500L)!!
        assertEquals("1970-01-01T00:00:01.500Z", v[WIRE_KEY])
    }

    @Test
    fun `소생이 없었으면 키를 만들지 않고, 이것만으로는 행을 만들지 않는다`() {
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        assertFalse("없는 값을 키로 만들었다", b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84)!!.containsKey(WIRE_KEY))
        assertNull(SampleBuilder().buildAndReset(sentAtMs = 2_000L, fgsRevivedAtMs = 1_500L))
    }
}

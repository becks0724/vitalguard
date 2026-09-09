// 워치 로그인 — 응답 해석·비밀번호 비보존·설정 페이지 배치를 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.AuthClient
import com.vitalguard.wear.pipeline.LoginResult
import com.vitalguard.wear.ui.maskedPassword
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 주석을 걷어낸 본문. `contains` 로 코드를 확인할 때 **주석 안의 같은 문자열이 가드를 통과시킨다** —
 * 08-26 변이 시험에서 `// workerName = null` 로 주석 처리한 변이가 그대로 초록을 받았다.
 */
internal fun uncommented(src: String): String =
    src.lines().joinToString("\n") { it.substringBefore("//") }

/** 서버 응답 해석 — 문구까지 계약이다. 워치 화면은 좁아서 코드만 던지면 작업자가 못 고친다. */
class LoginParseTest {
    private val client = AuthClient("https://example.test")

    private fun ok(workerId: Any?, name: Any? = "장우진", token: String? = "tok"): String =
        JSONObject()
            .put("ok", true)
            .apply { token?.let { put("token", it) } }
            .put("user", JSONObject().put("id", "admin6861").put("name", name).put("workerId", workerId))
            .toString()

    @Test
    fun `정상 응답에서 토큰과 사번과 이름을 뽑는다`() {
        val r = client.parse(200, ok("EMP-6861")) as LoginResult.Ok
        assertEquals("tok", r.token)
        assertEquals("EMP-6861", r.workerId)
        assertEquals("장우진", r.workerName)
    }

    @Test
    fun `사번이 없으면 로그인을 거부한다`() {
        // ★ 서버는 workerId 를 null 로 줄 수 있다(lib/app-login.ts: `workerId: string | null`).
        //   빈 채로 저장하면 로그인은 성공한 척하고 **업로드만 401 로 조용히 죽는다** —
        //   서버 주석이 바로 그 사고를 기록해 뒀다. 그 구멍을 여기서 막는다.
        val nullId = client.parse(200, ok(JSONObject.NULL))
        assertTrue("사번 null 을 통과시켰다", nullId is LoginResult.Failed)
        assertTrue("무엇을 고쳐야 할지 안 알려준다", (nullId as LoginResult.Failed).message.contains("사번"))

        val blankId = client.parse(200, ok(""))
        assertTrue("빈 사번을 통과시켰다", blankId is LoginResult.Failed)
    }

    @Test
    fun `토큰이 없으면 거부한다`() {
        assertTrue(client.parse(200, ok("EMP-1", token = null)) is LoginResult.Failed)
    }

    @Test
    fun `이름이 없어도 로그인은 된다`() {
        // 서버 principal.name 은 null 일 수 있다. 이름은 표시용이라 로그인을 막지 않는다.
        val r = client.parse(200, ok("EMP-1", name = JSONObject.NULL)) as LoginResult.Ok
        assertEquals(null, r.workerName)
    }

    @Test
    fun `실패 사유마다 사람이 읽을 문구를 준다`() {
        fun msg(code: Int, reason: String, extra: JSONObject.() -> Unit = {}) =
            (client.parse(code, JSONObject().put("ok", false).put("error", reason).apply(extra).toString())
                as LoginResult.Failed).message

        assertTrue(msg(401, "invalid_credentials").contains("비밀번호"))
        assertTrue(msg(403, "not_approved").contains("승인"))
        assertTrue(msg(503, "app_auth_not_configured").contains("서버"))
        val locked = msg(429, "too_many_attempts") { put("retryAfterSec", 42) }
        assertTrue("남은 시간을 안 알려준다: $locked", locked.contains("42"))
        // 모르는 사유도 삼키지 않는다 — 코드라도 보여준다.
        assertTrue(msg(500, "boom").contains("500"))
    }

    @Test
    fun `본문이 JSON 이 아니어도 죽지 않는다`() {
        assertTrue(client.parse(502, "<html>Bad Gateway</html>") is LoginResult.Failed)
    }
}

/** 실제 HTTP 왕복 — 요청 모양(메서드·경로·본문)까지 계약이다. */
class LoginRoundtripTest {
    @Test
    fun `아이디와 비밀번호를 JSON 으로 POST 한다`() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                JSONObject().put("ok", true).put("token", "T")
                    .put("user", JSONObject().put("name", "장우진").put("workerId", "EMP-6861"))
                    .toString(),
            ),
        )
        server.start()
        try {
            val r = AuthClient(server.url("/").toString()).login("admin6861", "pw1234")
            assertTrue(r is LoginResult.Ok)
            val req = server.takeRequest()
            assertEquals("POST", req.method)
            assertEquals("/api/app-auth/login", req.path)
            assertTrue(req.getHeader("Content-Type")?.contains("application/json") == true)
            val body = JSONObject(req.body.readUtf8())
            assertEquals("admin6861", body.getString("id"))
            assertEquals("pw1234", body.getString("password"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `빈 입력은 서버에 가지도 않는다`() {
        val server = MockWebServer()
        server.start()
        try {
            val r = AuthClient(server.url("/").toString()).login("", "pw")
            assertTrue(r is LoginResult.Failed)
            assertEquals("서버로 요청이 나갔다", 0, server.requestCount)
        } finally {
            server.shutdown()
        }
    }
}

/**
 * 비밀번호 취급 가드.
 * 한 문장 보장 = **비밀번호는 디스크에도 로그에도 화면에도 원문으로 남지 않는다.**
 */
class PasswordHandlingTest {
    private val cfg = File("src/main/kotlin/com/vitalguard/wear/pipeline/ConfigStore.kt").readText()
    private val auth = File("src/main/kotlin/com/vitalguard/wear/pipeline/AuthClient.kt").readText()
    private val activity = File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText()
    private val screen = File("src/main/kotlin/com/vitalguard/wear/ui/LoginScreen.kt").readText()

    @Test
    fun `비밀번호를 저장하지 않는다`() {
        assertFalse(
            "ConfigStore 가 비밀번호를 prefs 에 쓴다",
            cfg.contains("\"password\"") || cfg.contains("putString(\"pw"),
        )
    }

    @Test
    fun `비밀번호를 로그에 싣지 않는다`() {
        // Log 호출 줄 안에 password 식별자가 함께 등장하면 원문이 흘러나간다.
        listOf("AuthClient" to auth, "MainActivity" to activity).forEach { (name, src) ->
            val leak = uncommented(src).lines()
                .filter { it.contains("Log.") && it.contains("password", ignoreCase = true) }
            assertTrue("$name 의 로그에 비밀번호가 실린다: $leak", leak.isEmpty())
        }
    }

    @Test
    fun `화면은 마스킹한 값만 그린다`() {
        assertTrue("LoginScreen 이 maskedPassword 를 안 쓴다", screen.contains("maskedPassword(state.password)"))
        assertFalse(
            "원문 password 를 그대로 그리는 자리가 있다",
            Regex("""Text\(\s*state\.password""").containsMatchIn(screen),
        )
    }

    @Test
    fun `마스킹은 길이만 알려주고 원문을 흘리지 않는다`() {
        assertEquals("", maskedPassword(""))
        assertEquals("●●●●", maskedPassword("abcd"))
        // 아주 긴 비밀번호도 화면을 넘기지 않는다(길이 자체도 힌트라 상한을 둔다).
        assertEquals(12, maskedPassword("a".repeat(40)).length)
        assertFalse(maskedPassword("secret").contains("s"))
    }

    @Test
    fun `로그인 성공 후 상태에서 비밀번호를 비운다`() {
        // ⚠ 앵커를 **성공 분기 안으로** 좁힌다. `login = LoginUiState()` 는 취소·진입 경로에도
        //   있어서 파일 전체를 훑으면 성공 경로에서 사라져도 초록이 뜬다(08-26 변이 8로 실측).
        val okBranch = uncommented(activity)
            .substringAfter("is LoginResult.Ok -> {")
            .substringBefore("is LoginResult.Failed")
        assertTrue("성공 분기를 못 찾았다 — 앵커가 낡았다", okBranch.contains("saveSession"))
        assertTrue(
            "로그인 성공 경로가 비밀번호를 안 비운다",
            okBranch.contains("login = LoginUiState()"),
        )
    }
}

/** 로그아웃·설정 페이지 배치 가드. */
class SettingsPlacementTest {
    private val pages = File("src/main/kotlin/com/vitalguard/wear/ui/DetailPages.kt").readText()
    private val activity = File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText()
    private val cfg = File("src/main/kotlin/com/vitalguard/wear/pipeline/ConfigStore.kt").readText()

    @Test
    fun `설정이 스와이프 맨 끝에 있다`() {
        // 09-09 로그인이 0번으로 들어와 8이 됐다 — 설정은 여전히 맨 끝이다.
        assertTrue("페이지 수가 8이 아니다", pages.contains("val DETAIL_PAGE_COUNT = 8"))
        // when 의 마지막 분기(else)가 설정이어야 '맨 끝' 이다.
        val tail = activity.substringAfter("6 -> StepsDetailPage(vitals)")
        assertTrue("맨 끝 페이지가 설정이 아니다", tail.trimStart().startsWith("else -> SettingsPage"))
    }

    @Test
    fun `로그아웃이 자격 세 가지를 모두 지운다`() {
        val body = cfg.substringAfter("fun clearSession()").substringBefore("}")
        listOf("token", "workerId", "workerName").forEach {
            assertTrue("clearSession 이 $it 를 안 지운다", body.contains("""remove("$it")"""))
        }
    }

    @Test
    fun `로그아웃이 화면 신원까지 비운다`() {
        // prefs 만 지우고 상태를 안 비우면 화면에 이전 사람 이름이 남는다.
        val body = uncommented(activity)
            .substringAfter("private fun logout()")
            .substringBefore("\n    }")
        assertTrue("로그아웃 본문을 못 찾았다 — 앵커가 낡았다", body.contains("clearSession"))
        assertTrue("workerId 상태를 안 비운다", body.contains("workerId = null"))
        assertTrue("workerName 상태를 안 비운다", body.contains("workerName = null"))
    }
}

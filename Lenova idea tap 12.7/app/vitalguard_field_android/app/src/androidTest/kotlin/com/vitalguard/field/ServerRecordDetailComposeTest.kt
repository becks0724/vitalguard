package com.vitalguard.field

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.ui.record.*
import com.vitalguard.field.ui.theme.VgTheme
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.util.TimeZone

/** 2d 실측 시나리오의 합성 표본. 서버/마이크 호출 없이 실제 상세 Compose 경계를 확인한다. */
@RunWith(AndroidJUnit4::class)
class ServerRecordDetailComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var scope: CoroutineScope
    private lateinit var field: FieldCoordinator
    private lateinit var queue: OutboxController
    private val timezone = TimeZone.getDefault()
    private fun setup(denyPhoto: Boolean = false) {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"))
        val comments = (1..4).map { index -> mapOf<String, Any?>("id" to "comment-$index", "media_id" to "photo",
            "body" to if (index == 4) "" else "메모 $index", "created_at" to "2026-09-27T03:00:02.862Z", "author_name" to "담당관",
            "audio_storage_key" to if (index == 4) "private/audio.m4a" else null, "audio_ms" to if (index == 4) 7744 else null) }
        val media = CalendarMedia(mapOf("id" to "photo", "date_key" to "2026-09-27", "annotationId" to "ink",
            "captured_at" to "2026-09-27T02:08:00Z", "comments" to comments))
        val bitmap = Bitmap.createBitmap(120, 90, Bitmap.Config.ARGB_8888)
        val image = ByteArrayOutputStream().use { output -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); output.toByteArray() }
        bitmap.recycle()
        val ink = encodeInk(listOf(InkStroke(InkTool.pen, 0xffdc2626, .01, listOf(InkPoint(.1, .1), InkPoint(.8, .8)))))
        var photoId = ""
        compose.runOnIdle {
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            val gateway = object : MockGateway() {
                override suspend fun calendarMedia(token: String, from: String, to: String) = listOf(media)
                override suspend fun calendarPhoto(token: String, id: String): ByteArray {
                    if (denyPhoto) throw ApiFailure("인증 필요", status = 401, action = "reauth")
                    return if (id == "ink") ink else image
                }
            }
            field = FieldCoordinator(gateway, MemoryStore(), scope)
            queue = OutboxController(field, scope)
            runBlocking {
                field.signIn("a", "mock"); queue.load()
                // 오래된 영수증의 댓글 1개에서 최신 GET의 4개로 바뀌어야 한다.
                photoId = queue.referenceServerPhoto(CalendarMedia(media.json + ("comments" to comments.take(1)))).id
            }
        }
        val actions = RecordActions(queue, scope)
        compose.setContent { VgTheme { PhotoDetail(field, queue, actions, photoId, 1000, {}, {}, {}) } }
    }
    @After fun cleanup() {
        compose.runOnIdle {
            if (::queue.isInitialized) queue.close()
            if (::field.isInitialized) field.close()
            if (::scope.isInitialized) scope.cancel()
        }
        TimeZone.setDefault(timezone)
    }
    @Test fun showsAllFourCommentsLocalTimeDurationAndDisabledVoiceWithReason() {
        setup()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("server-comment-comment-4").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("photo-attachment-counts").performScrollTo().assertTextEquals("주석 1개 이상 · 메모 3 · 음성 1")
        (1..4).forEach { compose.onNodeWithTag("server-comment-comment-$it").assertExists() }
        compose.onAllNodesWithText("담당관 · 2026-09-27 12:00:02").assertCountEquals(4)
        compose.onNodeWithText("음성 · 0:07").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("server-voice-play-comment-4").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("server-voice-error-comment-4").performScrollTo().assertTextEquals(voiceUrlUnavailable)
        compose.onNodeWithTag("photo-annotation-toggle").performClick().assertIsOn()
        compose.waitUntil(5000) { compose.onAllNodesWithContentDescription("주석본").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("photo-annotation-toggle").performClick().assertIsOff()
        compose.runOnIdle { assertEquals(AuthStage.ready, field.state.value.authStage) }
    }
    @Test fun photoAndAnnotation401KeepDetailAndSessionOpen() {
        setup(denyPhoto = true)
        compose.waitUntil(5000) { compose.onAllNodesWithText(auxiliaryAccessDenied).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("photo-detail-actions").assertExists()
        compose.onNodeWithTag("photo-annotation-toggle").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("photo-annotation-error").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("photo-annotation-error").assertTextEquals(auxiliaryAccessDenied)
        compose.runOnIdle { assertEquals(AuthStage.ready, field.state.value.authStage) }
    }
}

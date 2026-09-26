package com.vitalguard.field

// Ports: hold_bundle_ui_test.dart(목록/상세/전송/삭제만), capture_time_test.dart, record_contract_test.dart.
// Camera/ML Kit 대신 enqueue로 사진을 심는다. 실제 서버와 네이티브 촬영은 호출하지 않는다.
import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

private class RecordUiGateway : MockGateway() {
    @Volatile var uploads = 0
    @Volatile var comments = 0
    @Volatile var offline = false
    override suspend fun siteStatus(accessToken: String): SiteStatus {
        if (offline) throw ApiFailure("연결 불가")
        return super.siteStatus(accessToken)
    }
    override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        uploads++; return super.upload(token, bytes, fields)
    }
    override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?): MediaComment {
        comments++; return super.addComment(token, mediaId, body, clientOperationId)
    }
}
@RunWith(AndroidJUnit4::class)
class HoldBundleComposeTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var controller: FieldController
    private lateinit var gateway: RecordUiGateway
    private lateinit var store: MemoryStore
    private lateinit var model: FieldViewModel
    private val graph = object : ExternalResource() {
        override fun before() {
            gateway = RecordUiGateway(); store = MemoryStore()
            val application = ApplicationProvider.getApplicationContext<FieldApplication>()
            application.captureEnabledForTests = false
            application.controllerFactoryForTests = { scope -> FieldCoordinator(gateway, store, scope).also { controller = it } }
            application.internetProbeForTests = InternetProbe { false }
        }
        override fun after() {
            val application = ApplicationProvider.getApplicationContext<FieldApplication>()
            application.captureEnabledForTests = null; application.controllerFactoryForTests = null; application.internetProbeForTests = null
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)
    private fun login() {
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.login }
        compose.onNodeWithTag("login-id").performScrollTo().performTextInput("a")
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5_000) { controller.state.value.authStage == AuthStage.ready }
        compose.runOnIdle { model = ViewModelProvider(compose.activity)[FieldViewModel::class.java] }
    }
    private fun select(index: Int) = compose.onNodeWithTag("rail-destination-$index").performScrollTo().performClick()
    private fun png(): ByteArray {
        val bitmap = Bitmap.createBitmap(72, 72, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.LTGRAY) }
        return ByteArrayOutputStream().use { stream -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream); bitmap.recycle(); stream.toByteArray() }
    }
    private fun photo(title: String = "로컬 작업 사진", attachments: Boolean = false): OutboxEntry {
        lateinit var result: OutboxEntry
        compose.runOnIdle { runBlocking {
            result = model.outbox.enqueue(OutboxKind.photo, png(), mapOf("dateKey" to "2026-09-17", "title" to title,
                "capturedAt" to "2026-09-17T00:30:00Z", "siteId" to "site-a", "roadAddress" to "작성 당시 주소",
                "latitude" to "35.1", "longitude" to "127.2", "ocrText" to "페이지 1\n안전난간 점검"), "작성 현장 A")
            if (attachments) {
                model.outbox.enqueue(OutboxKind.ink, "{\"v\":1}".toByteArray(), emptyMap(), result.siteName,
                    dependsOn = result.id, previewBytes = png())
                model.outbox.enqueue(OutboxKind.text, "한글 안전 점검 메모".toByteArray(), emptyMap(), result.siteName, dependsOn = result.id)
                model.outbox.enqueue(OutboxKind.voice, byteArrayOf(1), mapOf("audioMs" to "1234"), result.siteName, dependsOn = result.id)
                localRecordDraftKeys(result.id).forEach { store.write("a", it, "미저장 초안") }
            }
        } }
        return result
    }
    private fun open(photo: OutboxEntry) {
        select(2)
        compose.onNodeWithTag("record-pending-list").performScrollToNode(hasTestTag("record-photo-${photo.id}"))
        compose.onNodeWithTag("record-photo-${photo.id}").performClick()
        compose.onNodeWithTag("photo-detail-actions").assertExists()
    }
    @Test fun emptyRecordShowsExactTextAndCaptureActions() {
        login(); select(2)
        compose.onNodeWithText("보낼 기록이 없습니다. 촬영한 사진은 여기 모입니다.").assertExists()
        compose.onNodeWithTag("document-scan").assertHeightIsAtLeast(64.dp).assertIsEnabled()
        compose.onNodeWithTag("photo-capture").assertHeightIsAtLeast(64.dp).assertIsEnabled()
        assertEquals(0, gateway.uploads)
    }
    @Test fun localListDetailOcrCountsAndStage2bPlaceholdersUseOriginalConditions() {
        login(); val photo = photo(attachments = true); open(photo)
        compose.onNodeWithTag("photo-bundle-status").assertTextEquals("로컬 저장됨 · 서버 미전송 · 대기")
        for (text in listOf("주석 그리기", "메모·음성 붙이기")) {
            compose.onNodeWithText(text).performScrollTo().assertIsEnabled().assertWidthIsAtLeast(160.dp).assertHeightIsAtLeast(64.dp)
        }
        compose.onNodeWithText("주석 그리기").performClick()
        compose.onNodeWithText("다음 단계(2b)에서 옮깁니다").assertExists()
        compose.onNodeWithText("원문 OCR 보기").performScrollTo().performClick()
        compose.onNodeWithText("페이지 1\n안전난간 점검").performScrollTo().assertExists()
        compose.onNodeWithText("주석 1 · 메모 1 · 음성 1").performScrollTo().assertExists()
        compose.onNodeWithText("한글 안전 점검 메모").performScrollTo().assertExists()
        compose.onNodeWithText("음성 · 0:01").performScrollTo().assertExists()
        assertEquals(0, gateway.uploads); assertEquals(0, gateway.comments)
    }
    @Test fun sendCompletesTheBundleCleansFilesAndReturnsToListWithMockReceipt() {
        login(); val photo = photo(attachments = true); open(photo)
        compose.onNodeWithTag("send-bundle").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(5_000) { model.outbox.bundleCompleted(photo.id) }
        compose.onNodeWithTag("record-pending-list").assertExists()
        compose.onNodeWithTag("record-photo-${photo.id}").assertDoesNotExist()
        compose.runOnIdle { runBlocking {
            assertNull(store.readBytes("a", photo.bytesKey))
            localRecordDraftKeys(photo.id).forEach { assertNull(store.read("a", it)) }
            assertFalse(store.keys("a").any { it.startsWith("outbox-file:") || it.startsWith("outbox-preview:") })
        } }
        select(3)
        compose.onNodeWithTag("outbox-list").performScrollToNode(hasTestTag("outbox-status-${photo.id}"))
        compose.onNodeWithTag("outbox-status-${photo.id}").assertTextEquals(mockCompletedLabel)
        assertEquals(2, gateway.uploads); assertEquals(1, gateway.comments)
    }
    @Test fun deleteRequiresConfirmationAndDeletesBundleAndUnsubmittedDrafts() {
        login(); val photo = photo(attachments = true); val other = photo("남기는 사진"); open(photo)
        compose.onNodeWithTag("delete-bundle").performScrollTo().performClick()
        compose.onNodeWithText("이 사진을 삭제할까요?").assertExists()
        compose.onNodeWithText("기기에 보관한 사진과 딸린 주석·메모·음성을 함께 삭제합니다.").assertExists()
        compose.onNodeWithText("취소").performClick()
        compose.runOnIdle { assertNotNull(model.outbox.entry(photo.id)) }
        compose.onNodeWithTag("delete-bundle").performClick()
        compose.onNodeWithTag("confirm-delete-bundle").performClick()
        compose.waitUntil(5_000) { model.outbox.entry(photo.id) == null }
        compose.onNodeWithTag("record-pending-list").assertExists()
        compose.runOnIdle { runBlocking {
            assertNotNull(model.outbox.entry(other.id)); assertTrue(model.outbox.dependents(photo.id).isEmpty())
            assertNull(store.readBytes("a", photo.bytesKey)); localRecordDraftKeys(photo.id).forEach { assertNull(store.read("a", it)) }
        } }
        assertEquals(0, gateway.uploads)
    }
    @Test fun deleteOneAttachmentKeepsPhotoAndOtherAttachments() {
        login(); val photo = photo(attachments = true); open(photo)
        val text = model.outbox.dependents(photo.id).first { it.kind == OutboxKind.text }
        compose.onNodeWithTag("discard-${text.id}").performScrollTo().performClick()
        compose.waitUntil(5_000) { model.outbox.entry(text.id) == null }
        compose.onNodeWithText("주석 1 · 메모 0 · 음성 1").performScrollTo().assertExists()
        compose.runOnIdle { assertNotNull(model.outbox.entry(photo.id)); assertEquals(2, model.outbox.dependents(photo.id).size) }
    }
    @Test fun offlineDisablesSendButAllowsCaptureAndStage2bActions() {
        login(); val photo = photo()
        compose.runOnIdle { runBlocking { gateway.offline = true; try { controller.siteStatus() } catch (_: ApiFailure) { } } }
        open(photo)
        compose.onNodeWithTag("send-bundle").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("주석 그리기").assertIsEnabled(); compose.onNodeWithText("메모·음성 붙이기").assertIsEnabled()
        compose.onNodeWithText("오프라인입니다. 연결 후 전송할 수 있습니다.").performScrollTo().assertExists()
        Espresso.pressBack()
        compose.onNodeWithTag("document-scan").assertIsEnabled(); compose.onNodeWithTag("photo-capture").assertIsEnabled()
        select(3)
        compose.onNodeWithTag("outbox-list").performScrollToNode(hasTestTag("outbox-${photo.id}"))
        compose.onNodeWithText("전송").assertIsNotEnabled(); assertEquals(0, gateway.uploads)
    }
    @Test fun detailStackOcrAndListScrollSurviveTabSwitchAndActivityRecreation() {
        login()
        val photos = (0 until 16).map { photo("기록 $it") }
        open(photos.first())
        compose.onNodeWithText("원문 OCR 보기").performScrollTo().performClick()
        compose.onNodeWithText("페이지 1\n안전난간 점검").performScrollTo()
        select(4); select(2)
        compose.onNodeWithTag("photo-detail-actions").assertExists()
        compose.onNodeWithText("페이지 1\n안전난간 점검").assertIsDisplayed()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("photo-detail-actions").assertExists()
        compose.onNodeWithText("페이지 1\n안전난간 점검").assertIsDisplayed()
        Espresso.pressBack()
        compose.onNodeWithTag("record-photo-${photos.first().id}").assertIsDisplayed()
        assertEquals(0, gateway.uploads)
    }
}

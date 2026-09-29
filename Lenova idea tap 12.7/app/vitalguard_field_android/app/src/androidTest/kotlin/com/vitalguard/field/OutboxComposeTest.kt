package com.vitalguard.field

// Ports: outbox_test.dart / hold_bundle_ui_test.dart 전송 상태의 필터·조회·재시도·재로그인 UI.
// 실제 네트워크·Activity 촬영 없이 FieldController를 주입하고 enqueue한 사진을 사용한다.
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.ui.outbox.*
import com.vitalguard.field.ui.theme.VgTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private class OutboxUiField(override val operationLookupAvailable: Boolean) : FieldController {
    val mutable = MutableStateFlow(FieldState(authStage = AuthStage.ready, user = AppUser(mapOf("id" to "a", "name" to "담당관", "role" to "admin"))))
    override val state = mutable.asStateFlow()
    override val isMock = true
    override val local = MemoryStore()
    override var beforeLock: (suspend () -> Unit)? = null
    var publishFailure: ApiFailure? = null
    var lookupFailure: ApiFailure? = null
    var presence = OperationPresence.absent
    var uploads = 0; var lookups = 0; var signOuts = 0
    val operationIds = mutableListOf<String?>()
    override suspend fun initialize() {}
    override suspend fun signIn(id: String, password: String, remember: Boolean) {}
    override suspend fun submitTotp(code: String) {}
    override suspend fun cancelSignIn() {}
    override suspend fun signOut() { signOuts++; mutable.value = FieldState(authStage = AuthStage.login) }
    override suspend fun refreshSite() {}
    override suspend fun siteStatus(): SiteStatus = error("현장 API는 호출하지 않는다")
    override suspend fun publish(bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        uploads++; operationIds += fields["clientOperationId"]; publishFailure?.let { throw it }
        return CalendarMedia(mapOf("id" to "server-$uploads", "date_key" to fields["dateKey"]), fields["clientOperationId"])
    }
    override suspend fun lookupOperations(ids: List<String>): Map<String, OperationCheck> {
        lookups++; lookupFailure?.let { throw it }
        return ids.associateWith { OperationCheck(presence, if (presence == OperationPresence.confirmed) mapOf("id" to "server-row") else null) }
    }
}
@RunWith(AndroidJUnit4::class)
class OutboxComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var field: OutboxUiField
    private lateinit var queue: OutboxController
    private lateinit var ui: OutboxUiController
    private lateinit var scope: CoroutineScope
    private fun setup(supportedLookup: Boolean = true, seed: suspend () -> Unit) {
        compose.runOnIdle {
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            field = OutboxUiField(supportedLookup)
            queue = OutboxController(field, scope)
            runBlocking { queue.load(); seed() }
            ui = OutboxUiController(queue, scope)
            ui.setForeground(true); ui.setVisible(true)
        }
        compose.setContent { VgTheme { OutboxScreen(ui) } }
    }
    private suspend fun photo(title: String, site: String = "현장 A", failure: ApiFailure? = null): OutboxEntry {
        val item = queue.enqueue(OutboxKind.photo, byteArrayOf(1), mapOf("dateKey" to "2026-09-26", "title" to title, "siteId" to site), site)
        if (failure != null) { field.publishFailure = failure; queue.send(item); field.publishFailure = null }
        return queue.entry(item.id)!!
    }
    private fun tap(text: String) {
        val target = if (text == "전송") hasContentDescription(text) else hasText(text)
        compose.onNodeWithTag("outbox-list").performScrollToNode(target)
        compose.onNode(target).performClick()
    }
    private fun card(item: OutboxEntry) {
        compose.onNodeWithTag("outbox-list").performScrollToNode(hasTestTag("outbox-${item.id}"))
    }
    @After fun close() {
        if (::scope.isInitialized) compose.runOnIdle { ui.close(); queue.close(); scope.cancel() }
    }
    @Test fun historyFiltersExcludeWaitingAndSeparateCompletedAndFailedBySite() {
        lateinit var waiting: OutboxEntry; lateinit var failed: OutboxEntry; lateinit var completed: OutboxEntry
        setup(false) {
            waiting = photo("대기 사진")
            completed = photo("완료 사진"); queue.sendBundle(completed.id)
            failed = photo("실패 사진", "현장 B", ApiFailure("실패", status = 400))
        }
        compose.onNodeWithTag("outbox-guide").assertDoesNotExist()
        tap("실패 1"); card(failed)
        compose.onNodeWithTag("outbox-status-${failed.id}").assertTextEquals("로컬 저장됨 · 전송 실패")
        compose.onNodeWithTag("outbox-${waiting.id}").assertDoesNotExist()
        tap("전체 2"); tap("현장 A"); card(completed)
        compose.onNodeWithTag("outbox-${failed.id}").assertDoesNotExist()
        compose.onNodeWithText("작성 당시 현장 · 현장 A").assertExists()
    }
    @Test fun failedHistoryHasOnlyManualSendAndOfflineDisablesIt() {
        lateinit var item: OutboxEntry
        setup(false) {
            item = photo("실패 사진", failure = ApiFailure("실패", status = 400))
            field.mutable.value = field.state.value.copy(offline = true)
        }
        card(item); compose.onNodeWithContentDescription("전송").assertIsNotEnabled()
        compose.runOnIdle { field.mutable.value = field.state.value.copy(offline = false) }
        tap("전송"); compose.waitUntil(5000) { queue.bundleCompleted(item.id) }
        card(item); compose.onNodeWithTag("outbox-details-${item.id}").performScrollTo().performClick(); compose.onNodeWithText("작업 ID ${item.id}").assertExists()
        compose.onNodeWithText("모의 확인 시각", substring = true).assertExists()
    }
    @Test fun automaticAbsentLookupKeepsUncertainUntilExplicitSameOperationRetry() {
        lateinit var item: OutboxEntry
        setup { item = photo("결과 불명 사진", failure = ApiFailure("유실", uncertainWrite = true)) }
        compose.waitUntil(5_000) { field.lookups == 1 }
        card(item)
        compose.onNodeWithTag("outbox-status-${item.id}").assertTextEquals("로컬 저장됨 · 서버 결과 불명")
        assertEquals(1, field.uploads)
        tap("같은 작업 재시도")
        compose.waitUntil(5_000) { queue.bundleCompleted(item.id) }
        card(item); compose.onNodeWithTag("outbox-status-${item.id}").assertTextEquals(mockCompletedLabel)
        assertEquals(listOf(item.id, item.id), field.operationIds)
    }
    @Test fun registeredLookupCompletesWithoutAnotherPost() {
        lateinit var item: OutboxEntry
        setup {
            item = photo("확인할 사진", failure = ApiFailure("유실", uncertainWrite = true))
            field.presence = OperationPresence.confirmed
        }
        compose.waitUntil(5_000) { queue.bundleCompleted(item.id) }
        card(item); compose.onNodeWithTag("outbox-status-${item.id}").assertTextEquals(mockCompletedLabel)
        assertEquals(1, field.uploads); assertEquals(mapOf("id" to "server-row"), queue.entry(item.id)!!.receipt)
    }
    @Test fun serverFailureRemainsUncertainAndDoesNotOfferSameOperationRetry() {
        lateinit var item: OutboxEntry
        setup {
            item = photo("조회 장애", failure = ApiFailure("유실", uncertainWrite = true))
            field.lookupFailure = ApiFailure("DB", status = 503)
        }
        compose.waitUntil(5_000) { field.lookups == 1 }
        compose.onNodeWithTag("outbox-lookup-message").assertTextContains("서버 DB 장애", substring = true)
        card(item)
        compose.onNodeWithText("같은 작업 재시도").assertDoesNotExist()
        compose.onNodeWithContentDescription("서버 상태 재조회").assertIsEnabled()
        assertEquals(1, field.uploads); assertEquals(OutboxPhase.uncertain, queue.entry(item.id)!!.phase)
    }
    @Test fun unavailableLookupRequiresExactWebConfirmationDialogBeforeRetry() {
        lateinit var item: OutboxEntry
        setup(false) { item = photo("관제웹 확인", failure = ApiFailure("유실", uncertainWrite = true)) }
        card(item); tap("관제웹 미등록 확인 후 재시도")
        compose.onNodeWithText("서버 반영 여부를 확인했나요?").assertExists()
        compose.onNodeWithText("아직 확인하지 못함").performClick(); assertEquals(1, field.uploads)
        tap("관제웹 미등록 확인 후 재시도")
        compose.onNodeWithText("미등록 확인 · 재시도").performClick()
        compose.waitUntil(5_000) { queue.bundleCompleted(item.id) }
        assertEquals(listOf(item.id, item.id), field.operationIds); assertEquals(0, field.lookups)
    }
    @Test fun reauthenticationFailureOffersLoginAndDisablesOfflineResume() {
        lateinit var item: OutboxEntry
        setup(false) {
            item = photo("재로그인 사진", failure = ApiFailure("만료", status = 401))
            field.mutable.value = field.state.value.copy(offline = true)
        }
        tap("실패 1"); card(item)
        compose.onNodeWithContentDescription("전송").assertIsNotEnabled()
        tap("다시 로그인")
        compose.waitUntil(5_000) { field.signOuts == 1 }
        assertEquals(AuthStage.login, field.state.value.authStage)
        compose.runOnIdle { runBlocking { assertNotNull(field.local.readBytes("a", item.bytesKey)) } }
    }
}

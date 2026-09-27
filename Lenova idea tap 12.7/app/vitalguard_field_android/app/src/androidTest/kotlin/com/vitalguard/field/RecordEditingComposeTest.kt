package com.vitalguard.field

// Ports: record_editor_ink_test.dart / record_input_test.dart / voice_comment_test.dart / record_recovery_test.dart.
// 실제 마이크·STT·HTTP 없이 기기 UI와 raw stylus/touch 분리를 확인한다.
import android.graphics.Bitmap
import android.graphics.Color
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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

@RunWith(AndroidJUnit4::class)
class RecordEditingComposeTest {
    private val compose=createAndroidComposeRule<MainActivity>()
    private lateinit var field: FieldController
    private lateinit var store: MemoryStore
    private lateinit var model: FieldViewModel
    private val graph=object:ExternalResource() {
        override fun before() {
            store=MemoryStore()
            ApplicationProvider.getApplicationContext<FieldApplication>().apply {
                captureEnabledForTests=false
                controllerFactoryForTests={scope->FieldCoordinator(MockGateway(),store,scope).also { field=it }}
                internetProbeForTests=InternetProbe { false }
                speechFactoryForTests={MockSpeechInput()}; recorderFactoryForTests={MockVoiceRecorder(it)}
            }
        }
        override fun after() {
            ApplicationProvider.getApplicationContext<FieldApplication>().apply {
                captureEnabledForTests=null; controllerFactoryForTests=null; internetProbeForTests=null
                speechFactoryForTests=null; recorderFactoryForTests=null
            }
        }
    }
    @get:Rule val rules:RuleChain=RuleChain.outerRule(graph).around(compose)
    private fun login() {
        compose.waitUntil(5000){field.state.value.authStage in listOf(AuthStage.login,AuthStage.reauthenticate)}
        compose.onNodeWithTag("login-id").performScrollTo().performTextClearance()
        compose.onNodeWithTag("login-id").performTextInput("a")
        compose.onNodeWithTag("login-password").performScrollTo().performTextClearance()
        compose.onNodeWithTag("login-password").performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5000){field.state.value.authStage==AuthStage.ready}
        compose.runOnIdle { model=ViewModelProvider(compose.activity)[FieldViewModel::class.java] }
    }
    private fun settleKeyboard() {
        // Native IME animation does not participate in Compose idleness.
        Espresso.closeSoftKeyboard()
        compose.waitUntil(5000) {
            compose.runOnIdle {
                val insets = ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
                insets != null && !insets.isVisible(WindowInsetsCompat.Type.ime()) &&
                    insets.getInsets(WindowInsetsCompat.Type.ime()).bottom == 0
            }
        }
    }
    private fun photo():OutboxEntry {
        lateinit var result:OutboxEntry
        compose.runOnIdle { runBlocking {
            val bitmap=Bitmap.createBitmap(1000,750,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
            val bytes=ByteArrayOutputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it); bitmap.recycle(); it.toByteArray() }
            result=model.outbox.enqueue(OutboxKind.photo,bytes,mapOf("dateKey" to "2026-09-26","title" to "2b 로컬 사진","siteId" to "site-a"),"작성 현장 A")
        } }
        return result
    }
    private fun open(photo:OutboxEntry,ink:Boolean) {
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        compose.runOnIdle { model.calendar.select(java.time.LocalDate.parse(photo.fields.getValue("dateKey"))) }
        compose.onNodeWithTag("week-day-${photo.fields["dateKey"]}").performClick()
        compose.onNodeWithTag("calendar-day-list").performScrollToNode(hasTestTag("record-photo-${photo.id}"))
        compose.onNodeWithTag("record-photo-${photo.id}").performClick()
        compose.onNodeWithTag(if(ink) "photo-open-editor" else "photo-open-input").performScrollTo().performClick()
        if(ink) compose.waitUntil(5000){compose.onAllNodesWithTag("ink-canvas").fetchSemanticsNodes().isNotEmpty()}
        else compose.onNodeWithTag("record-note").assertExists()
    }
    private fun stylus(cancel:Boolean=false,flags:Int=0) {
        val bounds=compose.onNodeWithTag("ink-canvas").fetchSemanticsNode().boundsInWindow
        val downTime=SystemClock.uptimeMillis()
        compose.runOnIdle {
            val properties=MotionEvent.PointerProperties().apply { id=0; toolType=MotionEvent.TOOL_TYPE_STYLUS }
            val actions=listOf(MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,if(cancel) MotionEvent.ACTION_CANCEL else MotionEvent.ACTION_UP)
            actions.forEachIndexed { i, action ->
                val coordinates=MotionEvent.PointerCoords().apply {
                    x=bounds.center.x+(if(i==0) -40 else 40); y=bounds.center.y; pressure=if(i==2) 0f else .6f; size=.01f
                }
                val event=MotionEvent.obtain(downTime,downTime+i*16,action,1,arrayOf(properties),arrayOf(coordinates),0,0,1f,1f,0,0,InputDevice.SOURCE_STYLUS,if(i==2)flags else 0)
                try { compose.activity.dispatchTouchEvent(event) } finally { event.recycle() }
            }
        }
        compose.waitForIdle()
    }
    @Test fun toolbarHasMinimumTargetsAndSelectionAndFingerCannotDraw() {
        login(); open(photo(),true)
        for(tag in listOf("tool-pen","tool-marker","tool-rectangle","tool-eraser","width-thin","width-normal","width-thick","color-red","color-black","color-blue","undo","clear-all","original-only","fit-width")) {
            compose.onNodeWithTag("editor-$tag").performScrollTo().assertWidthIsAtLeast(56.dp).assertHeightIsAtLeast(56.dp)
        }
        compose.onNodeWithTag("editor-tool-pen").assertIsSelected()
        compose.onNodeWithTag("editor-width-normal").assertIsSelected()
        compose.onNodeWithTag("editor-color-blue").performClick().assertIsSelected()
        compose.onNodeWithTag("ink-canvas").performTouchInput { swipe(center,center+androidx.compose.ui.geometry.Offset(40f,20f)) }
        compose.runOnIdle { assertTrue(model.records.editor!!.state.value.strokes.isEmpty()) }
        compose.onNodeWithTag("editor-save").assertIsNotEnabled().assertWidthIsEqualTo(180.dp).assertHeightIsEqualTo(64.dp)
        compose.onNodeWithTag("rail-collapsed").assertExists()
        compose.onNodeWithTag("rail-collapse-toggle").assertIsNotEnabled()
    }
    @Test fun stylusCancelAndFlagCanceledAreDiscardedButNormalReleaseSavesInk() {
        login(); val photo=photo(); open(photo,true)
        stylus(cancel=true); compose.runOnIdle { assertTrue(model.records.editor!!.state.value.strokes.isEmpty()) }
        stylus(flags=0x20); compose.runOnIdle { assertTrue(model.records.editor!!.state.value.strokes.isEmpty()) }
        stylus(); compose.runOnIdle { assertEquals(1,model.records.editor!!.state.value.strokes.size) }
        compose.onNodeWithTag("editor-save").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(5000){model.outbox.dependents(photo.id).size==1}
        compose.onNodeWithTag("photo-detail-actions").assertExists()
        compose.onNodeWithText("주석 1 · 메모 0 · 음성 0").performScrollTo().assertExists()
        compose.runOnIdle { runBlocking {
            val ink=model.outbox.dependents(photo.id).single(); assertEquals(OutboxKind.ink,ink.kind)
            assertNotNull(store.readBytes("a","outbox-preview:${ink.id}")); assertEquals(OutboxPhase.waiting,ink.phase)
        } }
    }
    @Test fun systemBackKeepsDraftAndRotationKeepsSameEditor() {
        login(); val photo=photo(); open(photo,true); stylus()
        val editor=model.records.editor
        compose.activityRule.scenario.recreate(); compose.waitForIdle()
        compose.runOnIdle { assertSame(editor,model.records.editor); assertEquals(1,editor!!.state.value.strokes.size) }
        Espresso.pressBack(); compose.onNodeWithText("작성 중인 주석을 보관하고 나갈까요?").assertExists()
        compose.onNodeWithText("계속 작성").performClick(); compose.onNodeWithTag("ink-canvas").assertExists()
        Espresso.pressBack(); compose.onNodeWithTag("editor-keep-draft").performClick()
        compose.onNodeWithTag("photo-open-editor").performScrollTo().performClick()
        compose.waitUntil(5000){model.records.editor?.state?.value?.strokes?.size==1}
        compose.onNodeWithTag("editor-undo").performClick(); compose.runOnIdle { assertTrue(model.records.editor!!.state.value.strokes.isEmpty()) }
    }
    @Test fun memoIsConfirmedAndSavedAsSingleLocalAttachment() {
        login(); val photo=photo(); open(photo,false)
        compose.onNodeWithText("관리자 기록").assertExists()
        compose.onNodeWithTag("record-note").performTextInput("보호구 미착용 확인 2층")
        settleKeyboard()
        compose.runOnIdle { assertEquals("보호구 미착용 확인 2층", model.records.input!!.state.value.note) }
        compose.onNodeWithTag("save-record").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("confirm-record").performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithTag("save-record").performScrollTo().assertIsEnabled().assertHeightIsAtLeast(64.dp).performClick()
        compose.waitUntil(5000) {
            assertNull("메모 저장 오류", model.records.input!!.state.value.error)
            model.outbox.dependents(photo.id).size == 1
        }
        compose.runOnIdle { runBlocking {
            val memo = model.outbox.dependents(photo.id).single()
            assertEquals(OutboxKind.text, memo.kind); assertEquals(OutboxPhase.waiting, memo.phase)
            assertFalse(memo.autoSendReady); assertEquals(photo.id, model.records.detail.value)
            assertEquals(OutboxPhase.waiting, model.outbox.entry(photo.id)!!.phase)
            assertEquals("보호구 미착용 확인 2층", store.readBytes("a", memo.bytesKey)!!.toString(Charsets.UTF_8))
        } }
        compose.onNodeWithText("메모를 기기에 저장했습니다. 사진 상세를 닫으면 자동으로 전송됩니다.").assertExists()
        compose.onNodeWithTag("record-input-back").performClick()
        compose.onNodeWithText("주석 0 · 메모 1 · 음성 0").performScrollTo().assertExists()
        compose.runOnIdle { assertEquals(1, model.outbox.dependents(photo.id).size); assertEquals(photo.id, model.records.detail.value) }
    }
    @Test fun mockSpeechRequiresSelectionEditingAndExplicitConfirmation() {
        login(); val photo=photo(); open(photo,false)
        compose.onNodeWithTag("speech-start").performScrollTo().performClick()
        compose.onNodeWithTag("speech-candidate-0").performScrollTo().performClick()
        compose.onNodeWithTag("save-record").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("record-speech-text").performScrollTo().performTextReplacement("작업 중지 2층")
        settleKeyboard()
        compose.onNodeWithTag("confirm-record").performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithTag("save-record").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(5000){model.outbox.dependents(photo.id).size==1}
        compose.runOnIdle { runBlocking { assertEquals("작업 중지 2층",store.readBytes("a",model.outbox.dependents(photo.id).single().bytesKey)!!.toString(Charsets.UTF_8)) } }
    }
    @Test fun mockRecordingCanStopPreviewAndSaveWithoutLosingNote() {
        login(); val photo=photo(); open(photo,false)
        compose.onNodeWithTag("record-note").performTextInput("녹음과 함께 남길 글")
        compose.onNodeWithTag("voice-start").performScrollTo().performClick()
        compose.onNodeWithTag("voice-elapsed").assertExists(); compose.onNodeWithTag("speech-start").assertIsNotEnabled()
        compose.onNodeWithTag("voice-stop").performScrollTo().performClick()
        compose.onNodeWithTag("voice-preview").performScrollTo().performClick()
        compose.onNodeWithTag("voice-send").performScrollTo().performClick()
        compose.waitUntil(5000){model.outbox.dependents(photo.id).size==1}
        compose.runOnIdle { assertEquals("녹음과 함께 남길 글",model.records.input!!.state.value.note); assertEquals(OutboxKind.voice,model.outbox.dependents(photo.id).single().kind) }
        compose.onNodeWithTag("record-input-back").performClick()
        compose.onNodeWithText("주석 0 · 메모 0 · 음성 1").performScrollTo().assertExists()
    }
    @Test fun reloginRestoresPhotoThenEditorAndReturnsToDetailOnBack() {
        login(); val photo=photo(); open(photo,true); stylus()
        compose.runOnIdle { model.records.launch { field.signOut() } }
        login()
        compose.waitUntil(5000){model.records.editor?.state?.value?.strokes?.size==1}
        compose.onNodeWithTag("ink-canvas").assertExists()
        Espresso.pressBack(); compose.onNodeWithTag("editor-keep-draft").performClick()
        compose.onNodeWithTag("photo-detail-actions").assertExists()
        compose.runOnIdle { assertTrue(model.outbox.dependents(photo.id).isEmpty()) }
    }
    @Test fun inputCursorAndTextSurviveRecreationWithoutForcingKeyboard() {
        login(); open(photo(),false)
        compose.onNodeWithTag("record-note").performTextInput("앞뒤 문장")
        compose.onNodeWithTag("record-note").performTextInputSelection(androidx.compose.ui.text.TextRange(2))
        compose.activityRule.scenario.recreate(); compose.waitForIdle()
        compose.onNodeWithTag("record-note").performTextInput("추가")
        compose.runOnIdle { assertEquals("앞뒤추가 문장",model.records.input!!.state.value.note) }
    }
}

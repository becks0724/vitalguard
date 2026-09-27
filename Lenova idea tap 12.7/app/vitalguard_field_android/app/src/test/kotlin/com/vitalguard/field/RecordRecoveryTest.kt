package com.vitalguard.field

// Port: record_recovery_test.dart / voice_comment_test.dart / beforeLock.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RecordRecoveryTest {
    @Test fun activeSessionUsesLatestLocalPhotoAndStripsRemoteUrls() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val session=RecordSession(rig.field,rig.box,"a")
        session.remember(CalendarMedia(fromOutbox(photo).json+mapOf("media_url" to "https://never.fetch/image", "title" to "옛 제목")),ink=true)
        val raw=rig.store.read("a",recordSessionKey)!!; assertFalse(raw.contains("never.fetch"))
        val recovered=session.read()!!; assertTrue(recovered.ink); assertEquals(photo.id,recovered.media.id); assertEquals("작업 사진",recovered.media.title)
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun missingOrCompletedBundleClosesOnlyTheSession() = runTest {
        for (completed in listOf(false,true)) {
            val rig=outboxRig(); val photo=rig.photo(); val session=RecordSession(rig.field,rig.box,"a")
            session.remember(fromOutbox(photo)); rig.store.write("a","annotation:${photo.id}","preserve")
            rig.restore(if(completed) listOf(photo.copy(phase=OutboxPhase.completed)) else emptyList())
            val restored=RecordSession(rig.field,rig.box,"a"); assertNull(restored.read()); assertNull(rig.store.read("a",recordSessionKey))
            assertEquals("preserve",rig.store.read("a","annotation:${photo.id}"))
        }
    }
    @Test fun anotherAccountDoesNotReadOrRemoveOriginalAccountSession() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); RecordSession(rig.field,rig.box,"a").remember(fromOutbox(photo),ink=true)
        rig.field.signOut(); rig.field.signIn("b","mock"); rig.box.load()
        assertNull(RecordSession(rig.field,rig.box,"b").read()); assertNotNull(rig.store.read("a",recordSessionKey))
        rig.field.signOut(); rig.field.signIn("a","mock"); assertEquals(photo.id,RecordSession(rig.field,rig.box,"a").read()!!.media.id)
    }
    @Test fun shellRecoveryIsOfferedOnlyOncePerLoginAndBadJsonShowsExactMessage() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val messages=mutableListOf<String>()
        val workspace=RecordWorkspace(rig.field,rig.box,FakeInkRenderer(),FakeSpeech(),FakeVoice(),backgroundScope,messages::add)
        workspace.bindAccount("a"); RecordSession(rig.field,rig.box,"a").remember(fromOutbox(photo),ink=true)
        assertTrue(workspace.restoreSession()); val saved=workspace.recovery.value!!; workspace.consumeRecovery(saved)
        assertFalse(workspace.restoreSession()); assertNull(workspace.recovery.value)
        workspace.bindAccount(null); workspace.bindAccount("a"); rig.store.write("a",recordSessionKey,"{")
        assertFalse(workspace.restoreSession()); assertEquals(listOf("작성하던 기록을 열지 못했습니다. 같은 사진에서 초안을 다시 열어 주세요."),messages)
        assertEquals("{",rig.store.read("a",recordSessionKey)); workspace.close()
    }
    @Test fun beforeLockSavesActiveInkTextAndVoiceThenSameAccountReopensStackTarget() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val fake=FakeVoice(); val messages=mutableListOf<String>()
        val workspace=RecordWorkspace(rig.field,rig.box,FakeInkRenderer(),FakeSpeech(),fake,backgroundScope,messages::add)
        workspace.bindAccount("a"); val input=workspace.input(photo.id); runCurrent(); input.note("로그인 전 보관")
        input.voice.start(); val editor=workspace.editor(photo.id); runCurrent(); editor.viewport(InkSize(1000.0,1000.0),1.0)
        editor.penDown(1,InkOffset(100.0,500.0),.5)
        rig.field.beforeLock={workspace.flush()}
        rig.gateway.statusFailure=ApiFailure("다시 로그인",status=401,action="reauth")
        rejects { rig.field.siteStatus() }; assertEquals(AuthStage.reauthenticate,rig.field.state.value.authStage)
        assertNotNull(rig.store.readBytes("a",input.voice.audioKey)); assertFalse(fake.recording)
        assertEquals("로그인 전 보관",Json.decodeObject(rig.store.read("a",input.key)!!)["text"])
        assertEquals(1,(Json.decodeObject(rig.store.read("a",editor.draftKey)!!)["strokes"] as List<*>).size)
        workspace.bindAccount(null); rig.gateway.statusFailure=null; rig.field.signIn("a","mock"); workspace.bindAccount("a")
        assertTrue(workspace.restoreSession()); assertTrue(workspace.recovery.value!!.ink); assertEquals(photo.id,workspace.recovery.value!!.media.id)
        assertTrue(rig.gateway.writes.isEmpty()); workspace.close()
    }
    @Test fun editorAboveInputReturnsSessionToInputAndRepeatedOpenRetainsControllers() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val workspace=RecordWorkspace(rig.field,rig.box,FakeInkRenderer(),FakeSpeech(),FakeVoice(),backgroundScope,{})
        workspace.bindAccount("a"); val input=workspace.input(photo.id); runCurrent(); input.note("유지")
        val editor=workspace.editor(photo.id); runCurrent(); assertSame(editor,workspace.editor(photo.id)); assertSame(input,workspace.input(photo.id))
        assertTrue(RecordSession(rig.field,rig.box,"a").read()!!.ink)
        assertTrue(editor.leave()); workspace.finishEditor(editor); assertFalse(RecordSession(rig.field,rig.box,"a").read()!!.ink)
        assertEquals("유지",input.state.value.note); workspace.close()
    }
    @Test fun navigationFlushWaitsForInFlightLocalSaveBeforeDetachingScreen() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val renderer=FakeInkRenderer()
        val workspace=RecordWorkspace(rig.field,rig.box,renderer,FakeSpeech(),FakeVoice(),backgroundScope,{})
        workspace.bindAccount("a"); val editor=workspace.editor(photo.id); runCurrent()
        editor.viewport(InkSize(1000.0,1000.0),1.0); editor.stroke(); renderer.gate=CompletableDeferred()
        val save=async { editor.save() }; runCurrent(); val flush=async { workspace.flush() }; runCurrent()
        assertFalse(flush.isCompleted); renderer.gate!!.complete(Unit)
        assertTrue(save.await()); flush.await(); assertEquals(1,rig.box.dependents(photo.id).size)
        workspace.close()
    }
    @Test fun failedInkFlushStillStopsAndPreservesVoiceBeforeLock() = runTest {
        val store=FaultStore(); val rig=outboxRig(store=store); val photo=rig.photo(); val fake=FakeVoice()
        val workspace=RecordWorkspace(rig.field,rig.box,FakeInkRenderer(),FakeSpeech(),fake,backgroundScope,{})
        workspace.bindAccount("a"); val input=workspace.input(photo.id); runCurrent(); input.voice.start()
        val editor=workspace.editor(photo.id); runCurrent(); editor.viewport(InkSize(1000.0,1000.0),1.0); editor.stroke()
        store.fails={key,_->key==editor.draftKey}; rejects { workspace.flush() }
        assertFalse(fake.recording); assertNotNull(store.readBytes("a",input.voice.audioKey)); workspace.close()
    }
}

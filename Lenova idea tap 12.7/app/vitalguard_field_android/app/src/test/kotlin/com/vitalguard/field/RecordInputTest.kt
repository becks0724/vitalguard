package com.vitalguard.field

// Ports: record_input_test.dart / record_recovery_test.dart. 후보는 확인 전 영속화하지 않는다.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class FakeSpeech : SpeechInput {
    private val mutable=MutableSharedFlow<JsonObject>(extraBufferCapacity=16)
    override val events=mutable.asSharedFlow()
    var id: String? = null
    var supported=true
    var availabilityGate: CompletableDeferred<Unit>?=null
    var failure: Exception?=null
    var stops=0
    override suspend fun available(): Boolean { availabilityGate?.await(); return supported }
    override suspend fun start(runId: String) { id=runId; failure?.let { throw it } }
    override suspend fun stop(cancel: Boolean) { stops++ }
    suspend fun event(type: String, data: JsonObject=emptyMap(), run: String?=id) { mutable.emit(mapOf("type" to type,"runId" to run)+data) }
}
suspend fun OutboxRig.input(photo: OutboxEntry, speech: SpeechInput = FakeSpeech(), recorder: VoiceRecorder = MockVoiceRecorder(scope)): RecordInputController =
    RecordInputController(field,box,fromOutbox(photo),"a",speech,recorder,scope).also { it.restore() }
@OptIn(ExperimentalCoroutinesApi::class)
class RecordInputTest {
    @Test fun partialAndUnselectedOrUnconfirmedCandidatesAreNeverPersisted() = runTest {
        val rig=outboxRig(); val speech=FakeSpeech(); val input=rig.input(rig.photo(),speech)
        input.note("직접 쓴 내용"); input.startSpeech()
        speech.event("partial",mapOf("results" to listOf("미확인 비밀 후보"))); runCurrent(); input.persist().await()
        assertFalse(rig.store.read("a",input.key)!!.contains("미확인"))
        speech.event("final",mapOf("results" to List(8) { "후보 $it" })); runCurrent()
        assertEquals(5,input.state.value.candidates.size); input.choose(1); input.persist().await()
        assertEquals("직접 쓴 내용",Json.decodeObject(rig.store.read("a",input.key)!!)["text"])
        input.save(); assertTrue(rig.box.dependents(input.media.id).isEmpty())
        input.speechText("미착용 작업 중지 2층"); input.confirm(true); input.persist().await()
        assertEquals("직접 쓴 내용\n미착용 작업 중지 2층",Json.decodeObject(rig.store.read("a",input.key)!!)["text"])
        input.speechText("미착용 작업 중지 3층"); input.persist().await()
        assertFalse(input.state.value.confirmed); assertEquals("직접 쓴 내용",Json.decodeObject(rig.store.read("a",input.key)!!)["text"])
    }
    @Test fun memoSaveCreatesOneDependentWithExactKeysAndNeverSendsEvenAfterReconnect() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val input=rig.input(photo); rig.offline()
        input.note("현장 메모"); input.confirm(true); input.save()
        val first=rig.box.dependents(photo.id).single()
        assertEquals(OutboxKind.text,first.kind); assertEquals(listOf(input.key),first.draftKeys)
        assertTrue(first.sourceKey!!.startsWith("comment-draft:${photo.id}:"))
        assertEquals("현장 메모",rig.store.readBytes("a",first.bytesKey)!!.toString(Charsets.UTF_8))
        assertNull(rig.store.read("a",input.key)); assertEquals("",input.state.value.note)
        assertEquals("메모를 기기에 저장했습니다. 사진 상세에서 함께 전송해 주세요.",input.state.value.notice)
        rig.offline(false); input.note("현장 메모"); input.confirm(true); input.save()
        assertEquals(2,rig.box.dependents(photo.id).size); assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun staleEventsAreIgnoredAfterFlushAndSpeechAvailabilityWaitCanBeCancelled() = runTest {
        val rig=outboxRig(); val speech=FakeSpeech(); val input=rig.input(rig.photo(),speech)
        input.startSpeech(); val previous=speech.id; input.flush()
        speech.event("final",mapOf("results" to listOf("늦은 문장")),previous); runCurrent()
        assertFalse(input.state.value.speaking); assertTrue(input.state.value.candidates.isEmpty())
        speech.availabilityGate=CompletableDeferred(); val start=launch { input.startSpeech() }; runCurrent()
        assertTrue(input.state.value.speaking); input.flush(); speech.availabilityGate!!.complete(Unit); start.join()
        assertEquals(previous,speech.id); assertFalse(input.state.value.speaking)
    }
    @Test fun onlyCurrentRunUpdatesStatusFinalErrorAndCancellation() = runTest {
        val rig=outboxRig(); val speech=FakeSpeech(); val input=rig.input(rig.photo(),speech)
        input.startSpeech(); speech.event("status",mapOf("state" to "ready")); runCurrent(); assertEquals("말씀하세요",input.state.value.speechStatus)
        speech.event("status",mapOf("state" to "waiting_final")); runCurrent(); assertEquals("후보를 받는 중",input.state.value.speechStatus)
        speech.event("error",mapOf("code" to 9,"name" to "ERROR_INSUFFICIENT_PERMISSIONS")); runCurrent()
        assertEquals("음성 인식 오류 9 · ERROR_INSUFFICIENT_PERMISSIONS",input.state.value.error)
        input.startSpeech(); speech.event("diagnostic_error"); runCurrent(); assertEquals("음성 입력이 중단됐습니다",input.state.value.speechStatus)
    }
    @Test fun unavailableAndDeniedSpeechRestoreOtherInputs() = runTest {
        val rig=outboxRig(); val speech=FakeSpeech(); val input=rig.input(rig.photo(),speech)
        speech.supported=false; input.startSpeech(); assertFalse(input.state.value.speaking)
        assertEquals("온디바이스 인식기를 사용할 수 없습니다. 직접 입력해 주세요.",input.state.value.error)
        speech.supported=true; speech.failure=ApiFailure("거절",code="microphone_denied"); input.startSpeech()
        assertFalse(input.state.value.speaking); assertEquals("마이크 권한과 인식기 상태를 확인해 주세요",input.state.value.error)
    }
    @Test fun textPersistsBeforeSlowRecorderStopAndStorageFailureDoesNotSkipAudioStop() = runTest {
        val store=FaultStore(); val rig=outboxRig(store=store); val fake=FakeVoice(); val speech=FakeSpeech(); val input=rig.input(rig.photo(),speech,fake)
        input.note("먼저 저장할 글"); input.voice.start(); fake.stopGate=CompletableDeferred()
        val flush=async { input.flush() }; runCurrent()
        assertEquals("먼저 저장할 글",Json.decodeObject(store.read("a",input.key)!!)["text"])
        assertTrue(speech.stops>0); fake.stopGate!!.complete(Unit); flush.await()
        store.fails={key,_->key==input.key}; rejects { input.flush() }; assertTrue(fake.stopPlayCalls>0)
        assertFalse(input.leave()); store.fails={_,_->false}; assertTrue(input.leave())
    }
    @Test fun newControllerRestoresOnlyConfirmedTextAndEmptyTextDeletesDraft() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val speech=FakeSpeech(); val input=rig.input(photo,speech)
        input.note("기존 글"); input.startSpeech(); speech.event("final",mapOf("results" to listOf("확인 문장"))); runCurrent()
        input.choose(0); input.confirm(true); input.flush(); input.close()
        val restored=rig.input(photo); assertEquals("기존 글\n확인 문장",restored.state.value.note); assertFalse(restored.state.value.confirmed)
        assertTrue(restored.state.value.candidates.isEmpty()); restored.note(""); restored.persist().await(); assertNull(rig.store.read("a",restored.key))
    }
}

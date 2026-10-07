package com.vitalguard.field

// Ports: voice_comment_test.dart / voice_recorder_test.dart / voice_upload_test.dart.
import com.vitalguard.field.audio.completeAdtsLength
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

class FakeVoice : RecoverableVoiceRecorder {
    private val mutable=MutableSharedFlow<JsonObject>(extraBufferCapacity=16)
    override val events=mutable.asSharedFlow()
    val files=mutableMapOf<String,ByteArray>()
    val recovery=mutableMapOf<String,VoiceRecording>()
    var key: String?=null
    var starts=0; var stopPlayCalls=0; var reads=0; var plays=0; var closed=false
    var startFailure: Exception?=null
    var readFailure: Exception?=null
    var readGate: CompletableDeferred<Unit>?=null
    var cancelFailure: Exception?=null
    var stopGate: CompletableDeferred<Unit>?=null
    var startGate: CompletableDeferred<Unit>?=null
    var recording=false
    var clip: VoiceRecording?=null
    var byteCount=10
    override suspend fun start()=startDraft("")
    override suspend fun startDraft(draftKey: String) { starts++; key=draftKey; startFailure?.let { throw it }; startGate?.await(); recording=true; clip=null }
    fun finish(reason: String="manual"): VoiceRecording {
        recording=false
        return VoiceRecording("fake-$starts.m4a",2000,byteCount,reason).also { clip=it; files[it.path]=ByteArray(byteCount){1}; key?.let { key -> recovery[key]=it } }
    }
    suspend fun event(reason: String) { mutable.emit(finish(reason).toJson()+("type" to "stopped")) }
    suspend fun playbackStopped() { mutable.emit(mapOf("type" to "playbackStopped")) }
    override suspend fun stop(): VoiceRecording? { stopGate?.await(); return if(recording) finish() else clip }
    override suspend fun recoverDraft(draftKey: String)=recovery[draftKey]
    override suspend fun read(path: String): ByteArray { reads++; readGate?.await(); readFailure?.let { throw it }; return requireNotNull(files[path]) }
    override suspend fun cancel(path: String?) { cancelFailure?.let { throw it }; val target=path?:clip?.path; files.remove(target); recovery.entries.removeAll { it.value.path==target }; clip=null; recording=false }
    override suspend fun play(audio: ByteArray) { plays++; check(audio.isNotEmpty()) }
    override suspend fun stopPlay() { stopPlayCalls++ }
    override fun close() { closed=true }
}
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceDraftTest {
    @Test fun recordStopPreviewSaveKeepsNoteAndQueuesExactVoiceContract() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val recorder=FakeVoice(); val input=rig.input(photo,recorder=recorder); val v=input.voice
        input.note("타이핑 유지"); v.start(); assertEquals(Json.encode(listOf("a",photo.id)),recorder.key)
        advanceTimeBy(2100); runCurrent(); assertEquals(2000,v.state.value.elapsedMs); v.stop()
        assertEquals(2000,v.state.value.clip!!.durationMs); assertNotNull(rig.store.readBytes("a",v.audioKey))
        v.preview(); assertTrue(v.state.value.playing); recorder.playbackStopped(); runCurrent(); assertFalse(v.state.value.playing)
        v.send(); val entry=rig.box.dependents(photo.id).single()
        assertEquals(OutboxKind.voice,entry.kind); assertEquals("2000",entry.fields["audioMs"]); assertEquals("site-a",entry.fields["siteId"])
        assertEquals(listOf(v.key,v.audioKey),entry.draftKeys); assertTrue(entry.sourceKey!!.startsWith("${v.key}:recording:"))
        assertNull(v.state.value.clip); assertNull(rig.store.read("a",v.key)); assertNull(rig.store.readBytes("a",v.audioKey))
        assertEquals("타이핑 유지",input.state.value.note); assertTrue(rig.gateway.writes.isEmpty()); assertTrue(recorder.files.isEmpty())
    }
    @Test fun sequentialRecordingsWithSameBytesCreateDifferentOperations() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val v=rig.input(photo,recorder=FakeVoice()).voice
        repeat(2) { v.start(); v.stop(); v.send() }
        val all=rig.box.dependents(photo.id); assertEquals(2,all.size); assertNotEquals(all[0].sourceKey,all[1].sourceKey)
    }
    @Test fun recoveryUsesAccountAndMediaKeyAndSurvivesMissingNativeCache() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val fake=FakeVoice(); val original=rig.input(photo,recorder=fake)
        original.voice.start(); original.voice.stop(); original.close(); fake.files.clear(); fake.recovery.clear()
        val restored=rig.input(photo,recorder=fake).voice; assertNotNull(restored.state.value.clip)
        restored.preview(); restored.send(); assertEquals(1,rig.box.dependents(photo.id).size)
        assertTrue(rig.gateway.writes.isEmpty())
    }
    @Test fun processDeathBeforeStopCallbackRecoversNativeJournal() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val fake=FakeVoice(); val original=rig.input(photo,recorder=fake)
        original.voice.start(); fake.finish("interrupted"); original.close()
        val recovered=rig.input(photo,recorder=fake).voice
        assertNotNull(recovered.state.value.clip)
        assertEquals("중단된 녹음을 복원했습니다. 들어본 뒤 저장해 주세요.",recovered.state.value.notice)
        assertNotNull(rig.store.readBytes("a",recovered.audioKey)); assertTrue(rig.box.dependents(photo.id).isEmpty())
    }
    @Test fun allAutomaticStopReasonsHaveOriginalMessagesAndNoUpload() = runTest {
        val notices=mapOf("maxDuration" to "최대 3분까지 녹음됩니다", "maxSize" to "녹음 용량 한도에 도달해 정지했습니다",
            "background" to "앱이 백그라운드로 전환되어 녹음을 정지했습니다", "recorderError" to "녹음이 중단됐습니다. 저장된 소리를 확인해 주세요.")
        for ((reason,notice) in notices) {
            val rig=outboxRig(); val photo=rig.photo(); val fake=FakeVoice(); val v=rig.input(photo,recorder=fake).voice
            v.start(); fake.event(reason); runCurrent(); assertEquals(notice,v.state.value.notice); assertFalse(v.state.value.recording)
            assertNotNull(rig.store.readBytes("a",v.audioKey)); assertTrue(rig.gateway.writes.isEmpty())
        }
    }
    @Test fun microphoneDenialAndReadFailureKeepRecoverablePath() = runTest {
        val rig=outboxRig(); val fake=FakeVoice(); val v=rig.input(rig.photo(),recorder=fake).voice
        fake.startFailure=ApiFailure("denied",code="microphone_denied"); v.start(); assertEquals("마이크 권한이 필요합니다",v.state.value.error)
        assertFalse(v.state.value.audioBusy); fake.startFailure=null; v.start()
        fake.readFailure=IllegalStateException("읽기 실패"); v.stop(); assertNotNull(v.state.value.clip)
        assertTrue(rig.store.read("a",v.key)!!.contains("fake-")); assertTrue(fake.files.isNotEmpty())
        fake.readFailure=null; v.send(); assertEquals(1,rig.box.dependents(v.mediaId).size)
    }
    @Test fun failureToPersistBeforeSendRetainsClipAndDoesNotCreateOutboxEntry() = runTest {
        val store=FaultStore(); val rig=outboxRig(store=store); val fake=FakeVoice(); val v=rig.input(rig.photo(),recorder=fake).voice
        v.start(); v.stop(); val bytes=store.readBytes("a",v.audioKey)
        store.fails={key,_->key==v.key}; v.send(); assertNotNull(v.state.value.clip); assertTrue(fake.files.isNotEmpty())
        assertArrayEquals(bytes,store.readBytes("a",v.audioKey)); assertTrue(rig.box.dependents(v.mediaId).isEmpty())
        store.fails={_,_->false}; v.send(); assertEquals(1,rig.box.dependents(v.mediaId).size)
    }
    @Test fun successfulEnqueueBeforeOperationMetadataFailureRestoresWithoutDuplicate() = runTest {
        val store=FaultStore(); val rig=outboxRig(store=store); val fake=FakeVoice(); val input=rig.input(rig.photo(),recorder=fake); val v=input.voice
        v.start(); v.stop()
        store.fails={key,bytes->key==v.key && Json.decodeObject(bytes.toString(Charsets.UTF_8))["clientOperationId"]!=null}
        v.send(); assertEquals(1,rig.box.dependents(v.mediaId).size); assertNotNull(v.state.value.clip)
        store.fails={_,_->false}; input.close(); val restored=rig.input(fromId(rig,v.mediaId),recorder=fake).voice
        assertNull(restored.state.value.clip); assertEquals(1,rig.box.dependents(v.mediaId).size)
        assertEquals("이미 저장한 녹음은 사진 상세에서 확인할 수 있습니다.",restored.state.value.notice)
    }
    private fun fromId(rig: OutboxRig,id: String)=requireNotNull(rig.box.entry(id))
    @Test fun rerecordAndCancelDeleteOnlyDraftAndNeverUpload() = runTest {
        val rig=outboxRig(); val fake=FakeVoice(); val v=rig.input(rig.photo(),recorder=fake).voice
        v.start(); v.stop(); val first=v.state.value.clip!!.path; v.rerecord()
        assertFalse(fake.files.containsKey(first)); assertTrue(v.state.value.recording); v.discard()
        assertNull(rig.store.read("a",v.key)); assertTrue(rig.box.dependents(v.mediaId).isEmpty())
    }
    @Test fun oversizeAudioIsNotEnqueuedAndOriginalFileIsKept() = runTest {
        val rig=outboxRig(); val fake=FakeVoice().apply { byteCount=maxVoiceBytes+1 }; val v=rig.input(rig.photo(),recorder=fake).voice
        v.start(); v.stop(); v.send(); assertNotNull(v.state.value.error); assertNotNull(v.state.value.clip)
        assertTrue(fake.files.isNotEmpty()); assertTrue(rig.box.dependents(v.mediaId).isEmpty())
    }
    @Test fun mockRecorderHonorsThreeMinuteLimitAndPlaybackEventWithoutMicrophone() = runTest {
        val recorder=MockVoiceRecorder(backgroundScope){testScheduler.currentTime}; val events=mutableListOf<JsonObject>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { recorder.events.toList(events) }
        recorder.startDraft("[a,photo]"); advanceTimeBy(180001); runCurrent()
        val clip=recorder.stop()!!; assertEquals(180000,clip.durationMs); assertEquals("maxDuration",events.single()["reason"])
        assertEquals(clip,recorder.recoverDraft("[a,photo]")); assertNull(recorder.recoverDraft("[b,photo]"))
        recorder.play(recorder.read(clip.path)); advanceTimeBy(180001); runCurrent(); assertEquals("playbackStopped",events.last()["type"])
        recorder.cancel(clip.path); assertNull(recorder.recoverDraft("[a,photo]")); recorder.close()
    }
    @Test fun latePreviewReadCannotRestartPlaybackAfterBackgroundPause() = runTest {
        val rig=outboxRig(); val fake=FakeVoice(); val v=rig.input(rig.photo(),recorder=fake).voice
        v.start(); fake.readFailure=IllegalStateException("일시 읽기 실패"); v.stop()
        fake.readFailure=null; fake.readGate=CompletableDeferred()
        val play=launch { v.preview() }; runCurrent(); assertTrue(v.state.value.working)
        val pause=launch { v.pause() }; runCurrent(); fake.readGate!!.complete(Unit)
        play.join(); pause.join(); assertEquals(0,fake.plays); assertFalse(v.state.value.playing)
        assertNotNull(v.state.value.clip)
    }
    @Test fun recordingMetadataAndElapsedTimeKeepOriginalFormat() {
        assertEquals("0:00",voiceTime(0)); assertEquals("1:01",voiceTime(61999)); assertEquals("3:00",voiceTime(maxVoiceDurationMs))
        val clip=VoiceRecording("voice-a.m4a",61999,42,"background")
        assertEquals(clip,VoiceRecording.fromJson(Json.decodeObject(Json.encode(clip.toJson()))))
    }
    @Test fun truncatedAdtsTailIsExcludedWithoutThrowingAwayCompletedFrames() {
        fun frame(length: Int)=ByteArray(length).apply { this[0]=0xff.toByte(); this[1]=0xf1.toByte(); this[3]=((length shr 11) and 3).toByte(); this[4]=(length shr 3).toByte(); this[5]=((length and 7) shl 5).toByte() }
        val a=frame(12); val b=frame(19)
        assertEquals(31,completeAdtsLength(a+b)); assertEquals(12,completeAdtsLength(a+b.copyOf(10)))
        assertEquals(0,completeAdtsLength(a.copyOf(6))); assertEquals(0,completeAdtsLength(ByteArray(12)))
    }
}

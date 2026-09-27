package com.vitalguard.field

// Port: record_editor_ink_test.dart / hold_bundle_ui_test.dart의 상태·저장·복구 경계.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.contracts.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class FakeInkRenderer(var size: InkSize = InkSize(1000.0,1000.0)) : InkRenderer {
    var calls = 0
    var dimensionsGate: CompletableDeferred<Unit>? = null
    var gate: CompletableDeferred<Unit>? = null
    var failure: Exception? = null
    override suspend fun dimensions(bytes: ByteArray): InkSize { dimensionsGate?.await(); return size }
    override suspend fun render(bytes: ByteArray, strokes: List<InkStroke>): ByteArray {
        calls++; gate?.await(); failure?.let { throw it }; return byteArrayOf(1,2,3)
    }
}
suspend fun OutboxRig.editor(photo: OutboxEntry, renderer: FakeInkRenderer = FakeInkRenderer()): InkEditorController =
    InkEditorController(field,box,fromOutbox(photo),"a",renderer,scope).also { it.load(); it.viewport(InkSize(1000.0,1000.0),1.0) }
fun InkEditorController.stroke(y: Double = 500.0, id: Long = 1) { penDown(id,InkOffset(100.0,y),.5); penMove(id,InkOffset(900.0,y),.5); penUp(id) }
@OptIn(ExperimentalCoroutinesApi::class)
class InkEditorTest {
    @Test fun touchOnlyPansAndPinchesWithoutInkAndClampsWithoutDrift() = runTest {
        val rig=outboxRig(); val e=rig.editor(rig.photo()); assertFalse(e.state.value.canSave)
        e.touchDown(1,InkOffset(100.0,200.0)); e.touchMove(1,InkOffset(130.0,240.0)); e.touchEnd(1)
        assertEquals(InkOffset(30.0,40.0),e.state.value.pan); assertTrue(e.state.value.strokes.isEmpty())
        e.toggleFit(); e.touchDown(1,InkOffset(400.0,500.0)); e.touchDown(2,InkOffset(600.0,500.0))
        e.touchMove(1,InkOffset(0.0,500.0)); e.touchMove(2,InkOffset(1000.0,500.0)); assertEquals(4.0,e.state.value.zoom,0.0)
        e.touchMove(1,InkOffset(50.0,500.0)); e.touchMove(2,InkOffset(1050.0,500.0)); assertEquals(4.0,e.state.value.zoom,0.0)
        e.touchEnd(1); val before=e.state.value.pan; e.touchMove(2,InkOffset(1060.0,500.0)); assertEquals(before.x+10,e.state.value.pan.x,.001)
        assertTrue(e.state.value.strokes.isEmpty())
    }
    @Test fun penTakesPriorityAndIgnoresPalmUntilLifted() = runTest {
        val rig=outboxRig(); val e=rig.editor(rig.photo())
        e.touchDown(2,InkOffset(200.0,200.0)); e.penDown(1,InkOffset(100.0,500.0),.5)
        e.touchMove(2,InkOffset(250.0,250.0)); e.touchDown(3,InkOffset(300.0,300.0))
        e.penMove(1,InkOffset(900.0,500.0),.6); e.penUp(1); e.touchMove(2,InkOffset(500.0,500.0))
        assertEquals(InkOffset(),e.state.value.pan); assertEquals(1,e.state.value.strokes.size)
        e.touchEnd(2); e.touchDown(2,InkOffset(200.0,200.0)); e.touchMove(2,InkOffset(250.0,250.0)); assertEquals(InkOffset(50.0,50.0),e.state.value.pan)
    }
    @Test fun cancelledPenIsRemovedFromMemoryAndImmediateDraftSnapshot() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val e=rig.editor(photo)
        e.penDown(1,InkOffset(100.0,500.0),.5); e.penMove(1,InkOffset(900.0,500.0),.5); e.persist().await()
        assertEquals(1,(Json.decodeObject(rig.store.read("a",e.draftKey)!!)["strokes"] as List<*>).size)
        e.penCancel(1); e.persist().await()
        assertTrue(e.state.value.strokes.isEmpty()); assertFalse(e.state.value.dirty)
        assertTrue((Json.decodeObject(rig.store.read("a",e.draftKey)!!)["strokes"] as List<*>).isEmpty())
    }
    @Test fun unfinishedInkIsRecoverableWithoutLifecycleAndRotationCommitsBeforeLateCancel() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val e=rig.editor(photo)
        e.penDown(1,InkOffset(100.0,500.0),.5); e.penMove(1,InkOffset(900.0,500.0),.5); e.persist().await()
        val recovered=rig.editor(photo); assertEquals(1,recovered.state.value.strokes.size); assertTrue(recovered.state.value.dirty)
        e.viewport(InkSize(700.0,1000.0),1.0); e.cancelPointers(); e.persist().await()
        assertEquals(recovered.state.value.strokes,e.state.value.strokes)
        recovered.undo(); assertTrue(recovered.state.value.strokes.isEmpty())
    }
    @Test fun cancelledEraserDoesNotDeleteButCompletedEraserIsOneUndoOperation() = runTest {
        val rig=outboxRig(); val e=rig.editor(rig.photo()); e.stroke(300.0); e.stroke(600.0)
        e.selectTool(InkTool.eraser); e.penDown(1,InkOffset(500.0,200.0),1.0); e.penMove(1,InkOffset(500.0,700.0),1.0)
        assertTrue(e.state.value.visibleStrokes.isEmpty()); e.penCancel(1); assertEquals(2,e.state.value.strokes.size)
        e.penDown(1,InkOffset(500.0,200.0),1.0); e.penMove(1,InkOffset(500.0,700.0),1.0); e.penUp(1)
        assertTrue(e.state.value.strokes.isEmpty()); e.undo(); assertEquals(2,e.state.value.strokes.size)
    }
    @Test fun widthMultipliersArePerToolAndExistingStrokesNeverChange() = runTest {
        val rig=outboxRig(); val e=rig.editor(rig.photo())
        for (width in listOf(.5,1.0,2.0)) { e.selectWidth(width); e.stroke() }
        assertEquals(listOf(.002,.004,.008),e.state.value.strokes.map { it.width })
        e.selectTool(InkTool.marker); e.stroke(); assertEquals(.036,e.state.value.strokes.last().width,0.0)
        e.toggleOriginal(); val before=e.state.value.strokes; e.stroke(); assertEquals(before,e.state.value.strokes)
        e.toggleFit(); assertEquals(1.0,e.state.value.zoom,0.0); assertEquals(before,e.state.value.strokes)
    }
    @Test fun samePointAndSubPixelMoveAreDroppedButDotIsSaved() = runTest {
        val rig=outboxRig(); val e=rig.editor(rig.photo())
        e.penDown(1,InkOffset(100.0,500.0),.5); e.penMove(1,InkOffset(100.2,500.2),.5); e.penUp(1)
        assertEquals(1,e.state.value.strokes.single().points.size)
    }
    @Test fun saveQueuesInkAndOriginalPreviewWithoutHttpAndReplacesOldRevision() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val renderer=FakeInkRenderer(); val e=rig.editor(photo,renderer)
        e.stroke(); assertTrue(e.save()); val first=rig.box.dependents(photo.id).single()
        assertEquals(OutboxKind.ink,first.kind); assertEquals(photo.id,first.annotationDraftId)
        assertEquals("annotation:${photo.id}:1",first.sourceKey); assertEquals(listOf(e.draftKey),first.draftKeys)
        assertArrayEquals(byteArrayOf(1,2,3),rig.store.readBytes("a","outbox-preview:${first.id}"))
        assertTrue(rig.gateway.writes.isEmpty()); assertNull(rig.store.read("a",recordSessionKey))
        e.clearAll(); assertTrue(e.save()); val next=rig.box.dependents(photo.id).single()
        assertNotEquals(first.id,next.id); assertFalse(e.state.value.canSave)
        assertTrue((Json.decodeObject(rig.store.readBytes("a",next.bytesKey)!!.toString(Charsets.UTF_8))["strokes"] as List<*>).isEmpty())
        assertNotNull(rig.store.read("a",e.draftKey))
    }
    @Test fun oversizedInkKeepsDraftAndDoesNotRenderOrEnqueue() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val key="annotation:${photo.id}"
        val many=InkStroke(InkTool.pen,0xFFDC2626,.004,List(100_000) { InkPoint(.1234567890123,.9876543210123,.7777777777) })
        rig.store.write("a",key,Json.encode(mapOf("strokes" to listOf(many.toJson()),"dirty" to true,"revision" to 1)))
        val renderer=FakeInkRenderer(); val e=rig.editor(photo,renderer)
        assertFalse(e.save()); assertTrue(e.state.value.error!!.contains("2,097,152")); assertEquals(0,renderer.calls)
        assertTrue(rig.box.dependents(photo.id).isEmpty()); assertNotNull(rig.store.read("a",key))
    }
    @Test fun previousUncertainOrSendingInkBlocksReplacementButCompletedInkAllowsAnAddition() = runTest {
        for (phase in listOf(OutboxPhase.uncertain,OutboxPhase.completed,OutboxPhase.sending)) {
            val rig=outboxRig(); val photo=rig.photo(); val child=rig.box.enqueue(OutboxKind.ink,byteArrayOf(1),emptyMap(),photo.siteName,dependsOn=photo.id)
            rig.restore(listOf(photo,child.copy(phase=phase)))
            val e=rig.editor(photo); e.stroke()
            if (phase == OutboxPhase.completed) {
                assertTrue(e.save()); assertEquals(2, rig.box.dependents(photo.id).size)
                assertEquals(OutboxPhase.completed, rig.box.entry(child.id)!!.phase)
            } else { assertFalse(e.save()); assertTrue(e.state.value.error!!.contains("이전 주석의 전송 상태")) }
        }
    }
    @Test fun renderFailureOrAccountChangeKeepsDraftAndPreventsReplacement() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val renderer=FakeInkRenderer(); val e=rig.editor(photo,renderer); e.stroke()
        renderer.failure=IllegalStateException("렌더 실패"); assertFalse(e.save()); assertTrue(rig.box.dependents(photo.id).isEmpty())
        assertNotNull(rig.store.read("a",e.draftKey))
        renderer.failure=null; renderer.gate=CompletableDeferred(); val save=async { e.save() }; runCurrent()
        rig.field.signOut(); rig.field.signIn("b","mock"); renderer.gate!!.complete(Unit)
        assertFalse(save.await()); assertNotNull(rig.store.read("a",e.draftKey))
    }
    @Test fun leavingDuringImageDecodeCannotRecreateClosedSession() = runTest {
        val rig=outboxRig(); val photo=rig.photo(); val renderer=FakeInkRenderer().apply { dimensionsGate=CompletableDeferred() }
        val e=InkEditorController(rig.field,rig.box,fromOutbox(photo),"a",renderer,backgroundScope)
        val loading=launch { e.load() }; runCurrent(); assertTrue(e.leave()); e.close()
        renderer.dimensionsGate!!.complete(Unit); loading.join()
        assertNull(rig.store.read("a",recordSessionKey)); assertNull(rig.store.read("a",e.draftKey))
    }
    @Test fun failedBackPreservesStateAndCanRetry() = runTest {
        val store=FaultStore(); val rig=outboxRig(store=store); val e=rig.editor(rig.photo()); e.stroke()
        store.fails={key,_->key==e.draftKey}; assertFalse(e.leave()); assertEquals(1,e.state.value.strokes.size)
        store.fails={_,_->false}; assertTrue(e.leave()); assertNull(store.read("a",recordSessionKey))
    }
}

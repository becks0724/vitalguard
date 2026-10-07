@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

private class TestCommentPlayer : CommentAudioPlayer {
    val completions = mutableListOf<(String?) -> Unit>()
    var stops = 0
    override suspend fun play(bytes: ByteArray, onStopped: (String?) -> Unit) { completions += onStopped }
    override fun stop() { stops++ }
}
class CommentPlaybackTest {
    private fun voice(id: String) = MediaComment(mapOf("id" to id, "audio_storage_key" to "audio/$id", "audio_url" to "https://unit.invalid/$id"))
    @Test fun voiceDownload401OnlyDisablesThatCommentAndLeavesSessionUntouched() = runTest {
        val gateway = object : OutboxGateway() {
            override suspend fun calendarVoice(comment: MediaComment): ByteArray = throw ApiFailure("expired URL", status = 401)
        }
        val rig = outboxRig(gateway); val player = TestCommentPlayer()
        val playback = CommentPlaybackController(rig.field, player, backgroundScope)
        val before = rig.field.state.value
        playback.toggle(voice("voice-1")); runCurrent()
        assertEquals(mapOf("voice-1" to auxiliaryAccessDenied), playback.state.value.errors)
        assertNull(playback.state.value.activeId); assertFalse(playback.state.value.loading)
        assertTrue(player.completions.isEmpty()); assertEquals(before, rig.field.state.value); assertEquals(0, gateway.refreshes)
        playback.close()
    }
    @Test fun onlyOneCommentPlaysAndLateCompletionCannotStopTheNextOne() = runTest {
        val gateway = object : OutboxGateway() {
            override suspend fun calendarVoice(comment: MediaComment) = byteArrayOf(1)
        }
        val rig = outboxRig(gateway); val player = TestCommentPlayer()
        val playback = CommentPlaybackController(rig.field, player, backgroundScope)
        playback.toggle(voice("one")); runCurrent(); playback.toggle(voice("two")); runCurrent()
        assertEquals(2, player.completions.size); player.completions.first()(null)
        assertEquals("two", playback.state.value.activeId)
        player.completions.last()(null); assertNull(playback.state.value.activeId)
        playback.toggle(voice("two")); runCurrent(); playback.toggle(voice("two"))
        assertNull(playback.state.value.activeId); playback.close()
    }
    @Test fun leavingDetailCancelsPendingDownloadWithoutPlayingItLater() = runTest {
        val gate = CompletableDeferred<ByteArray>()
        val gateway = object : OutboxGateway() {
            override suspend fun calendarVoice(comment: MediaComment) = withContext(NonCancellable) { gate.await() }
        }
        val rig = outboxRig(gateway); val player = TestCommentPlayer()
        val playback = CommentPlaybackController(rig.field, player, backgroundScope)
        playback.toggle(voice("one")); runCurrent(); assertTrue(playback.state.value.loading)
        playback.close(); gate.complete(byteArrayOf(1)); runCurrent()
        assertTrue(player.completions.isEmpty()); assertNull(playback.state.value.activeId)
    }
}

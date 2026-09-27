@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.RecordCalendarController
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.data.mock.MemoryStore
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

/** 2d: 부수 조회의 인증 오류는 해당 항목에만 남는다. 실제 조정자와 달력 상태를 통과한다. */
class AuxiliaryAuthorizationTest {
    @Test fun siteInfoDenialAfterLoginOrMeNeverRollsBackAcceptedSession() = runTest {
        for (restore in listOf(false, true)) for (status in listOf(401, 403)) {
            val gateway = ScriptedGateway().apply { onSite = { throw ApiFailure("인증 필요", status = status, action = "reauth") } }
            val store = if (restore) savedStore() else MemoryStore()
            val field = FieldCoordinator(gateway, store, backgroundScope, MutableClock())
            if (restore) field.initialize() else field.signIn("saved-account", "synthetic")
            assertEquals(AuthStage.ready, field.state.value.authStage); assertNotNull(store.tokens)
            assertNull(field.state.value.site); assertEquals(auxiliaryAccessDenied, field.state.value.message)
            assertFalse(gateway.calls.contains("refresh"))
        }
    }

    @Test fun everyRequiredWriteLocksOn401IncludingActionNoneWithoutRepeatingTheWrite() = runTest {
        for (path in listOf("photo", "text", "voice", "delete", "ack")) for (action in listOf("none", "reauth")) {
            var attempts = 0
            fun rejected(): Nothing { attempts++; throw ApiFailure("인증 필요", status = 401, action = action) }
            val gateway = object : OutboxGateway() {
                override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia = rejected()
                override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?): MediaComment = rejected()
                override suspend fun voiceComment(token: String, mediaId: String, audio: ByteArray, durationMs: Int?, clientOperationId: String?, siteId: String?): MediaComment = rejected()
                override suspend fun deleteCalendarMedia(token: String, id: String): Unit = rejected()
                override suspend fun ackAlert(accessToken: String, id: String): Boolean = rejected()
            }
            val rig = outboxRig(gateway)
            var locks = 0; rig.field.beforeLock = { locks++ }
            failure {
                when (path) {
                    "photo" -> rig.field.publish(PHOTO_BYTES, PHOTO_FIELDS)
                    "text" -> rig.field.comment("photo", "메모", "operation")
                    "voice" -> rig.field.voiceComment("photo", byteArrayOf(1), 7744, "operation")
                    "delete" -> rig.field.deleteCalendarMedia("photo")
                    else -> rig.field.ackAlert("alert")
                }
            }
            assertEquals(AuthStage.reauthenticate, rig.field.state.value.authStage); assertNull(rig.store.tokens)
            assertEquals(1, attempts); assertEquals(1, locks); assertEquals(0, gateway.refreshes)
        }
    }

    @Test fun photoUnauthorizedNeverRefreshesOrLocksEvenWithReauthAction() = runTest {
        for (status in listOf(401, 403)) for (action in listOf(null, "none", "reauth")) {
            val gateway = object : OutboxGateway() {
                override suspend fun calendarPhoto(token: String, id: String): ByteArray =
                    throw ApiFailure("인증 필요", status = status, action = action)
            }
            val rig = outboxRig(gateway)
            val before = rig.field.state.value
            val tokens = rig.store.tokens
            var locks = 0; rig.field.beforeLock = { locks++ }
            val error = failure { rig.field.photoBytes(CalendarMedia(mapOf("id" to "remote", "date_key" to "2026-09-27"))) }
            assertEquals("권한 없음 · 다시 로그인하면 다시 시도합니다", error.message)
            assertEquals(status, error.status); assertEquals(before, rig.field.state.value)
            assertEquals(tokens, rig.store.tokens); assertEquals(0, locks); assertEquals(0, gateway.refreshes)
        }
    }

    @Test fun calendarUnauthorizedChangesOnlyCalendarErrorAndCanRetryAfterLogin() = runTest {
        var rejected = true
        val gateway = object : OutboxGateway() {
            override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> {
                if (rejected) throw ApiFailure("인증 필요", status = 401, action = "reauth")
                return listOf(CalendarMedia(mapOf("id" to "remote", "date_key" to from)))
            }
        }
        val rig = outboxRig(gateway)
        val calendar = RecordCalendarController(rig.field, rig.box, backgroundScope, rig.clock)
        calendar.bindAccount("a"); calendar.setVisible(true); runCurrent()
        assertEquals(AuthStage.ready, rig.field.state.value.authStage)
        assertEquals("권한 없음 · 다시 로그인하면 다시 시도합니다", calendar.state.value.error)
        assertFalse(calendar.state.value.loaded); assertFalse(calendar.state.value.loading)
        assertEquals(0, gateway.refreshes); assertNotNull(rig.store.tokens)
        rig.field.signOut(); calendar.bindAccount(null)
        rig.field.signIn("a", "mock"); rejected = false; calendar.bindAccount("a"); runCurrent()
        assertNull(calendar.state.value.error); assertEquals("remote", calendar.state.value.server.single().id)
        calendar.close()
    }
}

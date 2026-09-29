package com.vitalguard.field

import com.vitalguard.field.data.profile.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MemberProfileTest {
    private fun profile(id: String = "a") = MemberProfile(id, "모의 사용자", "admin", "모의 시공사", "안전팀", "팀장", "A-1", "010-****-**70", null)
    @Test fun acceptsOnlyFiveVisibleDigitsAndNeverShowsRawOrPartiallyMaskedNumber() {
        assertEquals("010-****-**70", safeMaskedPhone("010-****-**70"))
        for (raw in listOf("01012345670", "010-1234-5670", "010-****-5670", "*", "", "abc010-****-**70", "010-***1-**70")) assertNull(safeMaskedPhone(raw))
        assertNull(safeMaskedPhone(null))
    }
    @Test fun profileDtoIgnoresPhoneOriginalAndUnknownSecrets() {
        val p = MemberProfile.fromJson(mapOf("username" to "a", "phone" to "01012345670", "password" to "not-real", "phoneMasked" to "010-****-**70"))
        assertEquals("010-****-**70", p.phoneMasked)
        assertFalse(p.toString().contains("01012345670")); assertFalse(p.toString().contains("not-real"))
    }
    @Test fun lateProfileCannotLeakIntoAnotherAccount() = runTest {
        val pending = CompletableDeferred<MemberProfile>()
        val g = object : ScriptedGateway() { override suspend fun memberProfile(accessToken: String) = pending.await() }
        val field = FieldCoordinator(g, MemoryStore(), backgroundScope, MutableClock());field.signIn("a", "pw")
        val c = MemberProfileController(field, backgroundScope);runCurrent();c.open();runCurrent()
        field.signIn("b", "pw");runCurrent();pending.complete(profile("a"));runCurrent()
        assertFalse(c.state.value.visible);assertNull(c.state.value.profile)
    }
    @Test fun wrongSubjectIsRejectedAndAuxiliaryFailureDoesNotLogOut() = runTest {
        var wrongSubject = true
        val g = object : ScriptedGateway() {
            override suspend fun memberProfile(accessToken: String): MemberProfile {
                if (wrongSubject) return profile("someone-else")
                throw ApiFailure("denied", status = 403, action = "reauth")
            }
        }
        val field = FieldCoordinator(g, MemoryStore(), backgroundScope, MutableClock());field.signIn("a", "pw")
        val c = MemberProfileController(field, backgroundScope);runCurrent();c.open();runCurrent()
        assertNull(c.state.value.profile);assertNotNull(c.state.value.error)
        wrongSubject = false;c.refresh();runCurrent();assertEquals(AuthStage.ready, field.state.value.authStage);assertNotNull(c.state.value.error)
    }
}

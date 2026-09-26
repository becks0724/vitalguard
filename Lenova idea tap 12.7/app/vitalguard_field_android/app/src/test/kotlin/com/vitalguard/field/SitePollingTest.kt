@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
package com.vitalguard.field

// Port: site_screen_test.dart의 활성 60초·stale·403·수동/전경 복귀·비중첩 사례.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import com.vitalguard.field.ui.site.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class SitePollingTest {
    @Test fun pollsOnlyVisibleForegroundAndResumeRefreshesSiteBeforeStatus() = runTest {
        val gateway = ScriptedGateway()
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        val page = SiteSummaryController(c, backgroundScope, MutableClock())
        page.setForeground(true)
        advanceTimeBy(120000); runCurrent(); assertEquals(0, gateway.calls.count { it == "status" })
        page.setVisible(true); runCurrent(); assertEquals(1, gateway.calls.count { it == "status" })
        advanceTimeBy(60000); runCurrent(); assertEquals(2, gateway.calls.count { it == "status" })
        page.setForeground(false); advanceTimeBy(120000); runCurrent()
        assertEquals(2, gateway.calls.count { it == "status" })
        val site = CompletableDeferred<SiteInfo?>()
        gateway.onSite = { site.await() }
        page.setForeground(true); runCurrent()
        assertTrue(page.state.value.loading); assertEquals("site", gateway.calls.last())
        assertEquals(2, gateway.calls.count { it == "status" })
        site.complete(SiteInfo(mapOf("site_name" to "복귀 후 현장"))); runCurrent()
        assertEquals(3, gateway.calls.count { it == "status" }); assertEquals("복귀 후 현장", c.state.value.site?.site_name)
        page.setVisible(false); advanceTimeBy(120000); runCurrent()
        assertEquals(3, gateway.calls.count { it == "status" }); page.close()
    }
    @Test fun forbiddenStopsPollingAndTabReentryUntilManualRecovery() = runTest {
        val gateway = ScriptedGateway().apply { onStatus = { throw ApiFailure("private", status = 403) } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        val page = SiteSummaryController(c, backgroundScope, MutableClock())
        page.setVisible(true); page.setForeground(true); runCurrent()
        assertTrue(page.state.value.forbidden); assertNull(page.state.value.data); assertFalse(page.state.value.loading)
        advanceTimeBy(600000); runCurrent(); page.setVisible(false); page.setVisible(true); runCurrent()
        assertEquals(1, gateway.calls.count { it == "status" })
        page.manualRefresh(); runCurrent(); assertEquals(2, gateway.calls.count { it == "status" })
        advanceTimeBy(60000); runCurrent(); assertEquals(2, gateway.calls.count { it == "status" })
        gateway.onStatus = { SiteStatus(siteStatusReply()) }
        val sites = gateway.calls.count { it == "site" }
        page.manualRefresh(); runCurrent()
        assertFalse(page.state.value.forbidden); assertNotNull(page.state.value.data)
        assertEquals(3, gateway.calls.count { it == "status" }); assertEquals(sites + 1, gateway.calls.count { it == "site" })
        advanceTimeBy(60000); runCurrent(); assertEquals(4, gateway.calls.count { it == "status" })
        page.close()
    }
    @Test fun foregroundReturnCanRecover403AndSiteFailureDoesNotSuppressStatus() = runTest {
        val gateway = ScriptedGateway().apply { onStatus = { throw ApiFailure("private", status = 403) } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        val page = SiteSummaryController(c, backgroundScope, MutableClock())
        page.setVisible(true); page.setForeground(true); runCurrent()
        val previous = c.state.value.site
        page.setForeground(false)
        gateway.onSite = { throw ApiFailure("연결 실패") }
        gateway.onStatus = { SiteStatus(siteStatusReply()) }
        page.setForeground(true); runCurrent()
        assertFalse(page.state.value.forbidden); assertFalse(page.state.value.failed)
        assertSame(previous, c.state.value.site); assertEquals(2, gateway.calls.count { it == "status" })
        page.close()
    }
    @Test fun staleDataSurvivesSlowAndFailedRefreshAndRequestsNeverOverlap() = runTest {
        val clock = MutableClock()
        val gateway = ScriptedGateway()
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, clock)
        c.signIn("saved-account", "synthetic")
        val page = SiteSummaryController(c, backgroundScope, clock)
        page.setVisible(true); page.setForeground(true); runCurrent()
        assertFalse(page.state.value.stale)
        val pending = CompletableDeferred<SiteStatus>()
        gateway.onStatus = { pending.await() }
        clock.advance(300); advanceTimeBy(300000); runCurrent()
        assertEquals(2, gateway.calls.count { it == "status" })
        assertTrue(page.state.value.loading); assertTrue(page.state.value.stale)
        assertEquals("마지막 수신 2026-09-15 00:13:04 KST", siteStatusReceipt(page.state.value.data?.fetchedAt))
        pending.completeExceptionally(ApiFailure("private")); runCurrent()
        assertTrue(page.state.value.failed); assertNotNull(page.state.value.data)
        gateway.onStatus = { SiteStatus(siteStatusReply() + ("fetchedAt" to clock.instant().toString())) }
        page.manualRefresh(); runCurrent()
        assertFalse(page.state.value.stale); assertFalse(page.state.value.failed); page.close()
    }
    @Test fun firstFailureAnd401NeverKeepMisleadingZeroOrOldSnapshot() = runTest {
        val gateway = ScriptedGateway().apply { onStatus = { throw ApiFailure("private") } }
        val c = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock())
        c.signIn("saved-account", "synthetic")
        val page = SiteSummaryController(c, backgroundScope, MutableClock())
        page.setVisible(true); page.setForeground(true); runCurrent()
        assertNull(page.state.value.data); assertTrue(page.state.value.failed)
        gateway.onStatus = { SiteStatus(siteStatusReply()) }
        page.manualRefresh(); runCurrent(); assertNotNull(page.state.value.data)
        gateway.onStatus = { throw ApiFailure("private", status = 401, action = "none") }
        page.manualRefresh(); runCurrent()
        assertNull(page.state.value.data); assertFalse(page.state.value.forbidden); page.close()
    }
}

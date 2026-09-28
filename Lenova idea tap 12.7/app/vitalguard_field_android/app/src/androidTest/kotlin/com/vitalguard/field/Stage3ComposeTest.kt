package com.vitalguard.field

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.session.FieldCoordinator
import org.junit.*
import org.junit.Assert.*
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class Stage3ComposeTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var field: FieldCoordinator
    private lateinit var model: FieldViewModel
    private var acknowledged = false
    private var writes = 0
    @Volatile private var tickets = 0
    private val eventTime = "2026-09-27T06:00:00Z"
    private val graph = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.captureEnabledForTests = false
            app.internetProbeForTests = InternetProbe { false }
            app.controllerFactoryForTests = { scope -> FieldCoordinator(object : MockGateway() {
                override suspend fun siteStatus(accessToken: String) = stage3SampleStatus(eventTime, acknowledged)
                override suspend fun ackAlert(accessToken: String, id: String): Boolean { assertEquals("42", id); writes++; acknowledged = true; return true }
                override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket {
                    assertTrue(cameraId in CCTV_CAMERAS); tickets++
                    return CctvTicket(mapOf("ok" to true, "ticket" to "synthetic-$tickets", "expiresAt" to System.currentTimeMillis() + 60_000,
                        "ttlSec" to 60, "gateApi" to "https://camera.example"))
                }
            }, MemoryStore(), scope).also { field = it } }
            val image = Bitmap.createBitmap(96, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLUE) }
            val png = ByteArrayOutputStream().use { output -> image.compress(Bitmap.CompressFormat.PNG, 100, output); output.toByteArray() }
            image.recycle()
            app.cctvFramesForTests = object : CctvFrames { override suspend fun fetch(ticket: CctvTicket) = png }
        }
        override fun after() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.controllerFactoryForTests = null; app.internetProbeForTests = null; app.captureEnabledForTests = null; app.cctvFramesForTests = null
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)
    private fun login() {
        compose.waitUntil(5000) { field.state.value.authStage == AuthStage.login }
        compose.onNodeWithTag("login-id").performScrollTo().performTextInput("stage3")
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5000) { field.state.value.siteStatusSnapshot != null }
        compose.runOnIdle { model = ViewModelProvider(compose.activity)[FieldViewModel::class.java] }
    }
    @Test fun siteDetailsShowServerValuesAndAedAlertDoesNotReuseMaintenanceData() {
        login()
        compose.onNodeWithTag("site-row-weather").performScrollTo().performClick()
        compose.onNodeWithTag("weather-detail-scroll").performScrollToNode(hasText("풍속 10.0 m/s"))
        compose.onNodeWithText("풍속 10.0 m/s").assertIsDisplayed()
        compose.onNodeWithTag("weather-detail-scroll").performScrollToNode(hasTestTag("weather-back"))
        compose.onNodeWithTag("weather-back").assertContentDescriptionEquals("이전").assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithTag("site-row-workers").performScrollTo().performClick()
        compose.onNodeWithTag("workers-detail-scroll").performScrollToNode(hasTestTag("workers-filter-stale"))
        compose.onNodeWithTag("workers-filter-stale").performClick()
        compose.onNodeWithTag("workers-detail-scroll").performScrollToNode(hasTestTag("worker-card-mock-b"))
        compose.onNodeWithTag("worker-card-mock-b").assertExists()
        compose.onNodeWithText("심박 145", substring = true).assertDoesNotExist()
        compose.onNodeWithText("35.0", substring = true).assertDoesNotExist()
        Espresso.pressBack()
        compose.onNodeWithTag("site-row-gas").performScrollTo().performClick()
        compose.onNodeWithTag("gas-detail-scroll").performScrollToNode(hasTestTag("gas-value-co"))
        compose.onNodeWithTag("gas-value-co").assertTextEquals("단위 미수신")
        Espresso.pressBack()
        compose.onNodeWithTag("site-row-aed-alert").performScrollTo().assertHasNoClickAction()
        compose.onNodeWithTag("aed-alert-pending").assertTextEquals("연동 대기")
        compose.onNodeWithTag("site-row-aed").assertDoesNotExist()
        compose.onNodeWithText("배터리 교환 2일 지남").assertDoesNotExist()
    }
    @Test fun openingAlertDoesNotWriteAndExplicitAckIsOnlyOnce() {
        login(); compose.onNodeWithTag("rail-destination-1").performScrollTo().performClick()
        compose.onNodeWithTag("alert-row-42").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, writes) }
        compose.onNodeWithTag("alert-ack").performScrollTo().performClick()
        compose.waitUntil(5000) { acknowledged && model.alerts.state.value.items.singleOrNull()?.acknowledged == true }
        compose.onNodeWithTag("alert-ack").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(1, writes) }
    }
    @Test fun stripDefersDuringEditingWithoutMovingTheReservedSlotAndDismissNeverWrites() {
        login()
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        compose.onNodeWithTag("global-alert-strip").assertExists()
        val height = compose.onNodeWithTag("global-alert-slot").fetchSemanticsNode().boundsInRoot.height
        val contentHeight = compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot.height
        assertTrue(height > 0)
        compose.runOnIdle { model.shell.editorOpen(true) }
        compose.onNodeWithTag("global-alert-strip").assertDoesNotExist()
        assertEquals(height, compose.onNodeWithTag("global-alert-slot").fetchSemanticsNode().boundsInRoot.height, .1f)
        compose.runOnIdle { model.shell.editorOpen(false) }
        compose.onNodeWithTag("global-alert-dismiss").performClick()
        compose.onNodeWithTag("global-alert-strip").assertDoesNotExist()
        compose.onNodeWithTag("global-alert-slot").assertHeightIsEqualTo(0.dp)
        assertEquals(contentHeight + height, compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot.height, 1f)
        compose.runOnIdle { assertEquals(0, writes); assertFalse(acknowledged) }
        compose.runOnIdle { model.shell.editorOpen(true) }
        assertEquals(height, compose.onNodeWithTag("global-alert-slot").fetchSemanticsNode().boundsInRoot.height, .1f)
    }
    @Test fun cctvShowsFramesRefreshesWithNewTicketsAndStopsAfterBack() {
        login(); compose.onNodeWithTag("site-open-cctv").performScrollTo().performClick()
        compose.onNodeWithTag("cctv-picker-CAM-03").performClick()
        compose.waitUntil(5000) { model.cctv.state.value.bytes != null }
        compose.onNodeWithTag("cctv-image").assertIsDisplayed()
        val imageBounds = compose.onNodeWithTag("cctv-image").fetchSemanticsNode().boundsInRoot
        val viewport = compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot
        assertTrue(imageBounds.top >= viewport.top && imageBounds.bottom <= viewport.bottom)
        assertTrue(imageBounds.left >= viewport.left && imageBounds.right <= viewport.right)
        compose.onNodeWithTag("cctv-retry").assertDoesNotExist()
        assertTrue(imageBounds.height > viewport.height * .65f)
        compose.onNodeWithTag("cctv-image").performClick()
        compose.onNodeWithTag("cctv-zoom-overlay").assertIsDisplayed()
        compose.onNodeWithTag("cctv-zoom-gesture").performTouchInput {
            val y = center.y
            down(0, androidx.compose.ui.geometry.Offset(center.x - 40f, y))
            down(1, androidx.compose.ui.geometry.Offset(center.x + 40f, y))
            moveTo(0, androidx.compose.ui.geometry.Offset(center.x - 160f, y), delayMillis = 100)
            moveTo(1, androidx.compose.ui.geometry.Offset(center.x + 160f, y), delayMillis = 100)
            up(0); up(1)
        }
        val zoom = compose.onNodeWithTag("cctv-zoom-gesture").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]
        assertTrue(zoom.removeSuffix("%").toInt() > 100)
        compose.onNodeWithTag("cctv-zoom-reset").performClick()
        compose.onNodeWithTag("cctv-zoom-gesture").assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, "100%"))
        compose.onNodeWithTag("cctv-zoom-close").performClick()
        compose.onNodeWithTag("cctv-camera-CAM-01").performClick()
        compose.waitUntil(5000) { model.cctv.state.value.cameraId == "CAM-01" && model.cctv.state.value.bytes != null }
        compose.onNodeWithTag("cctv-image").assertContentDescriptionEquals("CAM-01 영상 · 눌러서 확대")
        compose.onNodeWithTag("cctv-open-settings").performScrollTo().performClick()
        compose.onNodeWithTag("cctv-period-slider").performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetProgress) { it(2000f) }
        compose.waitUntil(5000) { model.cctv.state.value.periodMillis == 2000 && !model.cctv.state.value.periodSaving }
        val whileSettings = tickets
        android.os.SystemClock.sleep(2500)
        assertEquals(whileSettings, tickets)
        compose.onNodeWithTag("rail-destination-0").performScrollTo().performClick()
        compose.onNodeWithTag("cctv-receipt").assertTextContains("2초", substring = true)
        compose.waitUntil(5000) { tickets >= whileSettings + 2 }
        compose.onNodeWithTag("cctv-back").performScrollTo().assertContentDescriptionEquals("이전").assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithTag("site-signals").assertExists()
        val previous = tickets
        android.os.SystemClock.sleep(2500)
        assertEquals(previous, tickets)
    }
}

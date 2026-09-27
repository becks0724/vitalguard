package com.vitalguard.field

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Stage4ComposeTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var field: FieldCoordinator
    private val local = MemoryStore()
    private val graph = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.captureEnabledForTests = false
            app.controllerFactoryForTests = { scope -> FieldCoordinator(MockGateway(), local, scope).also { field = it } }
        }
        override fun after() {
            val app = ApplicationProvider.getApplicationContext<FieldApplication>()
            app.controllerFactoryForTests = null; app.captureEnabledForTests = null
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)
    private fun login(account: String) {
        compose.waitUntil(5000) { field.state.value.authStage == AuthStage.login }
        compose.onNodeWithTag("login-id").performScrollTo().performTextReplacement(account)
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput("mock")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(5000) { field.state.value.siteStatusSnapshot != null }
    }
    private fun settings() = compose.onNodeWithTag("rail-destination-4").performScrollTo().performClick()
    @Test fun settingsPersistAcrossRecreationAndDoNotLeakToAnotherAccount() {
        login("settings-a"); settings()
        compose.onNodeWithTag("action-side-left").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-a", vgActionSidePreferenceKey) == "left" } }
        compose.activityRule.scenario.recreate()
        settings()
        compose.onNodeWithTag("action-side-left").assertIsSelected()
        compose.runOnIdle { ViewModelProvider(compose.activity)[FieldViewModel::class.java].shell.logout() }
        login("settings-b"); settings()
        compose.onNodeWithTag("action-side-right").assertIsSelected()
        assertEquals("left", runBlocking { local.read("settings-a", vgActionSidePreferenceKey) })
        assertNull(runBlocking { local.read("settings-b", vgActionSidePreferenceKey) })
    }
    @Test fun selectionWorksWhileOfflineAndMovesTheSharedActionPlacement() {
        login("settings-offline"); settings()
        compose.runOnIdle { runBlocking { field.connectivityChanged(false) } }
        compose.onNodeWithTag("action-side-left").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-offline", vgActionSidePreferenceKey) == "left" } }
        compose.onNodeWithTag("action-side-left").assertIsSelected()
        compose.runOnIdle {
            val model = ViewModelProvider(compose.activity)[FieldViewModel::class.java]
            assertTrue(field.state.value.offline)
            assertEquals(ActionSide.left, model.placement.value!!.state.value.side)
        }
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        compose.onNodeWithTag("record-calendar").assertExists()
        val left = compose.onNodeWithTag("record-capture-actions").fetchSemanticsNode().boundsInRoot
        val content = compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot
        assertTrue(left.center.x < content.center.x)
        settings()
        compose.onNodeWithTag("action-side-right").performScrollTo().performClick()
        compose.waitUntil(5000) { runBlocking { local.read("settings-offline", vgActionSidePreferenceKey) == "right" } }
        compose.onNodeWithTag("rail-destination-2").performScrollTo().performClick()
        val right = compose.onNodeWithTag("record-capture-actions").fetchSemanticsNode().boundsInRoot
        assertTrue(right.center.x > content.center.x)
    }
}

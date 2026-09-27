package com.vitalguard.field

// Ports: common_states_test.dart(C-01/C-04), nav_rail_test.dart, settings_test.dart(자리 화면).
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.mockSiteStatusReply
import com.vitalguard.field.ui.auth.*
import com.vitalguard.field.ui.shell.*
import com.vitalguard.field.ui.site.SiteSummaryState
import com.vitalguard.field.ui.theme.VgTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class CommonStatesComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun compactConnectionStatusKeepsFullGuidanceAvailableOnDemand() {
        val field = FieldState(authStage = AuthStage.ready, offline = true,
            site = SiteInfo(mapOf("site_name" to "모의 현장")), user = AppUser(mapOf("id" to "demo", "role" to "site_manager")))
        compose.setContent {
            VgTheme { FieldShell(field, ShellState(collapsed = true), SiteSummaryState(), true, 866,
                onWidth = {}, onToggle = {}, onSelect = {}, onLogout = {}, onRefresh = {}, onNextStage = {}) }
        }
        compose.onNodeWithTag("shell-receipt").assertTextEquals("오프라인")
        compose.onNodeWithText(shellReceipt(0, field)).assertDoesNotExist()
        compose.onNodeWithTag("shell-receipt-details").performClick()
        compose.onNodeWithText(shellReceipt(0, field)).assertIsDisplayed()
        compose.onNodeWithText("확인").performClick()
        compose.onNodeWithText(shellReceipt(0, field)).assertDoesNotExist()
    }
    @Test fun offlineBannerAndScrollingNeverMoveContentOrReservedStripAtTripleFontScale() {
        val time = "2026-09-14T15:13:04.759Z"
        val data = SiteStatus(mockSiteStatusReply(time))
        val field = mutableStateOf(FieldState(authStage = AuthStage.ready, siteStatusSnapshot = data,
            site = SiteInfo(mapOf("site_name" to "모의 현장")), user = AppUser(mapOf("id" to "demo", "role" to "site_manager"))))
        val shell = mutableStateOf(ShellState(collapsed = true))
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 3f)) {
                VgTheme {
                    Surface {
                        FieldShell(field.value, shell.value, SiteSummaryState(data, now = Instant.parse(time)),
                            isMock = true, windowWidthDp = 866, onWidth = {}, onToggle = {},
                            onSelect = { shell.value = shell.value.copy(destination = it) }, onLogout = {}, onRefresh = {}, onNextStage = {})
                    }
                }
            }
        }
        for (index in 0..4) {
            compose.runOnIdle { field.value = field.value.copy(offline = false) }
            compose.onNodeWithTag("rail-destination-$index").performScrollTo().performClick()
            val before = listOf("shell-content", "global-alert-slot", "shell-receipt-slot").map {
                compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot
            }
            val workspace = compose.onNodeWithTag("dashboard-workspace").fetchSemanticsNode().boundsInRoot
            before.forEach { bounds ->
                assertTrue(bounds.left >= workspace.left && bounds.right <= workspace.right)
                assertTrue(bounds.top >= workspace.top && bounds.bottom <= workspace.bottom)
            }
            compose.runOnIdle { field.value = field.value.copy(offline = true) }
            val after = listOf("shell-content", "global-alert-slot", "shell-receipt-slot").map {
                compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot
            }
            assertEquals(before, after)
            assertTrue(after[2].bottom <= after[0].top)
            assertTrue(after[0].bottom <= after[1].top)
            compose.onNodeWithTag("shell-receipt-scroll").performTouchInput { swipeUp() }
            assertEquals(before[0], compose.onNodeWithTag("shell-content").fetchSemanticsNode().boundsInRoot)
        }
    }
    @Test fun tripleFontLoginAndDialogKeepReachableMinimumTargets() {
        var form by mutableStateOf(AuthFormState(dialog = connectionDialog(false)))
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 3f)) {
                VgTheme {
                    Surface {
                        AuthScreen(FieldState(authStage = AuthStage.login), form, isMock = true,
                            onId = { form = form.copy(id = it) }, onPassword = { form = form.copy(password = it) },
                            onDismissDialog = { form = form.copy(dialog = null) })
                    }
                }
            }
        }
        compose.onNodeWithText("확인").assertIsDisplayed().performClick()
        compose.onNodeWithTag("login-id").performScrollTo().performTextInput("field-operator")
        compose.onNodeWithTag("login-password").performScrollTo().performTextInput("synthetic")
        compose.onNodeWithTag("auth-submit").performScrollTo().assertHeightIsAtLeast(64.dp).assertIsDisplayed()
        compose.runOnIdle { assertEquals("field-operator", form.id); assertEquals("synthetic", form.password) }
    }
}

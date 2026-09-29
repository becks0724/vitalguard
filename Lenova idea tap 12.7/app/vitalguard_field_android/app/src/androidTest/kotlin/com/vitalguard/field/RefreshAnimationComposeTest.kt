package com.vitalguard.field

import androidx.compose.runtime.mutableStateOf
import androidx.compose.material3.Surface
import com.vitalguard.field.ui.theme.DashboardColors
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.vitalguard.field.ui.theme.ActionIconButton
import com.vitalguard.field.ui.theme.DashboardTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlin.math.abs

class RefreshAnimationComposeTest {
    @get:Rule val compose = createComposeRule()
    private fun changed(a: ImageBitmap, b: ImageBitmap): Int {
        val first = a.toPixelMap(); val second = b.toPixelMap()
        var n = 0
        for (y in a.height / 4 until a.height * 3 / 4) for (x in a.width / 4 until a.width * 3 / 4) {
            val a = first[x, y]; val b = second[x, y]
            // Ignore the faint touch ripple; compare the high-contrast arrow silhouette.
            if (abs(a.red * a.alpha - b.red * b.alpha) + abs(a.green * a.alpha - b.green * b.alpha) + abs(a.blue * a.alpha - b.blue * b.alpha) > .9f) n++
        }
        return n
    }
    @Test fun fastResponseFinishesTheStartedTurnInsteadOfSnappingBack() {
        val busy = mutableStateOf(false)
        compose.setContent { DashboardTheme { Surface(color = DashboardColors.sidebar) { ActionIconButton(R.drawable.ic_refresh, "새로고침", {},
            Modifier.testTag("refresh"), enabled = !busy.value, busy = busy.value) } } }
        compose.mainClock.autoAdvance = false
        val initial = compose.onNodeWithTag("refresh").captureToImage()
        compose.runOnIdle { busy.value = true }
        compose.mainClock.advanceTimeBy(210)
        val moving = compose.onNodeWithTag("refresh").captureToImage()
        assertTrue("시작한 회전이 보여야 한다", changed(initial, moving) > 10)
        compose.runOnIdle { busy.value = false }
        compose.mainClock.advanceTimeBy(16)
        val released = compose.onNodeWithTag("refresh").captureToImage()
        assertTrue("빠른 응답 후에도 360도 전에 원래 각도로 순간 복귀하면 안 된다", changed(initial, released) > 10)
        compose.mainClock.advanceTimeBy(1000)
        assertTrue("한 회전 뒤에는 원래 각도로 멈춰야 한다", changed(initial, compose.onNodeWithTag("refresh").captureToImage()) < 5)
    }
    @Test fun instantResponsesAndRepeatedTapsStillFinishWholeTurns() {
        var calls = 0
        compose.setContent { DashboardTheme { Surface(color = DashboardColors.sidebar) { ActionIconButton(R.drawable.ic_refresh, "새로고침", { calls++ }, Modifier.testTag("refresh")) } } }
        compose.mainClock.autoAdvance = false
        val initial = compose.onNodeWithTag("refresh").captureToImage()
        compose.onNodeWithTag("refresh").performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithTag("refresh").performClick()
        compose.mainClock.advanceTimeBy(900)
        assertTrue(changed(initial, compose.onNodeWithTag("refresh").captureToImage()) > 10)
        compose.mainClock.advanceTimeBy(1000)
        assertTrue("회전 종료 뒤 원래 방향", changed(initial, compose.onNodeWithTag("refresh").captureToImage()) < 5)
        assertEquals(2, calls)
    }
    @Test fun slowOrFailedRequestFinishesItsCurrentTurnAndReenablesAction() {
        val busy = mutableStateOf(true)
        compose.mainClock.autoAdvance = false
        compose.setContent { DashboardTheme { Surface(color = DashboardColors.sidebar) { ActionIconButton(R.drawable.ic_refresh, "새로고침", {}, Modifier.testTag("refresh"), enabled = !busy.value, busy = busy.value) } } }
        compose.mainClock.autoAdvance = false
        compose.mainClock.advanceTimeBy(1800)
        compose.onNodeWithTag("refresh").assertIsNotEnabled()
        val moving = compose.onNodeWithTag("refresh").captureToImage()
        compose.runOnIdle { busy.value = false } // same completion path for a successful reply or an error
        compose.mainClock.advanceTimeBy(50)
        assertTrue(changed(moving, compose.onNodeWithTag("refresh").captureToImage()) > 10)
        compose.mainClock.advanceTimeBy(1000)
        val stopped = compose.onNodeWithTag("refresh").captureToImage()
        compose.mainClock.advanceTimeBy(400)
        assertEquals(0, changed(stopped, compose.onNodeWithTag("refresh").captureToImage()))
        compose.onNodeWithTag("refresh").assertIsEnabled()
    }

}

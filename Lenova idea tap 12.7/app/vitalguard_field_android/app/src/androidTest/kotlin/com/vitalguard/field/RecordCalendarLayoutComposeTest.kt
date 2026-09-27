package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.data.*
import com.vitalguard.field.data.record.*
import com.vitalguard.field.ui.record.RecordCalendarContent
import com.vitalguard.field.ui.theme.VgTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.*

@RunWith(AndroidJUnit4::class)
class RecordCalendarLayoutComposeTest {
    @get:Rule val compose = createComposeRule()
    private val today = LocalDate.parse("2026-09-27")
    @Test fun miniMonthWeekGridDateSelectionAndTwoFabsExist() {
        val selected = mutableStateOf(today)
        var scans = 0; var photos = 0
        compose.setContent { VgTheme {
            RecordCalendarContent(selected.value, emptyList(), today, onSelect = { selected.value = it }, onScan = { scans++ }, onPhoto = { photos++ })
        } }
        compose.onNodeWithTag("calendar-mini-month").assertExists()
        compose.onNodeWithTag("calendar-week").assertExists()
        compose.onNodeWithTag("week-day-$today").assertIsSelected()
        compose.onNodeWithTag("document-scan").performClick(); compose.onNodeWithTag("photo-capture").performClick()
        compose.runOnIdle { assertEquals(1, scans); assertEquals(1, photos) }
        compose.onNodeWithTag("week-day-${today.plusDays(1)}").performClick()
        compose.runOnIdle { assertEquals(today.plusDays(1), selected.value) }
        compose.onNodeWithTag("calendar-day-list").assertExists()
        compose.onNodeWithText("9월 28일 기록 · 0건").assertExists()
    }
    @Test fun narrowWindowStacksMiniMonthAboveOnlyScrollingHourGrid() {
        var pixelsPerDp = 1f
        compose.setContent { pixelsPerDp = LocalDensity.current.density
            VgTheme { Box(Modifier.width(600.dp).fillMaxHeight()) { RecordCalendarContent(today, emptyList()) } } }
        compose.onNodeWithTag("calendar-stacked").assertExists()
        compose.onNodeWithTag("calendar-hour-scroll").assert(hasScrollAction())
        compose.onNodeWithTag("record-calendar").assert(!hasScrollAction())
        compose.onNodeWithTag("calendar-mini-month").assert(!hasScrollAction())
        val axis = compose.onNodeWithTag("calendar-hour-scroll").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        assertEquals(7 * 44 * pixelsPerDp, axis.value(), 1f)
    }
    @Test fun photoWithoutReadableTimeRemainsInAllDayStrip() {
        val photo = OutboxEntry("p", "a", OutboxKind.photo, mapOf("dateKey" to today.toString()), "현장", Instant.EPOCH, false)
        compose.setContent { VgTheme { RecordCalendarContent(today, mergeCalendarRecords(listOf(photo), emptyList())) } }
        compose.onNodeWithTag("calendar-block-$today:all-day").assertExists().performClick()
        compose.onNodeWithTag("record-photo-p").assertExists()
    }
}

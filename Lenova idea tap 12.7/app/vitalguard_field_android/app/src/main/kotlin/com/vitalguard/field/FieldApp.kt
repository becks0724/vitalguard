package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.activity.compose.BackHandler
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import android.app.Activity
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
import com.vitalguard.field.ui.theme.DashboardColors
import com.vitalguard.field.ui.theme.DashboardBackdrop
import com.vitalguard.field.ui.theme.VgColors
import androidx.lifecycle.Lifecycle
import androidx.navigation.compose.rememberNavController
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.ui.auth.AuthScreen
import com.vitalguard.field.ui.shell.FieldShell
import com.vitalguard.field.ui.shell.LocalActionPlacement
import com.vitalguard.field.data.ActionPlacementState
import com.vitalguard.field.ui.settings.SettingsContent
import com.vitalguard.field.ui.record.RecordNavigation
import com.vitalguard.field.ui.outbox.OutboxScreen
import com.vitalguard.field.ui.site.SiteScreen
import com.vitalguard.field.ui.site.SiteDetailScreen
import com.vitalguard.field.ui.alerts.AlertsScreen
import com.vitalguard.field.ui.alerts.GlobalAlertStrip
import com.vitalguard.field.ui.cctv.CctvScreen
import kotlinx.coroutines.flow.collect

@Composable
fun FieldApp(model: FieldViewModel) {
    val field by model.controller.state.collectAsStateWithLifecycle()
    val auth by model.auth.state.collectAsStateWithLifecycle()
    val shell by model.shell.state.collectAsStateWithLifecycle()
    val site by model.site.state.collectAsStateWithLifecycle()
    val sitePage by model.sitePage.collectAsStateWithLifecycle()
    val placement by model.placement.collectAsStateWithLifecycle()
    var weatherPreview by remember(field.user?.id) { mutableStateOf<com.vitalguard.field.ui.site.WeatherPreviewMode?>(null) }
    val weatherDetailVisible = field.authStage == AuthStage.ready && shell.destination == 0 && sitePage == "weather"
    LaunchedEffect(weatherDetailVisible) { if (!weatherDetailVisible) weatherPreview = null }
    val window = (LocalContext.current as? Activity)?.window
    SideEffect { window?.let {
        val bars = WindowCompat.getInsetsController(it, it.decorView)
        bars.isAppearanceLightStatusBars = field.authStage != AuthStage.ready
        bars.isAppearanceLightNavigationBars = field.authStage != AuthStage.ready
    } }
    BackHandler(field.authStage == AuthStage.ready && shell.destination == 0 && sitePage != null) { model.openSite(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(model, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> { model.site.setForeground(true); model.outboxUi.setForeground(true); model.alerts.setForeground(true); model.cctv.setForeground(true) }
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> { weatherPreview = null; model.site.setForeground(false); model.outboxUi.setForeground(false); model.alerts.setForeground(false); model.cctv.setForeground(false) }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        model.site.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        model.outboxUi.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        model.alerts.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        model.cctv.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose { lifecycle.removeObserver(observer); model.site.setForeground(false); model.outboxUi.setForeground(false); model.alerts.setForeground(false); model.cctv.setForeground(false) }
    }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model) { model.messages.collect { snackbar.showSnackbar(it) } }
    // 창 폭 기준은 인셋을 빼기 전이다. 런타임 safeDrawing·IME·제스처 인셋은 아래 한 계층에서 합집합 소비.
    val weatherEffects = if (weatherDetailVisible && weatherPreview != null) weatherPreview!!.effects
        else com.vitalguard.field.ui.site.weatherBackgroundEffects(site, weatherDetailVisible, field.offline)
    CompositionLocalProvider(com.vitalguard.field.ui.site.LocalWeatherEffects provides weatherEffects,
        com.vitalguard.field.ui.site.LocalWeatherPreview provides com.vitalguard.field.ui.site.WeatherPreviewControl(weatherPreview) { weatherPreview = it }) {
    DashboardBackdrop(Modifier.fillMaxSize().background(if (field.authStage == AuthStage.ready) DashboardColors.backdrop else VgColors.canvas),
        showWallpaper = field.authStage == AuthStage.ready) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val windowWidthDp = maxWidth.value.toInt()
        Scaffold(
            containerColor = if (field.authStage == AuthStage.ready) androidx.compose.ui.graphics.Color.Transparent else VgColors.canvas,
            modifier = Modifier.fillMaxSize().windowInsetsPadding(
                WindowInsets.safeDrawing.union(WindowInsets.ime).union(WindowInsets.systemGestures)),
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                if (field.authStage == AuthStage.ready && field.user != null) {
                    key(field.user!!.id) {
                        // 탭을 가린 동안 끝난 저장도 같은 기록 스택에 반영한다.
                        val recordNav = rememberNavController()
                        LaunchedEffect(shell.homeRevisions[2]) {
                            if (shell.homeRevisions[2] > 0) recordNav.popBackStack("record-home", inclusive = false)
                        }
                        LaunchedEffect(field.user!!.id) {
                            withFrameNanos { } // 셸의 첫 프레임 뒤 계정별 재진입 지점을 읽는다.
                            model.restoreRecord()
                        }
                        val accountPlacement = placement?.takeIf { it.accountId == field.user!!.id }
                        val actionPlacement = accountPlacement?.state?.collectAsStateWithLifecycle()?.value ?: ActionPlacementState()
                        CompositionLocalProvider(LocalActionPlacement provides actionPlacement) {
                        FieldShell(field, shell, site, model.controller.isMock, windowWidthDp,
                            onProfile = model.memberProfile::open,
                            drawWallpaper = false, reclaimEmptyAlertSpace = shell.destination == 0 && sitePage == "cctv",
                            onWidth = model.shell::windowWidth, onToggle = model.shell::toggle,
                            onSelect = model::selectTab, onLogout = model.shell::logout,
                            onRefresh = model.site::manualRefresh, onNextStage = { model.snackbar("다음 단계") },
                            recordContent = { RecordNavigation(model, windowWidthDp, recordNav) },
                            outboxContent = { OutboxScreen(model.outboxUi) },
                            siteContent = {
                                when (val page = sitePage) {
                                    null -> SiteScreen(site, model.site::manualRefresh,
                                        onOpenDetail = model::openSite, onOpenCctv = { camera -> model.cctv.camera(camera); model.openSite("cctv") }, onOpenAlerts = { model.selectDestination(1) })
                                    "cctv" -> CctvScreen(model.cctv, onBack = { model.openSite(null) }, onSettings = { model.selectDestination(4) })
                                    else -> SiteDetailScreen(page, site, { model.openSite(null) }, model.site::manualRefresh)
                                }
                            },
                            alertsContent = { AlertsScreen(model.alerts, model.controller.isMock) },
                            settingsContent = {
                                val cctvSettings by model.cctv.state.collectAsStateWithLifecycle()
                                SettingsContent(actionPlacement, model::selectActionSide, cctvSettings, model.cctv::period)
                            },
                            globalAlertContent = { GlobalAlertStrip(model.alerts, shell.recordEditorOpen) { row ->
                                model.alerts.select(row); model.selectDestination(1)
                            } })
                        com.vitalguard.field.ui.profile.MemberProfileDialog(model.memberProfile, field.user)
                        }
                    }
                } else {
                    AuthScreen(field, auth, model.controller.isMock,
                        onId = model.auth::id, onPassword = model.auth::password, onCode = model.auth::code,
                        onRemember = model.auth::remember, onTogglePassword = model.auth::togglePassword,
                        onSubmit = model.auth::submit, onCancel = model.auth::cancel,
                        onDismissDialog = model.auth::dismissDialog)
                }
            }
        }
    }
    }
    }
}

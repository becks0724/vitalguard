package com.vitalguard.field

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.data.contracts.AuthStage
import com.vitalguard.field.ui.auth.AuthScreen
import com.vitalguard.field.ui.shell.FieldShell
import com.vitalguard.field.ui.shell.LocalActionPlacement
import com.vitalguard.field.data.ActionPlacement
import com.vitalguard.field.ui.record.RecordNavigation
import com.vitalguard.field.ui.outbox.OutboxScreen
import kotlinx.coroutines.flow.collect

@Composable
fun FieldApp(model: FieldViewModel) {
    val field by model.controller.state.collectAsStateWithLifecycle()
    val auth by model.auth.state.collectAsStateWithLifecycle()
    val shell by model.shell.state.collectAsStateWithLifecycle()
    val site by model.site.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(model, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> { model.site.setForeground(true); model.outboxUi.setForeground(true) }
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> { model.site.setForeground(false); model.outboxUi.setForeground(false) }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        model.site.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        model.outboxUi.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose { lifecycle.removeObserver(observer); model.site.setForeground(false); model.outboxUi.setForeground(false) }
    }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model) { model.messages.collect { snackbar.showSnackbar(it) } }
    // 창 폭 기준은 인셋을 빼기 전이다. 런타임 safeDrawing·IME·제스처 인셋은 아래 한 계층에서 합집합 소비.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val windowWidthDp = maxWidth.value.toInt()
        Scaffold(
            modifier = Modifier.fillMaxSize().windowInsetsPadding(
                WindowInsets.safeDrawing.union(WindowInsets.ime).union(WindowInsets.systemGestures)),
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                if (field.authStage == AuthStage.ready && field.user != null) {
                    key(field.user!!.id) {
                        val placement = remember(field.user!!.id) { ActionPlacement(model.controller.local, field.user!!.id) }
                        val actionPlacement by placement.state.collectAsStateWithLifecycle()
                        LaunchedEffect(placement) { placement.load() }
                        CompositionLocalProvider(LocalActionPlacement provides actionPlacement) {
                        FieldShell(field, shell, site, model.controller.isMock, windowWidthDp,
                            onWidth = model.shell::windowWidth, onToggle = model.shell::toggle,
                            onSelect = model.shell::select, onLogout = model.shell::logout,
                            onRefresh = model.site::manualRefresh, onNextStage = { model.snackbar("다음 단계") },
                            recordContent = { RecordNavigation(model, windowWidthDp) },
                            outboxContent = { OutboxScreen(model.outboxUi) })
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

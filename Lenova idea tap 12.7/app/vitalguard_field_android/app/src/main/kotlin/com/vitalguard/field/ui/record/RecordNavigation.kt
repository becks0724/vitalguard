package com.vitalguard.field.ui.record

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.vitalguard.field.data.OutboxPhase
import com.vitalguard.field.FieldViewModel
import com.vitalguard.field.capture.CaptureUiState
import com.vitalguard.field.ui.capture.CameraRoute

// 기록 탭의 NavHost. NavController는 계정 셸에 두고 화면 스크롤은 SaveableStateProvider가 보존한다.
@Composable
fun RecordNavigation(model: FieldViewModel, windowWidthDp: Int, nav: NavHostController) {
    val backStack by nav.currentBackStackEntryAsState()
    val entries by model.outbox.items.collectAsStateWithLifecycle()
    val recovery by model.records.recovery.collectAsStateWithLifecycle()
    val closedDetail by model.records.closedDetail.collectAsStateWithLifecycle()
    val closeDetail: () -> Unit = { model.records.launch { model.records.closeDetail(); nav.popBackStack("record-home", inclusive = false) } }
    LaunchedEffect(closedDetail) {
        if (closedDetail > 0 && model.records.detail.value == null) nav.popBackStack("record-home", inclusive = false)
    }
    val capture = model.capture
    val captureState = capture?.state?.collectAsStateWithLifecycle()?.value ?: CaptureUiState()
    LaunchedEffect(capture) { capture?.prepareScanner() }
    LaunchedEffect(captureState.navigation) {
        captureState.navigation?.let {
            nav.popBackStack("record-home", inclusive = false)
            if (it.photoId != null) {
                model.records.openDetail(it.photoId, it.batchIds.ifEmpty { listOf(it.photoId) })
                nav.navigate("photo/${it.photoId}")
            }
            capture?.consumeNavigation(it)
        }
    }
    LaunchedEffect(recovery) {
        recovery?.let { saved ->
            nav.popBackStack("record-home", inclusive = false)
            model.records.openDetail(saved.media.id)
            nav.navigate("photo/${saved.media.id}")
            if (saved.ink) model.shell.editorOpen(true)
            nav.navigate("${if (saved.ink) "editor" else "input"}/${saved.media.id}")
            model.records.consumeRecovery(saved)
        }
    }
    // 퇴장 애니메이션 중에도 편집기 폭을 유지한다. route 내용이 완전히 제거되면 해제한다.
    val openEditor: (String) -> Unit = { id -> model.shell.editorOpen(true); nav.navigate("editor/$id") { launchSingleTop = true } }
    NavHost(navController = nav, startDestination = "record-home") {
        composable("record-home") {
            RecordCalendarScreen(model.controller, model.outbox, model.calendar, model.recordActions, captureState,
                onScan = { capture?.scanDocuments() },
                onPhoto = { if (capture?.openCamera() == true) nav.navigate("camera") },
                onOpen = { record -> model.records.launch {
                    val photo = if (record.server) model.outbox.referenceServerPhoto(record.media) else requireNotNull(record.local)
                    if (photo.owner == model.outbox.account) {
                        model.records.openDetail(photo.id)
                        nav.navigate("photo/${photo.id}") { launchSingleTop = true }
                    }
                } })
        }
        composable("photo/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            PhotoDetail(model.controller, model.outbox, model.recordActions, requireNotNull(entry.arguments?.getString("id")),
                windowWidthDp, onBack = closeDetail,
                onEditor = { openEditor(requireNotNull(entry.arguments?.getString("id"))) },
                onInput = { nav.navigate("input/${entry.arguments?.getString("id")}") { launchSingleTop = true } })
        }
        composable("editor/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            val id = requireNotNull(entry.arguments?.getString("id"))
            val photo = entries.firstOrNull { it.id == id }
            if (photo == null) {
                LaunchedEffect(id, photo?.phase) {
                    model.outbox.load()
                    val current = model.outbox.entry(id)
                    if (current == null) {
                        model.records.forget(id)
                        nav.popBackStack("record-home", inclusive = false)
                    }
                }
                return@composable
            }
            val editor = remember(model, id) { model.records.editor(id) }
            DisposableEffect(editor) {
                model.shell.editorOpen(true)
                onDispose { model.shell.editorOpen(false) }
            }
            RecordEditorScreen(editor, model.records::launch) {
                model.records.finishEditor(editor)
                if (model.controller.state.value.user?.id == editor.owner) nav.popBackStack()
            }
        }
        composable("input/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            val id = requireNotNull(entry.arguments?.getString("id"))
            val photo = entries.firstOrNull { it.id == id }
            if (photo == null) {
                LaunchedEffect(id, photo?.phase) {
                    model.outbox.load()
                    val current = model.outbox.entry(id)
                    if (current == null) {
                        model.records.forget(id)
                        nav.popBackStack("record-home", inclusive = false)
                    }
                }
                return@composable
            }
            val input = remember(model, id) { model.records.input(id) }
            RecordInputScreen(input, model.controller.isMock, model.records::launch,
                onClosed = { model.records.finishInput(input); if (model.controller.state.value.user?.id == input.owner) nav.popBackStack() },
                onEditor = { openEditor(id) })
        }
        composable("camera") {
            if (capture != null) CameraRoute(captureState.camera, capture) {
                if (capture.backToRecord()) nav.popBackStack()
            }
        }
    }
    // 촬영 파일 저장 중 뒤로가기는 원본을 잃지 않도록 기다린다. 그 외에는 기록 스택부터 pop.
    BackHandler(enabled = backStack?.destination?.route == "photo/{id}", onBack = closeDetail)
    BackHandler(enabled = backStack?.destination?.route == "camera") {
        if (capture?.backToRecord() != false) nav.popBackStack()
    }
}

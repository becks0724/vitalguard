package com.vitalguard.field.ui.record

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.vitalguard.field.FieldViewModel
import com.vitalguard.field.capture.CaptureUiState
import com.vitalguard.field.ui.capture.CameraRoute

// 기록 탭만의 NavHost. 셸 SaveableStateProvider 안에서 스택/스크롤을 탭 전환·회전 간 보존한다.
@Composable
fun RecordNavigation(model: FieldViewModel, windowWidthDp: Int) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val capture = model.capture
    val captureState = capture?.state?.collectAsStateWithLifecycle()?.value ?: CaptureUiState()
    LaunchedEffect(capture) { capture?.prepareScanner() }
    LaunchedEffect(captureState.navigation) {
        captureState.navigation?.let {
            nav.popBackStack("record-home", inclusive = false)
            if (it.photoId != null) nav.navigate("photo/${it.photoId}")
            capture?.consumeNavigation(it)
        }
    }
    NavHost(navController = nav, startDestination = "record-home") {
        composable("record-home") {
            RecordHome(model.controller, model.outbox, captureState,
                onScan = { capture?.scanDocuments() },
                onPhoto = { if (capture?.openCamera() == true) nav.navigate("camera") },
                onOpen = { nav.navigate("photo/$it") }, onReload = model.outboxUi::loadAndCheck)
        }
        composable("photo/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            PhotoDetail(model.controller, model.outbox, model.recordActions, requireNotNull(entry.arguments?.getString("id")),
                windowWidthDp, onBack = { nav.popBackStack("record-home", inclusive = false) },
                onNextStage = { model.snackbar("다음 단계(2b)에서 옮깁니다") })
        }
        composable("camera") {
            if (capture != null) CameraRoute(captureState.camera, capture) {
                if (capture.backToRecord()) nav.popBackStack()
            }
        }
    }
    // 촬영 파일 저장 중 뒤로가기는 원본을 잃지 않도록 기다린다. 그 외에는 기록 스택부터 pop.
    BackHandler(enabled = backStack?.destination?.route == "camera") {
        if (capture?.backToRecord() != false) nav.popBackStack()
    }
}

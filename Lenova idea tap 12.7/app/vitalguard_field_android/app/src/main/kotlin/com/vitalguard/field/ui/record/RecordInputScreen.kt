package com.vitalguard.field.ui.record

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vitalguard.field.R
import com.vitalguard.field.data.record.*
import com.vitalguard.field.data.contracts.voiceTime
import com.vitalguard.field.ui.theme.*

@Composable
fun RecordInputScreen(input: RecordInputController, isMock: Boolean, run: (suspend () -> Unit) -> Unit,
    onClosed: () -> Unit, onEditor: () -> Unit) {
    val state by input.state.collectAsStateWithLifecycle()
    val voice by input.voice.state.collectAsStateWithLifecycle()
    var leaving by remember { mutableStateOf(false) }
    val back: () -> Unit = {
        if (!leaving) {
            leaving = true
            run { try { if (input.leave()) onClosed() } finally { leaving = false } }
        }
    }
    BackHandler(onBack = back)
    RecordInputContent(state, voice, isMock, onBack = back, onNote = input::note, onSpeechText = input::speechText,
        onChoose = input::choose, onConfirm = input::confirm, onSpeech = { run { input.startSpeech() } },
        onFinishSpeech = { run { input.finishSpeech() } }, onEditor = { run { input.flush(); onEditor() } },
        onSave = { run { input.save() } }, onVoiceStart = { run { input.voice.start() } },
        onVoiceStop = { run { input.voice.stop() } }, onVoiceDiscard = { run { input.voice.discard() } },
        onVoicePreview = { run { input.voice.preview() } }, onVoiceSend = { run { input.voice.send() } },
        onVoiceRerecord = { run { input.voice.rerecord() } })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RecordInputContent(
    state: RecordInputState, voice: VoiceDraftState = VoiceDraftState(loading = false), isMock: Boolean = false,
    onBack: () -> Unit = {}, onNote: (String) -> Unit = {}, onSpeechText: (String) -> Unit = {}, onChoose: (Int) -> Unit = {},
    onConfirm: (Boolean) -> Unit = {}, onSpeech: () -> Unit = {}, onFinishSpeech: () -> Unit = {}, onEditor: () -> Unit = {},
    onSave: () -> Unit = {}, onVoiceStart: () -> Unit = {}, onVoiceStop: () -> Unit = {}, onVoiceDiscard: () -> Unit = {},
    onVoicePreview: () -> Unit = {}, onVoiceSend: () -> Unit = {}, onVoiceRerecord: () -> Unit = {},
) {
    Scaffold(containerColor = Color.Transparent, contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(title = { Text("메모·음성 붙이기") }, expandedHeight = vgToolbarHeight(LocalDensity.current.fontScale),
            windowInsets = WindowInsets(0, 0, 0, 0), navigationIcon = {
                VgIconButton(R.drawable.ic_back, "초안 보존 후 뒤로", Modifier.testTag("record-input-back"), !state.saving && !voice.sending, onBack)
            })
    }) { padding ->
        if (state.loading) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else Column(Modifier.fillMaxSize().padding(padding).testTag("record-input-scroll").verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("관리자 기록", style = MaterialTheme.typography.headlineSmall)
            Text("직접 확인한 내용을 남깁니다. 센서 판정과 별개입니다.")
            Spacer(Modifier.height(16.dp))
            RecordTextField(state.note, onNote, Modifier.fillMaxWidth().testTag("record-note"), enabled = !state.saving,
                minLines = 3, maxLines = 8, label = { Text("내용 직접 입력") })
            Spacer(Modifier.height(20.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Button(onSpeech, Modifier.heightIn(min = 56.dp).testTag("speech-start"), enabled = !state.speaking && !state.saving && !voice.audioBusy) { Text("말로 입력") }
                OutlinedButton(onEditor, Modifier.heightIn(min = 56.dp).testTag("record-open-editor"), enabled = !state.saving && !voice.audioBusy) { Text("사진에 펜으로 메모하기") }
                OutlinedButton(onVoiceStart, Modifier.heightIn(min = 56.dp).testTag("voice-start"), enabled = !state.speaking && !state.saving && !voice.audioBusy && voice.clip == null) { Text("녹음") }
                OutlinedButton(onFinishSpeech, Modifier.heightIn(min = 56.dp).testTag("speech-finish"), enabled = state.speaking) { Text("말하기 끝내기") }
            }
            Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isMock) Text("모의 녹음 · 마이크를 사용하지 않습니다")
                if (voice.starting) Text("녹음 준비 중")
                if (voice.recording || voice.stopping) FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("녹음 중 ${voiceTime(voice.elapsedMs)}", Modifier.align(Alignment.CenterVertically).testTag("voice-elapsed"))
                    OutlinedButton(onVoiceStop, Modifier.heightIn(min = 56.dp).testTag("voice-stop"), enabled = !voice.stopping) { Text(if (voice.stopping) "녹음 보존 중" else "녹음 정지") }
                    TextButton(onVoiceDiscard, Modifier.heightIn(min = 56.dp).testTag("voice-cancel-recording"), enabled = !voice.busy) { Text("녹음 취소") }
                }
                if (voice.clip != null && !voice.stopping) {
                    Text("녹음 ${voiceTime(voice.clip.durationMs)} · 전송 전 확인")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        OutlinedButton(onVoicePreview, Modifier.heightIn(min = 56.dp).testTag("voice-preview"), enabled = !state.speaking && !state.saving && !voice.busy) { Text(if (voice.playing) "미리듣기 정지" else "미리듣기") }
                        Button(onVoiceSend, Modifier.heightIn(min = 56.dp).testTag("voice-send"), enabled = !state.speaking && !state.saving && !voice.busy) { Text(if (voice.sending) "저장 중" else "음성 저장") }
                        OutlinedButton(onVoiceRerecord, Modifier.heightIn(min = 56.dp).testTag("voice-rerecord"), enabled = !state.speaking && !state.saving && !voice.busy) { Text("다시 녹음") }
                        TextButton(onVoiceDiscard, Modifier.heightIn(min = 56.dp).testTag("voice-cancel"), enabled = !state.saving && !voice.busy) { Text("취소") }
                    }
                }
                voice.notice?.let { Text(it) }
                voice.error?.let { Text(it, Modifier.testTag("voice-error")) }
                if (voice.error != null && voice.clip != null) Text("녹음을 보존했습니다. 기기 저장 상태를 확인한 뒤 다시 저장해 주세요.")
            }
            Spacer(Modifier.height(16.dp))
            Text(state.speechStatus)
            state.candidates.forEachIndexed { index, candidate ->
                Spacer(Modifier.height(16.dp))
                OutlinedButton({ onChoose(index) }, Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("speech-candidate-$index")
                    .semantics { selected = state.choice == index }, enabled = !state.saving,
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = if (state.choice == index) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)) {
                    Text("${index + 1}. $candidate", Modifier.fillMaxWidth())
                }
            }
            if (state.choice != null) {
                Spacer(Modifier.height(16.dp))
                RecordTextField(state.speechText, onSpeechText, Modifier.fillMaxWidth().testTag("record-speech-text"), enabled = !state.saving,
                    minLines = 2, maxLines = 6, label = { Text("선택한 음성 문장 · 필요하면 수정") })
            }
            Spacer(Modifier.height(20.dp))
            Text("저장할 내용 확인", style = MaterialTheme.typography.titleLarge)
            SelectionContainer { Text(state.composed.ifEmpty { "아직 선택하거나 작성한 내용이 없습니다." }) }
            Text("특히 “미착용”, “중지”, 숫자와 장소가 맞는지 확인해 주세요.")
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("confirm-record")
                .toggleable(state.confirmed, !state.saving && state.composed.isNotBlank(), Role.Checkbox, onValueChange = onConfirm), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(state.confirmed, null, enabled = !state.saving && state.composed.isNotBlank())
                Text("위 문장 전체를 확인했습니다", Modifier.weight(1f))
            }
            state.error?.let { Text(it) }; state.notice?.let { Text(it) }
            Spacer(Modifier.height(16.dp))
            Button(onSave, Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("save-record"), enabled = state.confirmed && !state.saving && !voice.audioBusy) { Text(if (state.saving) "저장 중" else "메모 저장") }
        }
    }
}

// 커서/선택 범위만 saved state에 둔다. 미확인 음성 후보 텍스트는 Bundle에도 넣지 않는다.
@Composable
private fun RecordTextField(text: String, onText: (String) -> Unit, modifier: Modifier, enabled: Boolean,
    minLines: Int, maxLines: Int, label: @Composable () -> Unit) {
    var start by rememberSaveable { mutableIntStateOf(text.length) }
    var end by rememberSaveable { mutableIntStateOf(text.length) }
    var value by remember { mutableStateOf(TextFieldValue(text, TextRange(start.coerceIn(0,text.length),end.coerceIn(0,text.length)))) }
    if (value.text != text) value = value.copy(text = text, selection = TextRange(start.coerceIn(0,text.length),end.coerceIn(0,text.length)), composition = null)
    OutlinedTextField(value, { next ->
        value = next; start = next.selection.start; end = next.selection.end
        if (next.text != text) onText(next.text)
    }, modifier, enabled = enabled, minLines = minLines, maxLines = maxLines, label = label)
}

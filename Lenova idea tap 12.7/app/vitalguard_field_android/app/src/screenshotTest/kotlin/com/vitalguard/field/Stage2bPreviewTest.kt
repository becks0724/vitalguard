package com.vitalguard.field

// 고정 프리뷰 각 1장. 녹음·STT·네트워크·초안 저장·타이머를 실행하지 않는다.
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.tooling.preview.Preview
import com.android.tools.screenshot.PreviewTest
import com.vitalguard.field.data.contracts.VoiceRecording
import com.vitalguard.field.data.record.*
import com.vitalguard.field.ui.record.*
import com.vitalguard.field.ui.theme.VgTheme

@PreviewTest
@Preview(name="RecordEditor866",device="spec:width=866dp,height=1385dp,dpi=340",locale="ko",showBackground=true)
@Composable
fun RecordEditorPreview() {
    val stroke=InkStroke(InkTool.rectangle,0xFFDC2626,.004,listOf(InkPoint(.2,.3),InkPoint(.8,.72)))
    VgTheme {
        RecordEditorContent(InkEditorState(loading=false,strokes=listOf(stroke),visibleStrokes=listOf(stroke),
            imageSize=InkSize(1000.0,750.0),dirty=true,revision=1,undoAvailable=true)) {
            Canvas(Modifier.fillMaxSize()) {
                val h=size.width*.75f; val top=(size.height-h)/2
                drawRect(Color(0xFFE3EBED),Offset(0f,top),Size(size.width,h))
                drawRect(Color(0xFFC7CECC),Offset(0f,top+h*.42f),Size(size.width,h*.58f))
                for(y in listOf(.42f,.64f)) drawLine(Color(0xFFD99435),Offset(size.width*.1f,top+h*y),Offset(size.width*.9f,top+h*y),h*.025f)
                for(x in listOf(.12f,.38f,.64f,.88f)) drawLine(Color(0xFF7A8584),Offset(size.width*x,top+h*.38f),Offset(size.width*x,top+h*.85f),size.width*.022f)
                drawRect(Color(0xFFDC2626),Offset(size.width*.2f,top+h*.3f),Size(size.width*.6f,h*.42f),style=Stroke(size.width*.004f))
            }
        }
    }
}

@PreviewTest
@Preview(name="RecordInput866",device="spec:width=866dp,height=1385dp,dpi=340",locale="ko",showBackground=true)
@Composable
fun RecordInputPreview() {
    VgTheme {
        RecordInputContent(RecordInputState(loading=false,note="2층 작업 구역의 보호구 착용 상태를 확인했습니다.",
            candidates=listOf("작업 중지 후 안전난간을 확인했습니다."),choice=0,speechText="작업 중지 후 안전난간을 확인했습니다.",
            speechStatus="맞는 후보를 고르고 문장을 확인하세요",confirmed=true),
            VoiceDraftState(loading=false,clip=VoiceRecording("preview.m4a",14000,48000),notice="들어본 뒤 저장해 주세요."),isMock=true)
    }
}

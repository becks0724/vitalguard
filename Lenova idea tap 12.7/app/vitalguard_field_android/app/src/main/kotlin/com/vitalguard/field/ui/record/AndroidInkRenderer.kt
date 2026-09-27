package com.vitalguard.field.ui.record

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import com.vitalguard.field.data.contracts.ApiFailure
import com.vitalguard.field.data.record.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

// 미리보기만 샘플링한다. 저장은 원본 크기의 mutable 비트맵 한 장에 직접 그린다.
// 원본 + 출력용 전체 비트맵을 동시에 할당하지 않는다(4160px 사진 포함).
class AndroidInkRenderer : InkRenderer {
    override suspend fun dimensions(bytes: ByteArray): InkSize = withContext(Dispatchers.Default) {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        check(options.outWidth > 0 && options.outHeight > 0) { "원본 이미지를 읽지 못했습니다" }
        InkSize(options.outWidth.toDouble(), options.outHeight.toDouble())
    }
    override suspend fun render(bytes: ByteArray, strokes: List<InkStroke>): ByteArray = withContext(Dispatchers.Default) {
        try {
            val bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inMutable = true; inSampleSize = 1; inPreferredConfig = Bitmap.Config.ARGB_8888
            })) { "원본 이미지를 읽지 못했습니다" }
            try {
                paintInk(Canvas(bitmap), RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat()), strokes)
                ByteArrayOutputStream().use {
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) { "주석 이미지를 만들지 못했습니다" }
                    it.toByteArray()
                }
            } finally { bitmap.recycle() }
        } catch (_: OutOfMemoryError) {
            // 초안은 렌더 전에 영속화되어 있다. 축소본을 원본 크기 결과로 바꿔 보내지 않는다.
            throw ApiFailure("원본 크기 주석 이미지를 만들 메모리가 부족합니다. 초안은 기기에 보관됩니다.")
        }
    }
    suspend fun preview(bytes: ByteArray): Bitmap = withContext(Dispatchers.Default) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888
        })) { "원본 이미지를 읽지 못했습니다" }
    }
}

// Port: paintAnnotation. Canvas 미리보기와 원본 해상도 PNG가 같은 획 렌더러를 쓴다.
fun paintInk(canvas: Canvas, rect: RectF, strokes: List<InkStroke>) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND; style = Paint.Style.STROKE }
    val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    for (stroke in strokes) {
        if (stroke.points.isEmpty() || stroke.tool == InkTool.eraser) continue
        fun x(p: InkPoint) = rect.left + p.x.toFloat() * rect.width()
        fun y(p: InkPoint) = rect.top + p.y.toFloat() * rect.height()
        paint.color = stroke.color.toInt()
        if (stroke.tool == InkTool.marker) paint.alpha = (255 * .35).toInt()
        paint.strokeWidth = stroke.width.toFloat() * rect.width()
        if (stroke.tool == InkTool.rectangle) {
            val a = stroke.points.first(); val b = stroke.points.last()
            canvas.drawRect(min(x(a), x(b)), min(y(a), y(b)), max(x(a), x(b)), max(y(a), y(b)), paint)
        } else {
            stroke.points.forEachIndexed { index, p ->
                paint.strokeWidth = (stroke.width * rect.width() * (.45 + .9 * p.pressure.coerceIn(0.0, 1.0))).toFloat()
                if (index == 0) {
                    dot.color = paint.color; canvas.drawCircle(x(p), y(p), paint.strokeWidth / 2, dot)
                } else {
                    val previous = stroke.points[index - 1]
                    canvas.drawLine(x(previous), y(previous), x(p), y(p), paint)
                }
            }
        }
    }
}

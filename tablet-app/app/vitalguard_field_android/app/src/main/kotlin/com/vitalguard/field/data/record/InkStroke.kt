package com.vitalguard.field.data.record

import com.vitalguard.field.data.models.*
import kotlin.math.*

// Port: ink_stroke.dart. 좌표는 사진 기준, 선폭/지우개 거리는 원본 너비 기준.
enum class InkTool { pen, marker, rectangle, eraser }
data class InkPoint(val x: Double, val y: Double, val pressure: Double = 1.0) {
    fun toJson() = listOf(x, y, pressure)
}
data class InkSize(val width: Double, val height: Double)
data class InkOffset(val x: Double = 0.0, val y: Double = 0.0) {
    operator fun plus(b: InkOffset) = InkOffset(x + b.x, y + b.y)
    operator fun minus(b: InkOffset) = InkOffset(x - b.x, y - b.y)
    operator fun times(k: Double) = InkOffset(x * k, y * k)
    val squared get() = x * x + y * y
}
data class InkRect(val left: Double, val top: Double, val width: Double, val height: Double) {
    fun point(position: InkOffset, pressure: Double): InkPoint? {
        if (width <= 0 || height <= 0 || position.x < left || position.y < top || position.x > left + width || position.y > top + height) return null
        return InkPoint(floor((position.x - left) / width * 10000 + .5) / 10000,
            floor((position.y - top) / height * 10000 + .5) / 10000, floor(pressure.coerceIn(0.0, 1.0) * 100 + .5) / 100)
    }
}
data class InkStroke(val tool: InkTool, val color: Long, val width: Double, val points: List<InkPoint>) {
    fun toJson(): JsonObject = linkedMapOf("tool" to tool.name, "color" to color, "width" to width, "points" to points.map { it.toJson() })
    companion object {
        fun fromJson(j: JsonObject): InkStroke = InkStroke(InkTool.valueOf(j["tool"] as String),
            (j["color"] as Number).toLong(), (j["width"] as Number).toDouble(), (j["points"] as List<*>).map {
                val p = it as List<*>; InkPoint((p[0] as Number).toDouble(), (p[1] as Number).toDouble(), (p[2] as Number).toDouble())
            })
    }
}
fun encodeInk(strokes: List<InkStroke>): ByteArray {
    check(strokes.none { it.tool == InkTool.eraser }) { "저장된 지우개를 획 삭제로 변환해야 합니다" }
    return Json.encode(linkedMapOf("v" to 1, "strokes" to strokes.map { it.toJson() })).toByteArray(Charsets.UTF_8)
}
private data class Segment(val start: InkOffset, val end: InkOffset, val radius: Double)
private fun segments(stroke: InkStroke, yScale: Double, legacyPressure: Boolean = false): List<Segment> {
    if (stroke.points.isEmpty()) return emptyList()
    fun p(point: InkPoint) = InkOffset(point.x, point.y * yScale)
    fun radius(point: InkPoint) = stroke.width / 2 * if (stroke.tool == InkTool.eraser && !legacyPressure) 1.0 else .45 + .9 * point.pressure.coerceIn(0.0, 1.0)
    if (stroke.tool == InkTool.rectangle) {
        val a = p(stroke.points.first()); val b = p(stroke.points.last())
        val corners = listOf(InkOffset(min(a.x, b.x), min(a.y, b.y)), InkOffset(max(a.x, b.x), min(a.y, b.y)),
            InkOffset(max(a.x, b.x), max(a.y, b.y)), InkOffset(min(a.x, b.x), max(a.y, b.y)))
        return corners.indices.map { Segment(corners[it], corners[(it + 1) % 4], stroke.width / 2) }
    }
    return listOf(Segment(p(stroke.points.first()), p(stroke.points.first()), radius(stroke.points.first()))) +
        stroke.points.zipWithNext { a, b -> Segment(p(a), p(b), radius(b)) }
}
private fun pointSegment(p: InkOffset, a: InkOffset, b: InkOffset): Double {
    val d = b - a
    if (d.squared == 0.0) return (p - a).squared
    val t = (((p.x - a.x) * d.x + (p.y - a.y) * d.y) / d.squared).coerceIn(0.0, 1.0)
    return (p - (a + d * t)).squared
}
private fun distance(a: Segment, b: Segment): Double {
    fun cross(p: InkOffset, q: InkOffset) = p.x * q.y - p.y * q.x
    val da = a.end - a.start; val db = b.end - b.start
    val denominator = cross(da, db)
    if (denominator != 0.0) {
        val between = b.start - a.start
        if (cross(between, db) / denominator in 0.0..1.0 && cross(between, da) / denominator in 0.0..1.0) return 0.0
    }
    return minOf(pointSegment(a.start, b.start, b.end), pointSegment(a.end, b.start, b.end),
        pointSegment(b.start, a.start, a.end), pointSegment(b.end, a.start, a.end))
}
fun eraseInkStrokes(strokes: MutableList<InkStroke>, eraser: InkStroke, size: InkSize, legacyPressure: Boolean = false): Boolean {
    require(size.width > 0 && size.height > 0)
    val sweeps = segments(eraser, size.height / size.width, legacyPressure)
    return strokes.removeAll { stroke -> segments(stroke, size.height / size.width).any { ink ->
        sweeps.any { sweep -> distance(ink, sweep) <= (ink.radius + sweep.radius).pow(2) }
    } }
}
fun restoreInkStrokes(saved: List<InkStroke>, size: InkSize): List<InkStroke> = mutableListOf<InkStroke>().apply {
    saved.forEach { if (it.tool == InkTool.eraser) eraseInkStrokes(this, it, size, legacyPressure = true) else add(it) }
}

interface InkRenderer {
    suspend fun dimensions(bytes: ByteArray): InkSize
    suspend fun render(bytes: ByteArray, strokes: List<InkStroke>): ByteArray
}

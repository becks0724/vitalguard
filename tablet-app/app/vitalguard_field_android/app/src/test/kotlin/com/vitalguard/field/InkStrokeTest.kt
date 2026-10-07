package com.vitalguard.field

// Ports: ink_stroke_test.dart / ink_upload_test.dart. 획 삭제·옛 초안·바이트 한도.
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

private fun line(y: Double, tool: InkTool = InkTool.pen, width: Double = .004) =
    InkStroke(tool, 0xFF171717, width, listOf(InkPoint(.1, y, .5), InkPoint(.9, y, .5)))
private fun eraser(vararg points: InkPoint, width: Double = .028) = InkStroke(InkTool.eraser, 0, width, points.toList())
class InkStrokeTest {
    @Test fun eraseSweepsIntersectionsBetweenSparsePointsAndDeletesWholeStrokes() {
        val last = line(.9); val first = line(.3); val list = mutableListOf(first, line(.6), last)
        assertTrue(eraseInkStrokes(list, eraser(InkPoint(.5,.2), InkPoint(.5,.7)), InkSize(1000.0,650.0)))
        assertEquals(listOf(last), list); assertEquals(2, first.points.size)
    }
    @Test fun eraserRadiusUsesImageWidthInBothAxes() {
        for (size in listOf(InkSize(1000.0,250.0), InkSize(250.0,1000.0))) {
            val scale = size.width / size.height
            assertTrue(eraseInkStrokes(mutableListOf(line(.5)), eraser(InkPoint(.5,.5+.009*scale,.2), width=.02), size))
            assertFalse(eraseInkStrokes(mutableListOf(line(.5)), eraser(InkPoint(.5,.5+.02*scale), width=.02), size))
        }
    }
    @Test fun rectangleHitTestsItsFourEdgesNotItsInterior() {
        val rect = InkStroke(InkTool.rectangle, 0, .004, listOf(InkPoint(.2,.2), InkPoint(.8,.8)))
        val list = mutableListOf(rect); val size = InkSize(1000.0,1000.0)
        assertFalse(eraseInkStrokes(list, eraser(InkPoint(.5,.5)), size))
        assertTrue(eraseInkStrokes(list, eraser(InkPoint(.2,.5)), size))
    }
    @Test fun dotsRepeatedPointsMarkerThicknessAndSegmentEndsAreIncluded() {
        val dot = line(.5).copy(points=listOf(InkPoint(.5,.5,.5)))
        val repeated = dot.copy(points=listOf(InkPoint(.5,.5),InkPoint(.5,.5)))
        val marker = line(.5, InkTool.marker,.04).copy(points=listOf(InkPoint(.2,.5),InkPoint(.8,.5)))
        val list= mutableListOf(dot,repeated,marker); val size=InkSize(1000.0,1000.0)
        assertTrue(eraseInkStrokes(list, eraser(InkPoint(.5,.535),width=.02),size)); assertEquals(listOf(dot,repeated),list)
        assertTrue(eraseInkStrokes(list, eraser(InkPoint(.5,.5)),size)); assertTrue(list.isEmpty())
        assertFalse(eraseInkStrokes(mutableListOf(line(.5)), eraser(InkPoint(.93,.5)),size))
        assertTrue(eraseInkStrokes(mutableListOf(line(.5)), eraser(InkPoint(.91,.5)),size))
    }
    @Test fun legacyErasersApplyPressureInTimeOrderAndNeverSerializeAsStrokes() {
        val saved=listOf(line(.5),line(.8),eraser(InkPoint(.5,.519)),line(.5))
        val result=restoreInkStrokes(saved,InkSize(1000.0,1000.0))
        assertEquals(listOf(line(.8),line(.5)),result)
        assertFalse(encodeInk(result).toString(Charsets.UTF_8).contains("eraser"))
        assertThrows(IllegalStateException::class.java) { encodeInk(saved) }
    }
    @Test fun versionOneRoundTripAndExactTwoMiBLimit() {
        assertEquals(mapOf("v" to 1, "strokes" to emptyList<Any>()), Json.decodeObject(encodeInk(emptyList()).toString(Charsets.UTF_8)))
        val stroke=line(.25); assertEquals(stroke,InkStroke.fromJson(Json.decodeObject(Json.encode(stroke.toJson()))))
        assertNull(inkUploadSizeError(maxInkUploadBytes)); assertTrue(inkUploadSizeError(maxInkUploadBytes+1)!!.contains("2,097,152"))
    }
    @Test fun inputCoordinatesAndPressureUseOriginalPrecision() {
        val rect=InkRect(10.0,20.0,1000.0,500.0)
        assertEquals(InkPoint(.1235,.2346,.46),rect.point(InkOffset(133.45,137.28),.455))
        assertEquals(1.0,rect.point(InkOffset(50.0,50.0),2.0)!!.pressure,0.0)
        assertNull(rect.point(InkOffset(9.0,20.0),1.0))
    }
    @Test fun roundedHundredStrokesWithFourHundredPointsFitUploadLimit() {
        val random=Random(127); val rect=InkRect(0.0,0.0,1000.0,1000.0)
        val strokes=List(100) { line(.5).copy(points=List(400) { rect.point(InkOffset(random.nextDouble()*1000,random.nextDouble()*1000),random.nextDouble())!! }) }
        assertTrue(encodeInk(strokes).size<=maxInkUploadBytes)
    }
}

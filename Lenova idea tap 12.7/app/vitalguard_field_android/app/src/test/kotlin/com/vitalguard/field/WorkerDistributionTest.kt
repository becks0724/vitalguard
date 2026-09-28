package com.vitalguard.field

import com.vitalguard.field.data.models.*
import org.junit.Assert.*
import org.junit.Test

class WorkerDistributionTest {
    private fun workers(total: Int?, normal: Int?, caution: Int?, danger: Int?, waiting: Int?) = SiteStatusWorkers(mapOf(
        "ok" to true, "level" to "normal", "total" to total, "normal" to normal,
        "caution" to caution, "danger" to danger, "waiting" to waiting))

    @Test fun eachPersonOccupiesOneShareOfTheReportedTotal() {
        val d = workerDistribution(workers(10, 5, 2, 1, 2))
        assertTrue(d.complete)
        assertEquals(listOf(5, 2, 1, 2), d.shares.map { it.count })
        assertEquals(.1f, d.shares.single { it.bucket == WorkerBucket.danger }.fraction, .00001f)
        assertEquals(1f, d.shares.sumOf { it.fraction.toDouble() }.toFloat(), .00001f)
    }
    @Test fun aNewDangerWorkerChangesTheDenominatorInsteadOfAddingAnArbitraryArc() {
        val d = workerDistribution(workers(11, 5, 2, 2, 2))
        assertEquals(2f / 11f, d.shares.single { it.bucket == WorkerBucket.danger }.fraction, .00001f)
        assertEquals(5f / 11f, d.shares.single { it.bucket == WorkerBucket.normal }.fraction, .00001f)
    }
    @Test fun missingCountsRemainUnclassifiedAndAreNotFilledAsNormal() {
        val d = workerDistribution(workers(10, null, 1, 1, 1))
        assertFalse(d.complete); assertEquals(7, d.unclassified)
        assertFalse(d.shares.any { it.bucket == WorkerBucket.normal })
        assertEquals(.3f, d.shares.sumOf { it.fraction.toDouble() }.toFloat(), .00001f)
        assertTrue(workerDistribution(workers(null, 5, 2, 1, 2)).shares.isEmpty())
    }
    @Test fun contradictoryCountsAndOverflowNeverCreateOverfullGauges() {
        for (d in listOf(workerDistribution(workers(2, 2, 2, 0, 0)),
            workerDistribution(workers(Int.MAX_VALUE, Int.MAX_VALUE, 0, Int.MAX_VALUE, 0)))) {
            assertFalse(d.complete); assertTrue(d.shares.isEmpty()); assertNull(d.unclassified)
        }
    }
    @Test fun zeroWorkersAndUnavailablePayloadDoNotBecomeHealthyOrDivideByZero() {
        val zero = workerDistribution(workers(0, 0, 0, 0, 0))
        assertTrue(zero.complete); assertTrue(zero.shares.isEmpty())
        val absent = workerDistribution(null)
        assertNull(absent.total); assertFalse(absent.complete); assertTrue(absent.shares.isEmpty())
    }
}

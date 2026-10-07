package com.vitalguard.field.data.models

enum class WorkerBucket(val label: String) { normal("정상"), caution("주의"), danger("위험"), waiting("미수신") }
data class WorkerShare(val bucket: WorkerBucket, val count: Int, val fraction: Float)
data class WorkerDistribution(val total: Int?, val shares: List<WorkerShare>, val unclassified: Int?, val complete: Boolean)

/** Shares use the reported total; missing/contradictory counts never become healthy workers. */
fun workerDistribution(data: SiteStatusWorkers?): WorkerDistribution {
    if (data?.ok != true) return WorkerDistribution(null, emptyList(), null, false)
    val total = data.total ?: return WorkerDistribution(null, emptyList(), null, false)
    val counts = listOf(WorkerBucket.normal to data.normal, WorkerBucket.caution to data.caution,
        WorkerBucket.danger to data.danger, WorkerBucket.waiting to data.waiting)
    val sum = counts.sumOf { it.second?.toLong() ?: 0L }
    if (sum > total.toLong()) return WorkerDistribution(total, emptyList(), null, false)
    val remainder = total - sum.toInt()
    val shares = if (total == 0) emptyList() else counts.mapNotNull { (bucket, count) ->
        count?.takeIf { it > 0 }?.let { WorkerShare(bucket, it, it.toFloat() / total) }
    }
    return WorkerDistribution(total, shares, remainder, counts.all { it.second != null } && remainder == 0)
}

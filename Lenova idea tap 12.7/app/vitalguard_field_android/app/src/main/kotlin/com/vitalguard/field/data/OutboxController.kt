package com.vitalguard.field.data

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Port: lib/data/outbox_controller.dart. Android API 없는 원장/전송 상태 머신.
const val outboxStorageKey = "outbox:v1"
const val localSavedLabel = "로컬 저장됨 · 서버 미전송"
const val serverCompletedLabel = "전송 완료 · 서버 확인됨"
const val mockCompletedLabel = "모의 전송 완료 — 실제 서버로 보내지 않았습니다"
const val operationLookupBatchSize = 50

enum class OutboxKind { photo, ink, voice, text }
enum class OutboxPhase { waiting, sending, failed, uncertain, reauthenticate, completed }

// 값 스냅숏을 교체하여 StateFlow의 동등성 비교에도 모든 상태 변경이 전달된다.
data class OutboxEntry(
    val id: String,
    val owner: String,
    val kind: OutboxKind,
    val fields: Map<String, String>,
    val siteName: String,
    val createdAt: Instant,
    val mock: Boolean,
    val sourceKey: String? = null,
    val annotationDraftId: String? = null,
    val dependsOn: String? = null,
    val completedAt: Instant? = null,
    val draftKeys: List<String> = emptyList(),
    val phase: OutboxPhase = OutboxPhase.waiting,
    val message: String? = null,
    val receipt: JsonObject? = null,
    val deduplicated: Boolean = false,
    val needsVerification: Boolean = false,
) {
    val bytesKey get() = "outbox-file:$id"
    val siteId get() = fields["siteId"]
    val siteGroup get() = "${siteId.orEmpty()}\n$siteName"
    val kindLabel get() = when (kind) {
        OutboxKind.photo -> "사진"
        OutboxKind.ink -> "잉크본"
        OutboxKind.voice -> "음성 댓글"
        OutboxKind.text -> "메모"
    }
    val statusLabel get() = when (phase) {
        OutboxPhase.waiting -> "$localSavedLabel · 대기"
        OutboxPhase.sending -> "로컬 저장됨 · 처리 중"
        OutboxPhase.failed -> "로컬 저장됨 · 전송 실패"
        OutboxPhase.uncertain -> "로컬 저장됨 · 서버 결과 불명"
        OutboxPhase.reauthenticate -> "로컬 저장됨 · 재로그인 필요"
        OutboxPhase.completed -> if (mock) mockCompletedLabel else serverCompletedLabel
    }
    fun toJson(): JsonObject = linkedMapOf(
        "id" to id, "owner" to owner, "kind" to kind.name, "fields" to fields,
        "siteName" to siteName, "createdAt" to createdAt.toString(), "mock" to mock,
        "sourceKey" to sourceKey, "annotationDraftId" to annotationDraftId,
        "dependsOn" to dependsOn, "completedAt" to completedAt?.toString(), "draftKeys" to draftKeys,
        "phase" to phase.name, "message" to message, "receipt" to receipt,
        "deduplicated" to deduplicated, "needsVerification" to needsVerification,
    )
    companion object {
        fun fromJson(json: JsonObject) = OutboxEntry(
            id = json["id"] as String, owner = json["owner"] as String,
            kind = OutboxKind.valueOf(json["kind"] as String),
            fields = requireNotNull(json["fields"].jsonObjectOrNull()).mapValues { it.value as String },
            siteName = json["siteName"] as String, createdAt = parseInstant(json["createdAt"] as String),
            mock = json["mock"] as Boolean, sourceKey = json["sourceKey"] as String?,
            annotationDraftId = json["annotationDraftId"] as String?, dependsOn = json["dependsOn"] as String?,
            completedAt = (json["completedAt"] as String?)?.let(::parseInstant),
            draftKeys = (json["draftKeys"] as? List<*>)?.map { it as String }.orEmpty(),
            phase = OutboxPhase.valueOf(json["phase"] as String), message = json["message"] as String?,
            receipt = json["receipt"].jsonObjectOrNull(), deduplicated = json["deduplicated"] == true,
            needsVerification = json["needsVerification"] == true,
        )
    }
}

class OutboxController(
    val field: FieldController,
    scope: CoroutineScope,
    private val clock: Clock = Clock.systemUTC(),
    private val uuid: () -> String = { UUID.randomUUID().toString() },
) : AutoCloseable {
    private val accounts = ConcurrentHashMap<String, List<OutboxEntry>>()
    private val inflight = ConcurrentHashMap.newKeySet<String>()
    private val bundleSends = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    // 재시작하면 사라지는 명시적 재시도 자격. 디스크에는 저장하지 않는다.
    private val retryableUncertain = ConcurrentHashMap.newKeySet<String>()
    private val lookupRunning = AtomicBoolean(false)
    private var lookupOwner: String? = null
    private var lastLookupMessage: String? = null
    private val lastAutomaticLookup = ConcurrentHashMap<String, Instant>()
    private val loadErrors = ConcurrentHashMap<String, String>()
    private val writes = Mutex()
    private var disposed = false
    private val mutableItems = MutableStateFlow<List<OutboxEntry>>(emptyList())
    val items: StateFlow<List<OutboxEntry>> = mutableItems.asStateFlow()
    private val mutableChecking = MutableStateFlow(false)
    val checking = mutableChecking.asStateFlow()
    private val mutableLookupMessage = MutableStateFlow<String?>(null)
    val lookupMessage = mutableLookupMessage.asStateFlow()
    private val mutableLoadError = MutableStateFlow<String?>(null)
    val loadError = mutableLoadError.asStateFlow()
    private val mutableBusyIds = MutableStateFlow<Set<String>>(emptySet())
    val busyIds = mutableBusyIds.asStateFlow()
    // absent 자격만 바뀌어도 UI가 다시 읽을 수 있게 한다.
    private val mutableRetryableIds = MutableStateFlow<Set<String>>(emptySet())
    val retryableIds = mutableRetryableIds.asStateFlow()
    val account get() = field.state.value.takeIf { it.authStage == AuthStage.ready }?.user?.id
    val supportedLookup get() = field.operationLookupAvailable
    private val observer = scope.launch { field.state.collect { notifyState() } }
    private fun key(item: OutboxEntry) = "${item.owner}:${item.id}"
    private fun current(item: OutboxEntry) = accounts[item.owner]?.firstOrNull { it.id == item.id }
    private fun owned(item: OutboxEntry) = !disposed && item.owner == account && item.mock == field.isMock && current(item) != null
    fun entry(id: String?) = account?.let { accounts[it] }?.firstOrNull { it.id == id }
    fun dependents(photoId: String) = account?.let { accounts[it] }.orEmpty().filter { it.dependsOn == photoId }.sortedBy { it.createdAt }
    fun parentOf(item: OutboxEntry) = entry(item.dependsOn)?.takeIf { it.kind == OutboxKind.photo && it.owner == item.owner }
    fun bundleCompleted(photoId: String) = entry(photoId)?.let { it.kind == OutboxKind.photo && it.phase == OutboxPhase.completed } == true &&
        dependents(photoId).all { it.phase == OutboxPhase.completed }
    fun isBusy(item: OutboxEntry) = inflight.contains(key(item))
    fun canRetryUncertain(item: OutboxEntry) = owned(item) && current(item)?.phase == OutboxPhase.uncertain && retryableUncertain.contains(key(item))

    private fun notifyState() {
        if (disposed) return
        val owner = account
        mutableItems.value = (owner?.let { accounts[it] }).orEmpty().toList()
        mutableChecking.value = lookupRunning.get() && lookupOwner == owner
        mutableLookupMessage.value = lastLookupMessage.takeIf { lookupOwner == owner }
        mutableLoadError.value = owner?.let { loadErrors[it] }
        mutableBusyIds.value = (owner?.let { accounts[it] }).orEmpty().filter(::isBusy).map { it.id }.toSet()
        mutableRetryableIds.value = (owner?.let { accounts[it] }).orEmpty().filter(::canRetryUncertain).map { it.id }.toSet()
    }
    private suspend fun write(owner: String, entries: List<OutboxEntry>) = field.local.write(owner, outboxStorageKey,
        Json.encode(mapOf("schemaVersion" to 1, "items" to entries.map(OutboxEntry::toJson))))

    // 호출자가 writes를 보유한다. 한 저장 실패가 다음 큐 작업을 막지 않는다.
    private suspend fun loadOwner(owner: String) {
        if (accounts.containsKey(owner)) return
        val raw = field.local.read(owner, outboxStorageKey)
        val entries = if (raw == null) emptyList() else (Json.decodeObject(raw)["items"] as List<*>).map {
            OutboxEntry.fromJson(requireNotNull(it.jsonObjectOrNull()))
        }
        require(entries.none { it.owner != owner || it.fields["clientOperationId"] != it.id }) { "전송 원장의 계정 또는 작업 ID 불일치" }
        val recovered = entries.map {
            if (it.phase == OutboxPhase.sending) it.copy(phase = OutboxPhase.uncertain, needsVerification = true,
                message = "앱 종료 당시 처리 중이었습니다. 서버 반영 여부를 먼저 확인해 주세요.") else it
        }
        write(owner, recovered) // 복구 저장이 실패하면 메모리 원장도 열지 않는다.
        accounts[owner] = recovered
    }
    suspend fun load() {
        val owner = account ?: return
        try {
            writes.withLock { loadOwner(owner) }
            if (owner == account) purgeExpired()
            writes.withLock {
                val legacyKey = "outbox:legacy-cache-cleaned:r7"
                if (field.local.read(owner, legacyKey) == null) {
                    field.local.keys(owner).filter { it.startsWith("calendar:") || it.startsWith("photo:") || it.startsWith("published:") }
                        .forEach { field.local.remove(owner, it) }
                    field.local.write(owner, legacyKey, "done")
                }
            }
            loadErrors.remove(owner)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { loadErrors[owner] = "전송 원장을 읽지 못했습니다. 기기 파일은 보존됩니다. 다시 열어 주세요." }
        notifyState()
    }

    suspend fun enqueue(
        kind: OutboxKind, bytes: ByteArray, fields: Map<String, String>, siteName: String,
        owner: String? = null, sourceKey: String? = null, annotationDraftId: String? = null,
        dependsOn: String? = null, draftKeys: List<String> = emptyList(), previewBytes: ByteArray? = null,
    ): OutboxEntry {
        require(dependsOn == null || listOf("annotationOf", "commentOf", "mediaId").none(fields::containsKey)) {
            "딸린 항목의 서버 참조는 전송 시 원본 사진에서 채웁니다"
        }
        val author = owner ?: account
        val payload = bytes.copyOf()
        val preview = previewBytes?.copyOf()
        val drafts = draftKeys.toList()
        val metadata = fields.toMutableMap().apply { remove("clientOperationId") }
        return writes.withLock {
            if (author == null || author != account) throw ApiFailure("작성 계정으로 다시 로그인해 주세요", action = "reauth")
            loadOwner(author)
            if (author != account) throw ApiFailure("로그인 상태가 바뀌었습니다", action = "reauth")
            val entries = accounts.getValue(author)
            if (dependsOn != null) entries.firstOrNull { it.id == dependsOn && it.kind == OutboxKind.photo }?.let {
                metadata.remove("siteId")
                it.siteId?.let { site -> metadata["siteId"] = site }
            }
            val previous = sourceKey?.let { entries.lastOrNull { e -> e.sourceKey == sourceKey && e.kind == kind &&
                e.dependsOn == dependsOn && e.draftKeys == drafts } }
            if (previous != null && metadata == previous.fields - "clientOperationId" &&
                field.local.readBytes(author, previous.bytesKey)?.contentEquals(payload) == true) return@withLock previous
            val id = uuid()
            val entry = OutboxEntry(id, author, kind, metadata + ("clientOperationId" to id), siteName, clock.instant(), field.isMock,
                sourceKey = sourceKey, annotationDraftId = annotationDraftId, dependsOn = dependsOn, draftKeys = drafts)
            field.local.writeBytes(author, entry.bytesKey, payload)
            if (preview != null) field.local.writeBytes(author, "outbox-preview:$id", preview)
            val next = entries + entry
            write(author, next) // 바이트 저장 후 원장 원자 교체. 이 경로에서는 HTTP를 호출하지 않는다.
            accounts[author] = next
            notifyState()
            entry
        }
    }

    private suspend fun save(item: OutboxEntry) = writes.withLock {
        accounts[item.owner] = accounts.getValue(item.owner).map { if (it.id == item.id) item else it }
        // 실패 상태도 메모리에 남긴다. 최종 저장 실패 시 바이트 정리는 하지 않는다.
        write(item.owner, accounts.getValue(item.owner))
        notifyState()
    }
    suspend fun send(request: OutboxEntry, retry: Boolean = false) {
        var item = current(request) ?: return
        val explicitUncertainRetry = retry && canRetryUncertain(item)
        if (!owned(item) || isBusy(item) || item.phase in setOf(OutboxPhase.completed, OutboxPhase.sending) ||
            ((item.needsVerification || item.phase == OutboxPhase.uncertain) && !explicitUncertainRetry)) return
        val parent = parentOf(item)
        if (item.dependsOn != null) {
            if (parent == null) { save(item.copy(phase = OutboxPhase.failed, message = "원본 사진 항목이 없습니다")); return }
            if (parent.phase != OutboxPhase.completed) { sendBundle(parent.id, retry); return }
            if (parent.receipt?.get("id") !is String) {
                save(item.copy(phase = OutboxPhase.waiting, message = "원본 사진 결과 확인 후 전송됩니다")); return
            }
        }
        if (field.state.value.offline && !retry) {
            save(item.copy(message = "오프라인입니다. 연결 후 전송 상태에서 전송/재시도를 눌러 주세요.")); return
        }
        val itemKey = key(item)
        // discard와 전송 시작의 경쟁도 동일 Mutex로 직렬화한다.
        val claimed = writes.withLock {
            val latest = current(item)
            if (latest == null || !owned(latest) || latest.phase in setOf(OutboxPhase.completed, OutboxPhase.sending) ||
                ((latest.needsVerification || latest.phase == OutboxPhase.uncertain) && !(retry && canRetryUncertain(latest)))) false
            else { item = latest; inflight.add(itemKey) }
        }
        if (!claimed) return
        retryableUncertain.remove(itemKey)
        notifyState()
        var submitted = false
        try {
            val bytes = field.local.readBytes(item.owner, item.bytesKey) ?: throw ApiFailure("보관 파일을 읽을 수 없습니다", status = 400)
            if (!owned(item)) return
            val fields = if (item.kind == OutboxKind.ink && parent != null)
                annotationFields(CalendarMedia(fromOutbox(parent).json + parent.receipt.orEmpty())) + item.fields + ("clientOperationId" to item.id)
                else item.fields
            val mediaId = parent?.receipt?.get("id") as? String ?: item.fields[if (item.kind == OutboxKind.text) "mediaId" else "commentOf"]
            val body = if (item.kind == OutboxKind.text) Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString() else null
            if (item.kind == OutboxKind.text && mediaId == null) throw ApiFailure("원본 사진 항목이 없습니다", status = 400)
            item = item.copy(phase = OutboxPhase.sending, message = null)
            save(item) // sending 영속화에 실패하면 HTTP 금지.
            if (!owned(item)) { item = item.copy(phase = OutboxPhase.reauthenticate); return }
            submitted = true
            val receipt: JsonObject
            val deduplicated: Boolean
            when (item.kind) {
                OutboxKind.voice -> {
                    val result = field.voiceComment(requireNotNull(mediaId), bytes, item.fields["audioMs"]?.toIntOrNull(), item.id, item.siteId)
                    receipt = result.json; deduplicated = result.deduplicated
                }
                OutboxKind.text -> {
                    val result = field.comment(requireNotNull(mediaId), requireNotNull(body), item.id)
                    receipt = result.json; deduplicated = result.deduplicated
                }
                else -> { val result = field.publish(bytes, fields); receipt = result.json; deduplicated = result.deduplicated }
            }
            item = item.copy(receipt = receipt, deduplicated = deduplicated, phase = OutboxPhase.completed, completedAt = clock.instant(),
                needsVerification = false, message = if (deduplicated) "같은 작업이 이미 서버에 있습니다. 서버 확인됨." else null)
        } catch (error: Exception) {
            val api = error as? ApiFailure
            val unknown = if (api == null) submitted else api.uncertainWrite || (submitted && (api.status ?: 0) >= 500)
            val explanation = when (api?.status) {
                401 -> "로그인이 만료되었습니다. 다시 로그인해 주세요."
                403 -> "이 기록을 전송할 권한이 없습니다."
                404 -> "원본 사진을 찾을 수 없습니다. 삭제 여부를 확인해 주세요."
                else -> null
            }
            item = item.copy(needsVerification = unknown, phase = when {
                api?.action == "reauth" || api?.status == 401 -> OutboxPhase.reauthenticate
                unknown -> OutboxPhase.uncertain
                else -> OutboxPhase.failed
            }, message = if (explanation != null) "$explanation\n${api!!.message}" else api?.message
                ?: "전송 상태를 확인하지 못했습니다. 서버 반영 여부를 먼저 확인해 주세요.")
            if (error is CancellationException) throw error
        } finally {
            withContext(NonCancellable) {
                try {
                    if (item.dependsOn == null) cacheInkReceipt(item)
                    save(item)
                    cleanupCompletedItem(item)
                } catch (_: Exception) {
                    accounts[item.owner] = accounts.getValue(item.owner).map {
                        if (it.id == item.id) item.copy(message = "전송 상태의 기기 저장 실패 · 서버 반영 여부를 확인해 주세요.") else it
                    }
                }
                inflight.remove(itemKey)
                notifyState()
            }
        }
    }

    suspend fun sendBundle(photoId: String, retry: Boolean = false) {
        val photo = entry(photoId)?.takeIf { it.kind == OutboxKind.photo && owned(it) } ?: return
        val task = CompletableDeferred<Unit>()
        val taskKey = key(photo)
        val previous = bundleSends.putIfAbsent(taskKey, task)
        if (previous != null) { previous.await(); return }
        try {
            if (photo.phase != OutboxPhase.completed) send(photo, retry)
            if (current(photo)?.phase != OutboxPhase.completed) {
                writes.withLock {
                    val entries = accounts.getValue(photo.owner).map {
                        if (it.dependsOn == photo.id && it.phase != OutboxPhase.completed)
                            it.copy(message = "원본 사진 결과 확인 후 전송됩니다") else it
                    }
                    accounts[photo.owner] = entries
                    write(photo.owner, entries)
                    notifyState()
                }
            } else if (owned(photo)) {
                for (child in dependents(photo.id)) {
                    if (!owned(photo)) break
                    if (child.phase != OutboxPhase.completed) send(child, retry)
                }
                cleanupBundle(photo.id)
            }
            task.complete(Unit)
        } catch (error: Throwable) { task.completeExceptionally(error); throw error
        } finally { bundleSends.remove(taskKey, task) }
    }
    private suspend fun removeFiles(item: OutboxEntry) {
        val keys = linkedSetOf(item.bytesKey, "outbox-preview:${item.id}").apply {
            addAll(item.draftKeys)
            (item.receipt?.get("id") as? String)?.let { add("photo:$it"); add("published:$it") }
        }
        keys.forEach { field.local.remove(item.owner, it) }
    }
    suspend fun cleanupBundle(photoId: String) {
        val owner = account
        writes.withLock {
            if (owner == null || owner != account || !bundleCompleted(photoId)) return@withLock
            write(owner, accounts.getValue(owner)) // 영수증 영속화보다 먼저 바이트를 지우지 않는다.
            (listOfNotNull(entry(photoId)) + dependents(photoId)).forEach { removeFiles(it) }
            clearLocalRecordDrafts(field, photoId, owner)
        }
    }
    private suspend fun cleanupCompletedItem(item: OutboxEntry) {
        if (!owned(item) || item.phase != OutboxPhase.completed) return
        when {
            item.dependsOn != null -> cleanupBundle(item.dependsOn)
            item.kind == OutboxKind.photo && dependents(item.id).isNotEmpty() -> cleanupBundle(item.id)
        }
        // 기존 단독 send(photo)는 바이트를 유지한다. 화면에서는 sendBundle을 사용한다.
    }
    suspend fun clearCompletedDrafts() {
        items.value.filter { it.kind == OutboxKind.photo && bundleCompleted(it.id) }.forEach { cleanupBundle(it.id) }
    }
    suspend fun discard(id: String) {
        val owner = account
        writes.withLock {
            check(owner != null && owner == account) { "작성 계정이 필요합니다" }
            loadOwner(owner)
            check(owner == account) { "로그인 상태가 바뀌었습니다" }
            val item = entry(id) ?: error("전송함 항목이 없습니다")
            val targets = listOf(item) + if (item.kind == OutboxKind.photo) dependents(id) else emptyList()
            check(targets.none { !owned(it) || isBusy(it) || it.phase !in setOf(OutboxPhase.waiting, OutboxPhase.failed) }) {
                "대기 또는 실패한 항목만 삭제할 수 있습니다"
            }
            val busyKeys = targets.map(::key).toSet()
            inflight.addAll(busyKeys)
            try {
                targets.forEach { removeFiles(it) }
                if (item.kind == OutboxKind.photo) clearLocalRecordDrafts(field, item.id, owner)
                val ids = targets.map { it.id }.toSet()
                val next = accounts.getValue(owner).filterNot { it.id in ids }
                write(owner, next)
                accounts[owner] = next
                retryableUncertain.removeAll(busyKeys)
            } finally { inflight.removeAll(busyKeys); notifyState() }
        }
    }
    suspend fun purgeExpired(keep: Duration = Duration.ofDays(7), now: Instant = clock.instant()): Int {
        val owner = account
        return writes.withLock {
            if (owner == null || owner != account) return@withLock 0
            loadOwner(owner)
            if (owner != account) return@withLock 0
            val entries = accounts.getValue(owner)
            val expired = entries.filter { it.phase == OutboxPhase.completed && !isBusy(it) &&
                (it.completedAt ?: it.createdAt).plus(keep).isBefore(now) }
            if (expired.isEmpty()) return@withLock 0
            expired.forEach {
                removeFiles(it)
                if (it.kind == OutboxKind.photo) clearLocalRecordDrafts(field, it.id, owner)
            }
            val next = entries - expired.toSet()
            write(owner, next); accounts[owner] = next; notifyState()
            expired.size
        }
    }
    private fun checkable(item: OutboxEntry) = owned(item) && !isBusy(item) && current(item)?.phase == OutboxPhase.uncertain
    suspend fun verify(item: OutboxEntry, shouldContinue: () -> Boolean = { true }) = verifyItems(listOf(item), shouldContinue)
    suspend fun verifyUncertain(automatic: Boolean = false, shouldContinue: () -> Boolean = { true }) {
        val owner = account ?: return
        if (!supportedLookup || lookupRunning.get() || !shouldContinue()) return
        val candidates = items.value.filter(::checkable)
        if (candidates.isEmpty()) return
        if (automatic) {
            val now = clock.instant()
            val last = lastAutomaticLookup[owner]
            if (last != null && Duration.between(last, now) < Duration.ofSeconds(30)) return
            lastAutomaticLookup[owner] = now
        }
        verifyItems(candidates, shouldContinue)
    }
    private suspend fun verifyItems(candidates: List<OutboxEntry>, shouldContinue: () -> Boolean) {
        val owner = account ?: return
        if (!supportedLookup || !shouldContinue()) return
        val pending = candidates.mapNotNull(::current).filter(::checkable)
        if (pending.isEmpty() || !lookupRunning.compareAndSet(false, true)) return
        lookupOwner = owner
        lastLookupMessage = "서버 상태 조회 중 · 결과 불명 ${pending.size}건"
        notifyState()
        var confirmed = 0
        var unresolved = 0
        try {
            for ((index, portion) in pending.chunked(operationLookupBatchSize).withIndex()) {
                if (disposed || owner != account || !shouldContinue()) {
                    lastLookupMessage = "서버 조회 중단 · 남은 결과 불명 항목은 화면에서 다시 조회해 주세요."; break
                }
                val batch = writes.withLock {
                    portion.mapNotNull(::current).filter(::checkable).onEach {
                        inflight.add(key(it)); retryableUncertain.remove(key(it))
                    }.toMutableList()
                }
                if (batch.isEmpty()) continue
                val offset = index * operationLookupBatchSize
                lastLookupMessage = "서버 상태 조회 중 · ${offset + 1}~${offset + batch.size}/${pending.size}건"
                batch.indices.forEach { i -> batch[i] = batch[i].copy(needsVerification = true, message = "서버 상태 조회 중 · 전송 결과를 확인하고 있습니다.") }
                replaceInMemory(owner, batch)
                notifyState()
                var failed = false
                try {
                    val results = field.lookupOperations(batch.map { it.id })
                    if (disposed || owner != account) return
                    batch.indices.forEach { i ->
                        val item = batch[i]
                        val result = results[item.id] ?: OperationCheck(OperationPresence.unknown)
                        batch[i] = when (result.presence) {
                            OperationPresence.confirmed -> {
                                confirmed++
                                item.copy(phase = OutboxPhase.completed, completedAt = clock.instant(), receipt = item.receipt ?: result.receipt,
                                    deduplicated = result.deduplicated, needsVerification = false, message = "서버 재조회로 확인했습니다.")
                            }
                            OperationPresence.absent -> {
                                unresolved++; retryableUncertain.add(key(item))
                                item.copy(message = "조회 시점에는 미등록입니다. 기존 전송이 처리 중일 수 있어 결과 불명을 유지합니다. 필요하면 같은 작업 재시도를 눌러 주세요. 자동 재전송하지 않습니다.")
                            }
                            OperationPresence.unknown -> {
                                unresolved++
                                item.copy(message = "서버 반영 여부를 확인하지 못했습니다. 서버 상태를 다시 조회해 주세요. 자동 재전송하지 않습니다.")
                            }
                        }
                    }
                    lastLookupMessage = "서버 조회 완료 · 서버 확인됨 ${confirmed}건 · 결과 불명 ${unresolved}건. 남은 항목은 다시 조회하거나 미등록 조회 후 같은 작업 재시도를 눌러 주세요."
                } catch (error: Exception) {
                    failed = true
                    val reason = when ((error as? ApiFailure)?.status) {
                        401 -> "로그인이 만료되었습니다. 다시 로그인한 뒤 조회해 주세요."
                        403 -> "서버 상태를 조회할 권한이 없습니다. 관리자에게 문의해 주세요."
                        400 -> "조회 요청을 확인할 수 없습니다. 앱의 작업 ID를 확인해 주세요."
                        503 -> "서버 DB 장애로 상태를 확인하지 못했습니다. 잠시 후 다시 조회해 주세요."
                        else -> "연결 또는 서버 응답을 확인하지 못했습니다. 연결 후 다시 조회해 주세요."
                    }
                    lastLookupMessage = "서버 조회 실패 · $reason 결과 불명을 유지하며 자동 재전송하지 않습니다."
                    batch.indices.forEach { i -> batch[i] = batch[i].copy(message = lastLookupMessage) }
                    if (error is CancellationException) throw error
                } finally {
                    withContext(NonCancellable) {
                        try {
                            batch.filter { it.dependsOn == null }.forEach { cacheInkReceipt(it) }
                            writes.withLock { replaceInMemory(owner, batch); write(owner, accounts.getValue(owner)) }
                            batch.forEach { cleanupCompletedItem(it) }
                        } catch (_: Exception) {
                            failed = true
                            lastLookupMessage = "조회 상태의 기기 저장 실패 · 서버 상태를 다시 조회해 주세요."
                            batch.indices.forEach { i ->
                                retryableUncertain.remove(key(batch[i])); batch[i] = batch[i].copy(message = lastLookupMessage)
                            }
                            replaceInMemory(owner, batch)
                        } finally { batch.forEach { inflight.remove(key(it)) }; notifyState() }
                    }
                }
                if (failed) break // 503/잘못된 응답은 absent가 아니다. 남은 배치도 중단.
            }
        } finally { lookupRunning.set(false); notifyState() }
    }
    private fun replaceInMemory(owner: String, changed: List<OutboxEntry>) {
        val byId = changed.associateBy { it.id }
        accounts[owner] = accounts.getValue(owner).map { byId[it.id] ?: it }
    }
    private suspend fun cacheInkReceipt(item: OutboxEntry) {
        val id = item.receipt?.get("id") as? String ?: return
        if (item.phase != OutboxPhase.completed || item.annotationDraftId == null) return
        field.local.write(item.owner, "published:$id", item.annotationDraftId)
        field.local.readBytes(item.owner, "outbox-preview:${item.id}")?.let { field.local.writeBytes(item.owner, "photo:$id", it) }
    }
    suspend fun confirmAbsent(request: OutboxEntry) {
        val item = current(request) ?: return
        if (!owned(item) || isBusy(item) || !item.needsVerification || supportedLookup) return
        save(item.copy(needsVerification = false, phase = OutboxPhase.failed,
            message = "사용자가 관제웹에서 미등록을 확인했습니다. 같은 작업 ID로 재시도합니다."))
    }
    override fun close() { disposed = true; observer.cancel() }
}

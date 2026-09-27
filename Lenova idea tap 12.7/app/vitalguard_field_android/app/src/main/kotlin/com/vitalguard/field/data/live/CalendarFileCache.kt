package com.vitalguard.field.data.live

import com.vitalguard.field.data.contracts.CalendarPhotoCache
import java.io.File
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** cacheDir 전용. 계정·미디어 ID를 분리하고 읽어도 7일 만료 시각을 연장하지 않는다. */
class CalendarFileCache(private val root: File, private val clock: Clock = Clock.systemUTC()) : CalendarPhotoCache {
    private val writes = Mutex()
    private val retention = Duration.ofDays(7).toMillis()
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
    private fun file(owner: String, id: String) = File(File(root, hash(owner)), hash(id))
    private fun purge() {
        if (!root.exists()) return
        root.walkTopDown().filter { it.isFile && (it.name.endsWith(".pending") || clock.millis() - it.lastModified() >= retention) }
            .forEach { it.delete() }
    }
    override suspend fun read(owner: String, id: String): ByteArray? = withContext(Dispatchers.IO) {
        writes.withLock { purge(); file(owner, id).takeIf { it.isFile }?.readBytes() }
    }
    override suspend fun write(owner: String, id: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        writes.withLock {
            purge()
            val target = file(owner, id)
            check(target.parentFile!!.isDirectory || target.parentFile!!.mkdirs())
            val pending = File(target.path + ".pending")
            pending.writeBytes(bytes)
            check(pending.renameTo(target)) { "사진 캐시를 저장하지 못했습니다" }
            target.setLastModified(clock.millis())
            Unit
        }
    }
    override suspend fun remove(owner: String, id: String) = withContext(Dispatchers.IO) {
        writes.withLock { file(owner, id).delete(); Unit }
    }
}

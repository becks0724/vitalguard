package com.vitalguard.field.data.live

import com.vitalguard.field.data.contracts.ApiFailure
import com.vitalguard.field.data.contracts.LocalStore
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

interface TokenBundleStorage {
    fun read(): String?
    fun write(json: String?)
}

// Port: device_services.dart. 하나의 FIFO Mutex로 읽기·쓰기·열거를 순서대로 실행.
// 토큰 암호화만 Android 포트다. 경로/순차 큐/원자 교체는 JVM에서 검증할 수 있다.
class QueuedFileStore(private val root: File, private val tokens: TokenBundleStorage) : LocalStore {
    private val queue = Mutex()
    private suspend fun <T> operation(block: () -> T): T = queue.withLock {
        withContext(Dispatchers.IO) {
            try { block() } catch (error: Exception) {
                if (error is CancellationException) throw error
                // 원인은 진단용으로만 남긴다(자격 증명·암호문은 파일 경로 오류에 들어가지 않는다).
                throw ApiFailure("기기 저장소를 사용할 수 없습니다").apply { initCause(error) }
            }
        }
    }
    private fun entries(account: String): File {
        require(account.isNotEmpty()) { "저장 소유자가 필요합니다" }
        return File(root, "accounts/" + localStorePathSegments(account).joinToString("/") + "/entries")
    }
    private fun file(account: String, key: String) =
        File(entries(account), localStorePathSegments(key).joinToString("/") + "/value")

    override suspend fun readTokenBundle() = operation { tokens.read() }
    override suspend fun writeTokenBundle(json: String?) = operation { tokens.write(json) }
    override suspend fun read(accountId: String, key: String) = readBytes(accountId, key)?.toString(Charsets.UTF_8)
    override suspend fun write(accountId: String, key: String, value: String) = writeBytes(accountId, key, value.toByteArray(Charsets.UTF_8))
    override suspend fun readBytes(accountId: String, key: String) = operation {
        file(accountId, key).let { if (it.exists()) it.readBytes() else null }
    }
    override suspend fun writeBytes(accountId: String, key: String, bytes: ByteArray) {
        val snapshot = bytes.copyOf()
        operation { atomicWrite(file(accountId, key), snapshot) }
    }
    override suspend fun remove(accountId: String, key: String) = operation {
        val entries = entries(accountId)
        val file = file(accountId, key)
        if (file.exists()) check(file.delete())
        var parent = file.parentFile
        while (parent != null && parent != entries && parent.exists() && parent.list()?.isEmpty() == true) {
            check(parent.delete())
            parent = parent.parentFile
        }
    }
    override suspend fun keys(accountId: String): List<String> = operation {
        val entries = entries(accountId)
        if (!entries.exists()) emptyList() else {
            // Files.walk는 FOLLOW_LINKS를 지정하지 않는다. pending·비정규 경로는 무시한다.
            Files.walk(entries.toPath()).use { paths ->
                paths.filter { Files.isRegularFile(it, LinkOption.NOFOLLOW_LINKS) && it.fileName.toString() == "value" }
                    .map { path ->
                        val relative = entries.toPath().relativize(path)
                        localStoreKeyFromSegments((0 until relative.nameCount - 1).map { relative.getName(it).toString() })
                    }.filter { it != null }.map { it!! }.sorted().toArray().map { it as String }
            }
        }
    }
}

internal fun atomicWrite(file: File, bytes: ByteArray, pendingName: String = file.name + ".pending") {
    val parent = requireNotNull(file.parentFile)
    check(parent.isDirectory || parent.mkdirs())
    val pending = File(parent, pendingName)
    FileOutputStream(pending).use { it.write(bytes); it.flush(); it.fd.sync() }
    check(pending.renameTo(file)) { "기기 저장소를 사용할 수 없습니다" }
}

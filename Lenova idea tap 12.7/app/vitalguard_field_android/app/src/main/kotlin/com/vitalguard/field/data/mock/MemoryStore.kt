package com.vitalguard.field.data.mock

import com.vitalguard.field.data.contracts.LocalStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

open class MemoryStore : LocalStore {
    var tokens: String? = null
    private val data = mutableMapOf<String, MutableMap<String, ByteArray>>()
    private val queue = Mutex()
    override suspend fun readTokenBundle() = queue.withLock { tokens }
    override suspend fun writeTokenBundle(json: String?) { queue.withLock { tokens = json } }
    override suspend fun read(accountId: String, key: String) = readBytes(accountId, key)?.toString(Charsets.UTF_8)
    override suspend fun write(accountId: String, key: String, value: String) = writeBytes(accountId, key, value.toByteArray(Charsets.UTF_8))
    override suspend fun readBytes(accountId: String, key: String) = queue.withLock { data[accountId]?.get(key)?.copyOf() }
    override suspend fun writeBytes(accountId: String, key: String, bytes: ByteArray) {
        queue.withLock { data.getOrPut(accountId) { mutableMapOf() }[key] = bytes.copyOf() }
    }
    override suspend fun remove(accountId: String, key: String) { queue.withLock { data[accountId]?.remove(key) } }
    override suspend fun keys(accountId: String) = queue.withLock { data[accountId]?.keys?.toList().orEmpty() }
}

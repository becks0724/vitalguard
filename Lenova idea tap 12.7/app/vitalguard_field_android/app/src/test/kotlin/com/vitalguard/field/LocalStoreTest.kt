package com.vitalguard.field

// Ports: local_store_keys_test.dart 전체, settings_test.dart의 계정별 디스크 재생성 사례(레일 키에 적용).
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.mock.MemoryStore
import java.io.File
import java.util.Base64
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LocalStoreTest {
    @get:Rule val temp = TemporaryFolder()
    @Test fun unicodeSeparatorsAndEightyCharacterBoundariesRoundTrip() {
        val key = "사진:현장 A/초안 🔎"
        assertEquals(Base64.getUrlEncoder().encodeToString(key.toByteArray()), localStorePathSegments(key).joinToString(""))
        assertEquals(key, localStoreKeyFromSegments(localStorePathSegments(key)))
        val long = "ink-draft:" + "긴 원본 키/".repeat(60)
        val parts = localStorePathSegments(long)
        assertTrue(parts.size > 2); assertTrue(parts.dropLast(1).all { it.length == 80 })
        assertTrue(parts.last().length in 1..80); assertEquals(long, localStoreKeyFromSegments(parts))
        assertEquals(1, localStorePathSegments("a".repeat(60)).size)
        assertEquals(listOf(80, 4), localStorePathSegments("a".repeat(61)).map { it.length })
    }
    @Test fun corruptNoncanonicalUtf8OrEmptySegmentsAreSkipped() {
        listOf(emptyList(), listOf(""), listOf(".."), listOf("%%%"), listOf("a"), listOf("_w=="),
            listOf("YQ"), listOf("Y", "Q=="), listOf("YQ==", "value"), listOf("YQ==", ""),
            listOf("YQ==/"), listOf("YQ==\n")).forEach { assertNull(it.toString(), localStoreKeyFromSegments(it)) }
        try { localStorePathSegments(""); fail("empty key") } catch (_: IllegalArgumentException) { }
    }
    @Test fun memoryKeysAndBytesAreAccountSeparatedCopiesAndRemovePreservesTokens() = runTest {
        val store = MemoryStore()
        store.writeTokenBundle("tokens")
        store.write("a", "메모", "안전 점검")
        val bytes = byteArrayOf(1, 2)
        store.writeBytes("a", "사진", bytes); bytes[0] = 9
        store.write("b", "메모", "기록")
        assertEquals(setOf("메모", "사진"), store.keys("a").toSet())
        val keys = store.keys("a").toMutableList(); keys.clear()
        assertEquals(2, store.keys("a").size); assertTrue(store.keys("none").isEmpty())
        assertArrayEquals(byteArrayOf(1, 2), store.readBytes("a", "사진"))
        store.remove("a", "메모"); store.remove("a", "메모"); store.remove("none", "none")
        assertNull(store.read("a", "메모")); assertEquals("기록", store.read("b", "메모")); assertEquals("tokens", store.readTokenBundle())
    }
    @Test fun diskRecreationRetainsExactPathsAndIgnoresPendingOrMalformedFiles() = runTest {
        val root = temp.newFolder()
        val tokens = object : TokenBundleStorage {
            var json: String? = null
            override fun read() = json
            override fun write(json: String?) { this.json = json }
        }
        val first = QueuedFileStore(root, tokens)
        val owner = "현장 담당관"
        val key = "shell:rail-collapsed"
        first.writeTokenBundle("tokens")
        first.write(owner, key, "true")
        val encoded = File(root, "accounts/" + localStorePathSegments(owner).joinToString("/") + "/entries")
        val exact = File(encoded, localStorePathSegments(key).joinToString("/") + "/value")
        assertEquals("true", exact.readText()); assertFalse(File(exact.path + ".pending").exists())
        File(exact.path + ".pending").writeText("partial")
        File(encoded, "%%%/value").apply { parentFile!!.mkdirs(); writeText("ignore") }
        val resumed = QueuedFileStore(root, tokens)
        assertEquals("true", resumed.read(owner, key)); assertNull(resumed.read("other", key))
        assertEquals(listOf(key), resumed.keys(owner))
        // 20회면 base64url 216자 → 80자 조각 3단계. 90회는 맥 PATH_MAX(1024)를 넘겨 mkdirs 가 실패한다(기기는 4096).
        val long = "긴 키/".repeat(20)
        val writes = (1..4).map { n -> async { resumed.write(owner, long, n.toString()) } }
        writes.forEach { it.await() }
        assertEquals("4", resumed.read(owner, long))
        resumed.remove(owner, key); resumed.remove(owner, long)
        assertTrue(resumed.keys(owner).isEmpty()); assertEquals("tokens", resumed.readTokenBundle())
    }
}

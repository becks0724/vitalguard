package com.vitalguard.field.data.cctv

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.PushbackInputStream

const val MAX_CCTV_IMAGE_BYTES = 16 * 1024 * 1024
private const val MAX_HEADERS = 64 * 1024
class CctvFailure(override val message: String) : Exception(message)

/** Finite image or the first multipart image only. Never drains a live MJPEG stream. */
fun readCctvImage(input: InputStream, contentType: String?): ByteArray {
    val type = contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
    fun finish(bytes: ByteArray): ByteArray {
        if (bytes.isEmpty()) throw CctvFailure("빈 이미지 응답입니다")
        if (bytes.size > MAX_CCTV_IMAGE_BYTES) throw CctvFailure("이미지가 수신 한도(16MB)를 초과했습니다")
        return bytes
    }
    if (type.startsWith("image/")) {
        val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) {
            val n = input.read(buffer); if (n < 0) break
            if (out.size() + n > MAX_CCTV_IMAGE_BYTES) throw CctvFailure("이미지가 수신 한도(16MB)를 초과했습니다")
            out.write(buffer, 0, n)
        }
        return finish(out.toByteArray())
    }
    if (type != "multipart/x-mixed-replace") throw CctvFailure("이미지 또는 MJPEG 응답이 아닙니다")
    val boundary = Regex("(?:^|;)\\s*boundary\\s*=\\s*(?:\"([^\"]*)\"|([^;\\s]+))", RegexOption.IGNORE_CASE)
        .find(contentType.orEmpty())?.let { it.groups[1]?.value ?: it.groups[2]?.value }
    if (boundary.isNullOrEmpty() || boundary.length > 200 || boundary.any { it.code !in 32..126 }) {
        throw CctvFailure("MJPEG boundary가 없거나 올바르지 않습니다")
    }
    var headerBytes = 0
    fun line(): String {
        val out = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) throw CctvFailure("첫 이미지 수신 전에 연결이 종료됐습니다")
            if (++headerBytes > MAX_HEADERS) throw CctvFailure("MJPEG 헤더가 너무 큽니다")
            out.write(b)
            if (b == 10) {
                val raw = out.toByteArray()
                if (raw.size < 2 || raw[raw.size - 2] != 13.toByte()) throw CctvFailure("MJPEG 헤더 형식이 올바르지 않습니다")
                return String(raw, 0, raw.size - 2, Charsets.ISO_8859_1)
            }
        }
    }
    while (line() != "--$boundary") { /* bounded preamble */ }
    var length: Int? = null
    while (true) {
        val header = line(); if (header.isEmpty()) break
        val key = header.substringBefore(':').trim().lowercase()
        val value = header.substringAfter(':', "").trim()
        when (key) {
            "content-length" -> {
                val parsed = value.toIntOrNull()
                if (length != null || parsed == null || parsed <= 0 || parsed > MAX_CCTV_IMAGE_BYTES)
                    throw CctvFailure("MJPEG 파트 길이가 올바르지 않습니다")
                length = parsed
            }
            "content-type" -> if (!value.lowercase().startsWith("image/")) throw CctvFailure("MJPEG 첫 파트가 이미지가 아닙니다")
        }
    }
    length?.let { size ->
        val bytes = ByteArray(size); var read = 0
        while (read < size) {
            val n = input.read(bytes, read, size - read)
            if (n < 0) throw CctvFailure("첫 이미지 수신 전에 연결이 종료됐습니다")
            read += n
        }
        return finish(bytes)
    }
    val delimiter = "\r\n--$boundary".toByteArray(Charsets.ISO_8859_1)
    val prefix = IntArray(delimiter.size)
    for (i in 1 until delimiter.size) {
        var j = prefix[i - 1]
        while (j > 0 && delimiter[i] != delimiter[j]) j = prefix[j - 1]
        if (delimiter[i] == delimiter[j]) j++
        prefix[i] = j
    }
    val out = ByteArrayOutputStream(); var matched = 0
    while (true) {
        val raw = input.read()
        if (raw < 0) return finish(out.toByteArray())
        val b = raw.toByte(); out.write(raw)
        if (out.size() > MAX_CCTV_IMAGE_BYTES + delimiter.size) throw CctvFailure("이미지가 수신 한도(16MB)를 초과했습니다")
        while (matched > 0 && b != delimiter[matched]) matched = prefix[matched - 1]
        if (b == delimiter[matched]) matched++
        if (matched == delimiter.size) {
            // Retain the next boundary when a live reader requests another frame on this connection.
            if (input is PushbackInputStream) input.unread(delimiter)
            return finish(out.toByteArray().copyOf(out.size() - delimiter.size))
        }
    }
}

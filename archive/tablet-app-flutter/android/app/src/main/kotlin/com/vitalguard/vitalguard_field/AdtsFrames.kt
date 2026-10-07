package com.vitalguard.vitalguard_field

// 강제 종료로 끊긴 마지막 ADTS 프레임은 제외하고 완성된 프레임까지 복구한다.
// 파일 종료/MP4 인덱스 없이 각 프레임 헤더의 길이로 경계를 알 수 있다.
internal fun completeAdtsLength(bytes: ByteArray): Int {
    fun at(index: Int) = bytes[index].toInt() and 0xff
    var offset = 0
    while (offset + 7 <= bytes.size) {
        if (at(offset) != 0xff || at(offset + 1) and 0xf6 != 0xf0) break
        val header = if (at(offset + 1) and 1 == 1) 7 else 9
        val length = ((at(offset + 3) and 3) shl 11) or
            (at(offset + 4) shl 3) or (at(offset + 5) shr 5)
        if (length <= header || offset + length > bytes.size) break
        offset += length
    }
    return offset
}

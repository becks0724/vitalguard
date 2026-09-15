package com.vitalguard.vitalguard_field

// Android 런타임/소켓 없이 프레임 중간 프로세스 종료 경계를 검증한다.
fun main() {
    fun frame(payload: Int, crc: Boolean = false): ByteArray {
        val length = payload + if (crc) 9 else 7
        return ByteArray(length).also {
            it[0] = 0xff.toByte()
            it[1] = (if (crc) 0xf0 else 0xf1).toByte()
            it[2] = 0x60 // AAC LC, 16 kHz
            it[3] = (0x40 or (length shr 11)).toByte()
            it[4] = (length shr 3).toByte()
            it[5] = ((length and 7) shl 5).toByte()
        }
    }
    val first = frame(80)
    val second = frame(150)
    val stream = first + second
    check(completeAdtsLength(stream) == stream.size)
    for (cut in 0 until first.size) {
        check(completeAdtsLength(first.copyOf(cut)) == 0)
    }
    for (cut in first.size until stream.size) {
        check(completeAdtsLength(stream.copyOf(cut)) == first.size)
    }
    val crc = frame(20, crc = true)
    check(completeAdtsLength(crc) == crc.size)
    check(completeAdtsLength(first + byteArrayOf(1, 2, 3)) == first.size)
    check(completeAdtsLength(byteArrayOf()) == 0)
    check(completeAdtsLength(frame(0)) == 0)
    println("ADTS recovery: complete frames, every truncation boundary, CRC, invalid tail, empty input passed")
}

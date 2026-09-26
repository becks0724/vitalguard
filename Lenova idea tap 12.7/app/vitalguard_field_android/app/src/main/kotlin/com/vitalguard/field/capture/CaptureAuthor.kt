package com.vitalguard.field.capture

import com.vitalguard.field.data.OutboxController
import com.vitalguard.field.data.OutboxKind
import com.vitalguard.field.data.contracts.ApiFailure
import com.vitalguard.field.data.contracts.FieldState

// 촬영/스캔을 시작할 때 고정한다. 계정이 바뀌면 enqueue가 거절한다.
data class CaptureAuthor(val owner: String, val siteName: String, val siteId: String?, val workerName: String, val workerId: String)
fun captureAuthor(state: FieldState): CaptureAuthor {
    val user = state.user ?: throw ApiFailure("작성 계정으로 다시 로그인해 주세요", action = "reauth")
    return CaptureAuthor(user.id, state.site?.site_name ?: "현장 정보 없음", state.site?.site_id?.takeIf { it.isNotEmpty() },
        user.name ?: "-", user.workerId ?: "-")
}
suspend fun enqueueCapturedPhoto(outbox: OutboxController, author: CaptureAuthor, jpeg: ByteArray, fields: Map<String, String>): LocalCaptureFile {
    val item = outbox.enqueue(OutboxKind.photo, jpeg, fields, author.siteName, owner = author.owner)
    return LocalCaptureFile(item.id, item.bytesKey)
}

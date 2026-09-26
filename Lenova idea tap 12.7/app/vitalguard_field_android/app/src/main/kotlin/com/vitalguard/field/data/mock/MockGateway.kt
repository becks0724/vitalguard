package com.vitalguard.field.data.mock

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.time.Clock
import java.time.ZoneOffset

// Port: mock_gateway.dart (세션·현장 샘플). 나머지 메서드는 계약의 "다음 단계".
open class MockGateway(private val clock: Clock = Clock.systemUTC()) : FieldGateway {
    override val isMock = true
    private var userId = "demo"
    val logoutTokens = mutableListOf<String>()
    val siteInfoTokens = mutableListOf<String>()
    private fun session() = MobileSession(mapOf(
        "ok" to true, "accessToken" to "mock-access-$userId", "refreshToken" to "mock-refresh-$userId",
        "accessExpiresInSec" to 900, "refreshExpiresAt" to "2099-01-01T00:00:00+09:00",
        "user" to mapOf("id" to userId, "role" to if (userId == "worker") "worker" else "site_manager",
            "name" to "모의 안전관리자", "workerId" to "MOCK-01"), "twoFactorPending" to false,
    ))
    override suspend fun login(id: String, password: String, totpCode: String?): MobileSession {
        if (password != "mock") throw ApiFailure("모의 비밀번호는 mock입니다", status = 401)
        if (id == "totp" && totpCode != "123456") {
            throw ApiFailure("모의 인증번호 123456을 입력하세요", status = 401, twoFactorRequired = true)
        }
        userId = id
        return session()
    }
    override suspend fun refresh(refreshToken: String) = session()
    override suspend fun me(accessToken: String) = session().user
    override suspend fun logout(accessToken: String) { logoutTokens.add(accessToken) }
    override suspend fun siteInfo(accessToken: String): SiteInfo? {
        siteInfoTokens.add(accessToken)
        val now = clock.instant().atOffset(ZoneOffset.ofHours(9))
        return SiteInfo(mapOf("id" to 1, "snapshot_date" to now.toLocalDate().toString(),
            "site_name" to "모의 현장", "company_name" to "모의 시공사", "construction_type" to null,
            "address" to null, "start_date" to null, "completion_date" to null, "recorded_at" to now.toString()))
    }
    override suspend fun siteStatus(accessToken: String) = SiteStatus(mockSiteStatusReply(clock.instant().toString()))
}

fun mockSiteStatusReply(fetchedAt: String): JsonObject = mapOf(
    "ok" to true, "fetchedAt" to fetchedAt,
    "weather" to mapOf("ok" to true, "level" to "normal", "summary" to "기상 특보 0건"),
    "workers" to mapOf("ok" to true, "level" to "normal", "normal" to 12, "waiting" to 0),
    "gas" to mapOf("ok" to true, "level" to "idle", "summary" to "모의 감지기 수신 대기"),
    "aed" to mapOf("ok" to true, "level" to "normal", "summary" to "점검 필요 0건", "total" to 0, "devices" to emptyList<Any>()),
    "alerts" to mapOf("ok" to true, "unacked" to 0, "siteScoped" to false, "items" to emptyList<Any>()),
)

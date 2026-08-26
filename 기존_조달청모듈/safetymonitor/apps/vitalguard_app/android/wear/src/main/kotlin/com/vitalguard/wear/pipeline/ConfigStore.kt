// 업로드 자격·서버 주소 보관 — adb 주입(실측)과 3단계 D(폰 Data Layer 전달)가 같은 곳에 쓴다
package com.vitalguard.wear.pipeline

import android.content.Context

/**
 * 실측 단계 주입 경로(폰 페어링 전) = adb 인텐트 엑스트라 → MainActivity 가 여기 저장.
 * ⚠ SharedPreferences 평문이다 — 제품 단계(3단계 D)에서 Keystore 암호화로 옮긴다.
 *   iOS 도 같은 순서였다(하드토큰 → Keychain). 지금 굳히는 것은 "경로" 다.
 */
class ConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("vg-upload", Context.MODE_PRIVATE)

    var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit().putString("token", v).apply() }

    var workerId: String?
        get() = prefs.getString("workerId", null)
        set(v) { prefs.edit().putString("workerId", v).apply() }

    var workerName: String?
        get() = prefs.getString("workerName", null)
        set(v) { prefs.edit().putString("workerName", v).apply() }

    /** 기본값 = 프로덕션 관제 서버(iOS productionBaseURL 과 동일). 개발 터널은 주입으로만 덮는다. */
    var baseUrl: String
        get() = prefs.getString("baseUrl", DEFAULT_BASE_URL)!!
        set(v) { prefs.edit().putString("baseUrl", v).apply() }

    /**
     * 로그인 성공분을 한 번에 적는다 — 셋을 따로 쓰면 중간에 죽었을 때 사번만 남는 반쪽 상태가 된다.
     * 그 반쪽 상태는 업로드가 401 로만 드러나서 원인을 못 찾는다.
     */
    fun saveSession(token: String, workerId: String, workerName: String?) {
        prefs.edit()
            .putString("token", token)
            .putString("workerId", workerId)
            .putString("workerName", workerName)
            .apply()
    }

    /** 로그아웃 — 자격만 지운다. baseUrl 은 기기 설정이라 남긴다. */
    fun clearSession() {
        prefs.edit().remove("token").remove("workerId").remove("workerName").apply()
    }

    fun uploadConfig(): UploadConfig? {
        val t = token ?: return null
        val w = workerId ?: return null
        return UploadConfig(t, w, workerName)
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
    }
}

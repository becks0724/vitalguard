// 재부팅·재설치 뒤 수집을 스스로 되살린다 — 사람이 앱을 열어야만 살아나던 구멍을 막는다
package com.vitalguard.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.vitalguard.wear.pipeline.ConfigStore

/**
 * 재부팅(BOOT_COMPLETED)·앱 교체(MY_PACKAGE_REPLACED) 뒤 [CollectorService] 를 다시 올린다.
 *
 * ★ 왜 필요한가 — 종전엔 **앱 소유 리시버가 하나도 없었다**(09-01 `dumpsys package` 전수:
 *   androidx.profileinstaller 3종뿐). 그래서 재부팅하거나 재설치하면 수집이 **조용히** 멈췄고,
 *   워치 화면은 평소와 똑같아 아무도 몰랐다. 같은 날 워치8 재설치에서 실제로 앱이 안 올라와
 *   사람이 손으로 띄웠다.
 *
 * ★ 자격이 있을 때만 올린다 — 로그아웃 상태에서 수집이 저절로 켜지면 올릴 곳 없는 표본만 쌓인다.
 *   자동 로그아웃(미착용 90분) 뒤 재부팅한 워치는 조용히 있는 것이 맞다.
 */
class RestartReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val hasToken = ConfigStore(context).token != null
        val canStartFgs = CollectorService.canStartHealthFgs(context)
        if (action == CollectorService.ACTION_HEARTBEAT) {
            onHeartbeat(context, hasToken, canStartFgs)
            return
        }
        if (!shouldRestart(action, hasToken, canStartFgs)) {
            Log.i(TAG, "$action — 자동 시작 안 함 (자격=$hasToken 권한=$canStartFgs)")
            return
        }
        context.startForegroundService(Intent(context, CollectorService::class.java))
        Log.i(TAG, "$action — 수집 서비스 자동 시작")
    }

    /**
     * 하트비트(10분 · [CollectorService.armHeartbeat]) — 서비스가 없으면 올리고, 있으면 다음 박동만 건다.
     *
     * ★ 순서 = **먼저 재무장, 그 다음 시작.** 시작이 백그라운드 거부로 물러서도([CollectorService.giveUpForeground])
     *   다음 박동은 와야 한다. 반대로 하면 거부 한 번이 사슬을 끊는다.
     * ⚠ 이 액션은 시스템 액션이 아니라 자체 액션이고, 면제는 액션이 아니라 배달 방식(allow-while-idle)에서 온다 —
     *   그래서 아래 [shouldRestart] 의 "액션을 넓히지 말 것" 과 충돌하지 않는다(docs/wear-fgs-heartbeat R-05).
     */
    private fun onHeartbeat(context: Context, hasToken: Boolean, canStartFgs: Boolean) {
        val running = CollectorService.running
        val decision = heartbeat(running, hasToken, canStartFgs)
        Log.i(TAG, "하트비트 — $decision (running=$running 자격=$hasToken 권한=$canStartFgs)")
        if (decision == Heartbeat.DROP) return
        CollectorService.armHeartbeat(context)
        if (decision == Heartbeat.START) {
            context.startForegroundService(
                Intent(context, CollectorService::class.java)
                    .putExtra(CollectorService.EXTRA_FROM_HEARTBEAT, true),
            )
            Log.i(TAG, "하트비트 소생 — 수집 서비스 재시작")
        }
    }

    internal enum class Heartbeat { REARM, START, DROP }

    internal companion object {
        const val TAG = "VgRestart"

        /**
         * 하트비트 판정 — 순수 함수(단위 시험).
         * running → REARM(살아 있다, 다음 박동만) · token 없음 → DROP(로그아웃 상태 · 사슬을 끊는다 — 올릴 곳 없는
         * 표본만 쌓인다) · 자격+권한 → START · 자격은 있는데 권한이 없음 → REARM(사람이 열면 액티비티가 묻는다).
         */
        internal fun heartbeat(running: Boolean, hasToken: Boolean, canStartFgs: Boolean): Heartbeat = when {
            running -> Heartbeat.REARM
            !hasToken -> Heartbeat.DROP
            canStartFgs -> Heartbeat.START
            else -> Heartbeat.REARM
        }

        /**
         * 되살릴 조건 — 셋을 모두 만족해야 한다.
         *
         * ⚠ **액션을 넓히지 말 것.** Android 12+ 는 백그라운드에서 FGS 를 못 올리는데
         *   `BOOT_COMPLETED`·`MY_PACKAGE_REPLACED` 는 그 제한의 **면제 대상**이다. 다른 액션을
         *   더하면 그 경로에서만 `ForegroundServiceStartNotAllowedException` 이 난다.
         * ⚠ 권한 0개에서 FGS(health) 승격은 SecurityException 으로 즉사한다(c7b188f) — 그래서
         *   [CollectorService.canStartHealthFgs] 를 액티비티와 **같이** 본다. 권한이 없으면 여기서는
         *   물러서고, 사람이 앱을 열 때 액티비티가 묻는다.
         */
        internal fun shouldRestart(action: String?, hasToken: Boolean, canStartFgs: Boolean): Boolean =
            (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) &&
                hasToken &&
                canStartFgs
    }
}

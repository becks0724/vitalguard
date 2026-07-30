package com.yangjeehoo.vitalguard.flutter

import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class VitalWatchListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        events.use { buffer ->
            buffer.filter { it.dataItem.uri.path == "/vitalguard/session" }.forEach { event ->
                val payload = com.google.android.gms.wearable.DataMapItem.fromDataItem(event.dataItem).dataMap.getString("payload") ?: return@forEach
                val context = JSONObject(payload)
                if (!context.optBoolean("loggedIn", false)) {
                    getSharedPreferences("vitalguard_watch", MODE_PRIVATE).edit().clear().apply()
                    return@forEach
                }
                val employee = context.optString("employeeId", "작업자")
                val name = context.optString("displayName", employee)
                val role = context.optString("role", "worker")
                getSharedPreferences("vitalguard_watch", MODE_PRIVATE).edit()
                    .putString("session_identity", "$name · $role")
                    .putString("session_status", "$employee 세션 동기화됨\n실측 심박·움직임 권한을 승인한 후 전송합니다.")
                    .putBoolean("session_synced", true)
                    .apply()
            }
        }
    }
}

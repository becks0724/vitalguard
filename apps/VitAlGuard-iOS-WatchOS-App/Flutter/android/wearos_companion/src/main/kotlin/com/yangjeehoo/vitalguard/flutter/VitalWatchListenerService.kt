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
                val employee = context.optString("employeeId", "작업자")
                getSharedPreferences("vitalguard_watch", MODE_PRIVATE).edit()
                    .putString("session_status", "$employee 세션 동기화됨\n실측 심박·움직임 권한을 승인한 후 전송합니다.")
                    .apply()
            }
        }
    }
}

package com.yangjeehoo.vitalguard.flutter

import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject

class MainActivity : FlutterActivity() {
    private val channelName = "com.yangjeehoo.vitalguard/watch_bridge"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler(::handleBridgeCall)
    }

    private fun handleBridgeCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "status" -> Wearable.getNodeClient(this).connectedNodes
                .addOnSuccessListener { nodes ->
                    result.success(mapOf(
                        "supported" to true,
                        "reachable" to nodes.isNotEmpty(),
                        "platform" to "Wear OS / Galaxy Watch",
                        "detail" to if (nodes.isEmpty()) "페어링된 Wear OS 시계를 찾지 못했습니다." else "${nodes.size}개의 Wear OS 시계와 동기화할 수 있습니다."
                    ))
                }
                .addOnFailureListener { error -> result.success(mapOf("supported" to false, "reachable" to false, "platform" to "Wear OS / Galaxy Watch", "detail" to (error.message ?: "Google Play 서비스 상태를 확인할 수 없습니다."))) }
            "syncWatchContext" -> {
                @Suppress("UNCHECKED_CAST")
                val values = call.arguments as? Map<String, Any> ?: run {
                    result.error("invalid_context", "시계 동기화 데이터 형식이 올바르지 않습니다.", null)
                    return
                }
                val request = PutDataMapRequest.create("/vitalguard/session").apply {
                    dataMap.putString("payload", JSONObject(values).toString())
                    dataMap.putLong("updatedAt", System.currentTimeMillis())
                }.asPutDataRequest().setUrgent()
                Wearable.getDataClient(this).putDataItem(request)
                    .addOnSuccessListener { result.success(mapOf("message" to "Wear OS 세션을 동기화했습니다.")) }
                    .addOnFailureListener { error -> result.success(mapOf("message" to "Wear OS 연결 시 세션을 동기화합니다: ${error.message ?: "대기열 저장"}")) }
            }
            else -> result.notImplemented()
        }
    }
}

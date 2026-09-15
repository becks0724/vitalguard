package com.vitalguard.vitalguard_field

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

class NetworkNative(private val context: Context, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "vitalguard/network")

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "hasInternet" -> {
                    try {
                        result.success(hasInternet())
                    } catch (_: Exception) {
                        result.error("network_state_error", "인터넷 연결 상태를 확인할 수 없습니다", null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun hasInternet(): Boolean {
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun close() { channel.setMethodCallHandler(null) }
}

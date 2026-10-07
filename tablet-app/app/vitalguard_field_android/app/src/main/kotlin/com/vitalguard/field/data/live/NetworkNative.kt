package com.vitalguard.field.data.live

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.vitalguard.field.data.contracts.InternetProbe

// 로그인 화면/모델만 호출한다. 게이트웨이는 기기의 연결 여부를 추정하지 않는다.
class NetworkNative(context: Context) : InternetProbe {
    private val context = context.applicationContext
    override suspend fun hasInternet(): Boolean? = try {
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork
        val capabilities = network?.let { connectivity.getNetworkCapabilities(it) }
        if (capabilities == null) false else
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } catch (_: Exception) { null }
}

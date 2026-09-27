package com.vitalguard.field.data.live

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Wi-Fi 전환도 기본 네트워크의 VALIDATED 상태로 관찰한다. 콜백은 ViewModel 수명에 귀속된다. */
class ConnectivityWatcher(context: Context, private val scope: CoroutineScope, private val changed: (Boolean) -> Unit) : AutoCloseable {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var closed = false
    private var registered = false
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publish()
        override fun onLost(network: Network) = publish()
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = publish()
    }
    private fun publish() {
        scope.launch {
            if (closed) return@launch
            val caps = manager.getNetworkCapabilities(manager.activeNetwork)
            changed(caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
        }
    }
    init { manager.registerDefaultNetworkCallback(callback); registered = true; publish() }
    override fun close() {
        closed = true
        if (registered) { manager.unregisterNetworkCallback(callback); registered = false }
    }
}

package com.sailxx.tobi.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.sailxx.tobi.link.LanSockets

/**
 * Tells the model when the network changes (a new Wi-Fi, a hotspot) and whether a Wi-Fi or cable is up at all.
 * Registered only while a computer is paired; the system calls back on a change, nothing polls.
 */
class NetworkWatch(
    context: Context,
    private val onChange: (wifiUp: Boolean) -> Unit,
    /** A network became the default one (Wi-Fi joined, Wi-Fi to mobile data): the link may be on the old one and half dead. */
    private val onNewNetwork: () -> Unit = {},
) {
    private val cm = context.applicationContext.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    @Volatile var wifiUp: Boolean = isWifiUp()
        private set

    /** The Wi-Fi or cable network, even when a VPN (or mobile data) is the default one; null if there is none. */
    fun lanNetwork(): Network? = runCatching {
        cm.allNetworks.firstOrNull { n ->
            val c = cm.getNetworkCapabilities(n) ?: return@firstOrNull false
            !c.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        }
    }.getOrNull()

    fun isWifiUp(): Boolean = lanNetwork() != null

    fun isCellular(): Boolean {
        val n = cm.activeNetwork ?: return false
        return cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
    }

    @Synchronized
    fun start() {
        if (callback != null) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { changed(); onNewNetwork() }
            override fun onLost(network: Network) { changed() }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { changed() }
        }
        callback = cb
        // The direct link to the computer must go over the Wi-Fi itself: with a VPN on, the default route is the tunnel
        // and the computer's 192.168.x.x address is not reachable through it.
        LanSockets.provider = { lanNetwork()?.socketFactory?.createSocket() }
        runCatching { cm.registerDefaultNetworkCallback(cb) }
    }

    @Synchronized
    fun stop() {
        callback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
        callback = null
        LanSockets.provider = null
    }

    private fun changed() {
        val up = isWifiUp()
        wifiUp = up
        onChange(up)
    }
}

package com.vitalguard.field.data.live

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.vitalguard.field.data.contracts.LocalStore
import com.vitalguard.field.data.models.Json
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceLocalStore(context: Context) : LocalStore by QueuedFileStore(
    File(context.applicationContext.noBackupFilesDir, "field-records"),
    KeystoreTokens(context.applicationContext),
)

// Port: FieldStorage.kt. 원본 alias/AAD/IV/JSON/경로를 보존한다. 비밀번호는 받지 않는다.
private class KeystoreTokens(context: Context) : TokenBundleStorage {
    private val tokenFile = File(context.noBackupFilesDir, "field-session.enc")
    private val alias = "vitalguard.field.session.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    override fun read(): String? {
        if (!tokenFile.exists()) return null
        val data = Json.decodeObject(tokenFile.readText())
        require(data["v"] == 1)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.getDecoder().decode(data["iv"] as String)))
        cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(Base64.getDecoder().decode(data["data"] as String)).toString(Charsets.UTF_8)
    }
    override fun write(json: String?) {
        if (json == null) {
            if (tokenFile.exists()) check(tokenFile.delete())
            val pending = File(tokenFile.parentFile, "field-session.pending")
            if (pending.exists()) check(pending.delete())
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        val data = mapOf("v" to 1, "iv" to Base64.getEncoder().encodeToString(cipher.iv),
            "data" to Base64.getEncoder().encodeToString(encrypted))
        atomicWrite(tokenFile, Json.encode(data).toByteArray(Charsets.UTF_8), "field-session.pending")
    }
}

package com.vitalguard.vitalguard_field

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// 외부 의존성 없이 Android Keystore로 토큰만 암호화한다. 비밀번호는 받지 않는다.
class FieldStorage(private val context: Context, messenger: BinaryMessenger) {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val tokenFile = File(context.noBackupFilesDir, "field-session.enc")
    private val alias = "vitalguard.field.session.v1"

    init {
        MethodChannel(messenger, "vitalguard/local").setMethodCallHandler { call, result ->
            executor.execute {
                try {
                    val answer: Any? = when (call.method) {
                        "readTokens" -> readTokens()
                        "writeTokens" -> {
                            val value = call.argument<String>("value")
                            if (value == null) {
                                if (tokenFile.exists() && !tokenFile.delete()) error("토큰 삭제 실패")
                            } else {
                                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                                cipher.init(Cipher.ENCRYPT_MODE, key())
                                cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
                                val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
                                val encoded = JSONObject().put("v", 1)
                                    .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                                    .put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                                val temp = File(tokenFile.parentFile, "field-session.pending")
                                temp.writeText(encoded.toString())
                                if (!temp.renameTo(tokenFile)) error("토큰 저장 실패")
                            }
                            null
                        }
                        "dataPath" -> File(context.noBackupFilesDir, "field-records").apply { mkdirs() }.absolutePath
                        else -> throw IllegalArgumentException("지원하지 않는 저장 메서드")
                    }
                    main.post { result.success(answer) }
                } catch (_: Exception) {
                    // 자격 증명·암호문을 오류 메시지나 로그에 넣지 않는다.
                    main.post { result.error("local_storage_error", "기기 저장소를 사용할 수 없습니다", null) }
                }
            }
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    private fun readTokens(): String? {
        if (!tokenFile.exists()) return null
        val data = JSONObject(tokenFile.readText())
        require(data.getInt("v") == 1)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(data.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD(alias.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(Base64.decode(data.getString("data"), Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }

    fun close() { executor.shutdown() }
}

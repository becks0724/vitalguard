package com.vitalguard.field

import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vitalguard.field.audio.*
import com.vitalguard.field.data.contracts.ApiFailure
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MicrophoneAccessTest {
    private fun access()=MicrophoneAccess(object:ContextWrapper(ApplicationProvider.getApplicationContext<Context>()) {
        override fun checkSelfPermission(permission: String)=PackageManager.PERMISSION_DENIED
    })
    @Test fun denialUsesOriginalMessageAndPermissionCanBeRequestedAgain() = runBlocking {
        val mic=access(); mic.attach(MicrophoneActivityHost { mic.onResult(false) })
        val error=runCatching { mic.request("recorder") }.exceptionOrNull() as ApiFailure
        assertEquals("microphone_denied",error.code); assertEquals("마이크 권한이 필요합니다",error.message)
        mic.attach(MicrophoneActivityHost { mic.onResult(true) }); mic.request("speech")
    }
    @Test fun cancelledPermissionResultCannotStartANewRequestAfterRotation() = runBlocking {
        val mic=access(); val old=MicrophoneActivityHost { }; mic.attach(old)
        val first=async { runCatching { mic.request("recorder") }.exceptionOrNull() }; yield()
        mic.cancel("recorder"); assertEquals("recording_cancelled",(first.await() as ApiFailure).code)
        mic.detach(old); mic.attach(MicrophoneActivityHost { mic.onResult(true) })
        assertEquals("microphone_busy",(runCatching { mic.request("speech") }.exceptionOrNull() as ApiFailure).code)
        mic.onResult(true) // 늦은 결과는 취소된 슬롯만 비운다.
        mic.request("speech")
    }
}

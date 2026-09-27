package com.vitalguard.field

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Intent
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class SingleTaskComposeTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private var instances = 0
    private val graph = object : ExternalResource() {
        override fun before() {
            ApplicationProvider.getApplicationContext<FieldApplication>().apply {
                captureEnabledForTests = false
                controllerFactoryForTests = { scope -> instances++; FieldCoordinator(MockGateway(), MemoryStore(), scope) }
            }
        }
        override fun after() {
            ApplicationProvider.getApplicationContext<FieldApplication>().apply { captureEnabledForTests = null; controllerFactoryForTests = null }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(graph).around(compose)
    @Test fun launcherAfterExplicitStartKeepsOneMainActivityHistoryEntry() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val application = ApplicationProvider.getApplicationContext<FieldApplication>()
        val original = compose.activity
        val originalTask = original.taskId
        val component = ComponentName(application, MainActivity::class.java)
        val manager = application.getSystemService(ActivityManager::class.java)
        fun assertSingleHistoryEntry(step: String) = compose.runOnIdle {
            assertEquals("$step: ViewModel 생성 횟수", 1, instances)
            assertSame("$step: 기존 MainActivity 재사용", original, compose.activity)
            assertEquals("$step: 기존 taskId 유지", originalTask, compose.activity.taskId)
            assertTrue("$step: MainActivity가 태스크 루트여야 합니다", compose.activity.isTaskRoot)
            // Android 16은 'Hist  #0'로 출력한다. 셸 권한/출력 형식에 의존하지 않고 앱 태스크를 센다.
            val tasks = manager.appTasks.mapNotNull { it.taskInfo }.filter {
                it.numActivities > 0 && (it.baseActivity == component || it.topActivity == component || it.baseIntent.component == component)
            }
            assertEquals("$step: 실행 중인 MainActivity 태스크는 하나여야 합니다: $tasks", 1, tasks.size)
            val task = tasks.single()
            assertEquals("$step: 조회한 태스크 ID", originalTask, task.taskId)
            assertEquals("$step: 루트 액티비티", component, task.baseActivity)
            assertEquals("$step: 최상위 액티비티", component, task.topActivity)
            assertEquals("$step: 태스크 안의 액티비티는 하나여야 합니다", 1, task.numActivities)
        }
        val resumes = AtomicInteger()
        val monitor = ActivityLifecycleMonitorRegistry.getInstance()
        val callback = ActivityLifecycleCallback { activity, stage ->
            if (activity is MainActivity && stage == Stage.RESUMED) resumes.incrementAndGet()
        }
        instrumentation.runOnMainSync { monitor.addLifecycleCallback(callback) }
        try {
            assertSingleHistoryEntry("최초 실행")
            fun relaunch(intent: Intent, step: String) {
                val before = resumes.get()
                instrumentation.runOnMainSync { application.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                // startActivity 요청만 큐에 들어간 이전 상태를 검사하지 않는다.
                compose.waitUntil(5_000) { resumes.get() > before }
                assertSingleHistoryEntry(step)
            }
            relaunch(Intent(application, MainActivity::class.java), "명시적 재실행")
            relaunch(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                .setClass(application, MainActivity::class.java), "런처 재실행")
        } finally {
            instrumentation.runOnMainSync { monitor.removeLifecycleCallback(callback) }
        }
    }
}

// 6축 IMU 공급 가드 — 단위·부호·표본율이 ML 모듈이 학습한 규약과 맞는가
package com.vitalguard.wear

import android.hardware.SensorManager
import com.vitalguard.ml.FallMLPipeline
import com.vitalguard.ml.ImuWindowLogger
import com.vitalguard.wear.source.ImuSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

/**
 * 한 문장 보장 = **워치가 모듈에 먹이는 6축이 모듈이 학습한 그 단위·그 부호·그 주기다.**
 *
 * ★ 왜 여기가 위험한가. 단위를 틀리거나 부호를 뒤집어도 **아무것도 예외를 던지지 않는다.**
 *   모듈은 계속 돌고, 계속 그럴듯한 확률을 낸다 — 다만 전부 틀린 값이다. 낙상 모듈에서 이 실패는
 *   화면에 안 보이고 로그에도 안 남는다. 그래서 코드가 아니라 **시험이** 붙잡아야 한다.
 *
 * 규약 출처 = `WearOS통합가이드.md` 배선 1항 —
 *   안드로이드 `TYPE_ACCELEROMETER` = m/s² · 중력 포함 · 정지 시 축값 **+**1g
 *   모듈(애플워치 학습)              = G   · 중력 포함 · 정지 시 축값 **−**1g
 *   ⟹ `a_모듈 = -a_안드로이드 / 9.80665`
 */
class ImuFeedTest {

    /** Float 입력의 상대정밀도(~6e-8)에서 오는 바닥. 이보다 조이면 물리가 아니라 부동소수를 잰다. */
    private val FLOAT_TOL = 1e-6

    @Test
    fun `정지한 워치는 총가속도 1G 가 된다`() {
        // 평평히 둔 워치 — 안드로이드는 z 축에 +9.80665 를 준다.
        val ax = ImuSource.toModuleG(0f)
        val ay = ImuSource.toModuleG(0f)
        val az = ImuSource.toModuleG(9.80665f)
        val totalG = sqrt(ax * ax + ay * ay + az * az)
        // 1.0 이어야 한다. 나누기를 빠뜨리면 9.8, 중력 제거 센서를 쓰면 0.0 이 된다 —
        // 셋 다 예외 없이 통과하는 값이라 숫자로 못 박는다.
        // ⚠ 허용오차 1e-6 은 임의값이 아니다 — 입력이 Float 라 24비트 가수(상대정밀도 ~6e-8)를
        //   넘어설 수 없다. 실제로 9.80665f 는 Double 로 넓히면 9.806650161743164 다.
        //   1e-9 로 조이면 **센서 타입 때문이 아니라 부동소수 때문에** 빨개진다(첫 실행에서 그랬다).
        assertEquals(1.0, totalG, FLOAT_TOL)
    }

    @Test
    fun `아래를 향한 축은 음수다 — 애플워치 규약`() {
        // 부호를 빠뜨리면 여기서만 걸린다. 크기 검사는 부호를 못 본다.
        assertTrue("아래 향한 축이 양수다 — 부호 변환이 빠졌다", ImuSource.toModuleG(9.80665f) < 0)
        assertEquals(-1.0, ImuSource.toModuleG(9.80665f), FLOAT_TOL)
        assertEquals(1.0, ImuSource.toModuleG(-9.80665f), FLOAT_TOL)
        assertEquals(0.0, ImuSource.toModuleG(0f), 1e-12)   // 0 은 부동소수 오차가 없다
    }

    @Test
    fun `중력 상수가 안드로이드 것과 부동소수 오차 안에서 같다`() {
        // 시험에서 쓰려고 뗀 사본이다 — 갈리면 변환이 조용히 어긋난다.
        // ⚠ 정확히 같을 수는 없다. `SensorManager.GRAVITY_EARTH` 는 **Float** 라 Double 로 넓히면
        //   9.806650161743164 가 되고, 우리 상수는 10진수 그대로인 9.80665 다. 차이 1.6e-8 은
        //   피처 정밀도(~1e-3)보다 다섯 자릿수 아래라 무해하고, **더 정확한 쪽은 우리 것**이다.
        //   그래서 값을 맞추지 않고 "같은 상수를 가리키는가" 만 본다.
        assertEquals(SensorManager.GRAVITY_EARTH.toDouble(), ImuSource.G, FLOAT_TOL)
    }

    @Test
    fun `표본율이 모듈의 FS 와 일치한다`() {
        // ★ 피처가 fs 에 걸려 있다(주파수 피처·jerk·무활동 비율). 센서를 25Hz 로 걸어 두고
        //   모듈에 50 이라고 말하면 주파수 축이 통째로 두 배 어긋나는데, 그래도 안 죽는다.
        assertEquals(FallMLPipeline.FS, 1_000_000.0 / ImuSource.SAMPLING_US, 1e-9)
    }

    @Test
    fun `자이로가 오기 전에는 행을 만들지 않는다`() {
        // 0 으로 채우면 7채널 중 3채널이 "회전 없음" 이라는 거짓말이 되고, 모델은 그것을 믿는다.
        val accel = floatArrayOf(0f, 0f, 9.80665f)
        assertNull("자이로가 없는데 행이 나왔다", ImuSource.pair(accel, null, 1_000L))
        assertNotNull("자이로가 있는데 행이 안 나왔다", ImuSource.pair(accel, floatArrayOf(0f, 0f, 0f), 1_000L))
    }

    @Test
    fun `실효 Hz 는 못 잰 것을 0 으로 적지 않는다`() {
        // ★ 2단계에서 이 값 하나로 "화면 꺼진 뒤에도 표본이 오는가" 를 판정한다.
        //   경과가 0인데 0.0Hz 로 적으면 **"안 왔다"** 로 읽히는데, 실제로는 **"아직 못 쟀다"** 다.
        //   둘을 섞으면 관측이 결론을 만든다.
        assertEquals("?", ImuSource.hz(1, 0L))
        assertEquals("?", ImuSource.hz(3000, -5L))
        // 50Hz — 3,000표본이 60초(6e10 ns)에 걸쳐 왔다.
        assertEquals("50.0", ImuSource.hz(3000, 60_000_000_000L))
        // 뭉쳐 온 경우도 그대로 드러나야 한다 — 3,000건이 1초에 몰리면 3000Hz 로 보인다.
        assertEquals("3000.0", ImuSource.hz(3000, 1_000_000_000L))
    }

    @Test
    fun `행이 6축을 그대로 싣는다 — 자이로는 변환 없이 통과`() {
        // 자이로는 안드로이드·모듈 양쪽 다 rad/s 다. 여기에 변환을 끼우면 회전 피처가 통째로 어긋난다.
        val r = ImuSource.pair(floatArrayOf(0f, 0f, 9.80665f), floatArrayOf(0.1f, -0.2f, 0.3f), 7_000L)!!
        assertEquals(0.1, r.gx, FLOAT_TOL)
        assertEquals(-0.2, r.gy, FLOAT_TOL)
        assertEquals(0.3, r.gz, FLOAT_TOL)
        assertEquals(-1.0, r.az, FLOAT_TOL)      // 가속도는 변환된다
        assertEquals(1.0, r.totalG, FLOAT_TOL)
        assertEquals(7_000L, r.atNs)             // 시각은 event.timestamp 그대로
    }

    @Test
    fun `충격이 없으면 창을 내지 않는다 — 게이트가 조인다`() {
        val logger = ImuWindowLogger()
        var windows = 0
        logger.onWindow = { windows++ }
        // 정지 상태 1G 를 12초(50Hz) 공급 — 게이트 1.8G 에 한 번도 안 닿는다.
        var ns = 0L
        repeat(600) {
            logger.ingest(0.0, 0.0, -1.0, 0.0, 0.0, 0.0, totalG = 1.0, nowNs = ns)
            ns += 20_000_000L                       // 20ms = 50Hz
        }
        assertEquals("충격이 없는데 창이 나왔다 — 게이트가 안 조인다", 0, windows)
    }

    @Test
    fun `충격 뒤 10초가 차면 창이 나온다`() {
        val logger = ImuWindowLogger()
        var win: com.vitalguard.ml.ImuWindow? = null
        logger.onWindow = { win = it }
        var ns = 0L
        // 전 2초 — 평온
        repeat(100) { logger.ingest(0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, ns); ns += 20_000_000L }
        // 충격 1표본 — 게이트 1.8G 를 넘긴다
        logger.ingest(0.0, 0.0, -2.5, 0.0, 0.0, 0.0, totalG = 2.5, nowNs = ns); ns += 20_000_000L
        // 후 10초 — 평온
        repeat(500) { logger.ingest(0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, ns); ns += 20_000_000L }
        val w = win
        assertNotNull("충격 뒤 10초가 찼는데 창이 안 나왔다", w)
        assertEquals(FallMLPipeline.FS, w!!.fs, 1e-9)
        // 12초 창 = 600표본 언저리. 정확히 601(전100+충격1+후500)이 들어와야 한다.
        assertEquals(601, w.samples.size)
        // 각 행은 6축이다 — 채널이 줄면 피처 88개가 통째로 어긋난다.
        assertEquals(6, w.samples[0].size)
        // 충격 위치가 전 2초 뒤여야 한다(모듈이 이 인덱스로 work_veto 3s·impact ±1s 를 자른다).
        assertEquals(100, w.impactIndex)
    }
}

// 낙상 ML 모듈에 6축 IMU(가속도 xyz + 자이로 xyz)를 50Hz 로 먹이는 전용 소스
package com.vitalguard.wear.source

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import kotlin.math.sqrt

/**
 * ★ 왜 기존 수집 경로에 얹지 않고 따로 두는가.
 *
 * `SensorTrackerSource` 는 `TYPE_LINEAR_ACCELERATION`(중력 **제거**)을 `SENSOR_DELAY_NORMAL` 로 받아
 * **소스에서 이미 스칼라 크기로 뭉갠다**(`onAccelMagG`). 무동작 지속·변동폭은 그걸로 충분하고
 * 실기에서 검증된 경로다. 반면 ML 모듈이 요구하는 것은 **축별 6채널 · 중력 포함 · 50Hz** 라
 * 같은 통로로는 둘 다 만족시킬 수 없다. 계약을 넓히는 대신 통로를 하나 더 낸다
 * ([[OffBodySource]] 와 같은 모양 — 독립 SensorEventListener).
 *
 * ★ 단위 규약 — 모듈은 **애플워치 데이터로 학습**됐다.
 * ```
 * 안드로이드 TYPE_ACCELEROMETER   m/s² · 중력 포함 · 평평히 뒀을 때 az ≈ +9.81
 * 모듈이 기대하는 값               G    · 중력 포함 · 평평히 뒀을 때 az ≈ -1.0
 * ⟹ a_모듈 = -a_안드로이드 / 9.80665      (WearOS통합가이드.md)
 * 자이로는 양쪽 다 rad/s — 그대로 넘긴다.
 * ```
 * 부호를 빠뜨리면 모델은 예외 없이 **그럴듯한 확률을 계속 낸다**. 그래서 변환은 순수 함수로
 * 떼어 시험에서 못 박는다(`toModuleG`).
 *
 * ★ 두 센서를 어떻게 한 행으로 묶는가. 안드로이드는 가속도와 자이로를 **각자의 콜백**으로 준다.
 * 가속도가 올 때마다 **가장 최근 자이로 값**을 얹어 한 행을 만든다(zero-order hold). 충격 게이트가
 * 가속도 기준이라 표본 시각의 기준도 가속도 쪽이어야 한다.
 * ⚠ 자이로가 아직 한 번도 안 왔으면 행을 만들지 않는다 — 0 으로 채우면 7채널 중 3채널이
 *   거짓이 되고, 모델은 그것을 "회전이 없었다" 로 읽는다.
 */
class ImuSource(context: Context) : SensorEventListener {

    private val manager = context.getSystemService(SensorManager::class.java)

    private val accel: Sensor? =
        manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER, true)
            ?: manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyro: Sensor? =
        manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE, true)
            ?: manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)

    /** 둘 다 있어야 ML 이 성립한다 — 하나라도 없으면 호출부는 ML 을 끈다. */
    val supported: Boolean get() = accel != null && gyro != null

    /** 마지막 자이로 표본. 가속도 행에 얹힌다. null = 아직 한 번도 안 옴. */
    private var lastGyro: FloatArray? = null

    private var onSample: ((Row) -> Unit)? = null

    /**
     * ★ 전용 스레드 — 핸들러를 안 주면 센서 콜백이 **메인 스레드**로 온다.
     *
     * 이 통로의 소비자는 ML 판정이고, `FeatureExtractor` 의 DFT 는 **나이브 O(n²)** 다.
     * 모듈 주석은 `n≤150` 을 상정하지만 recovery 는 **12초 창 전체(601표본)** 를 쓴다 —
     * 7채널 × 601² 이라 메인 스레드에서 돌면 화면이 멎고 ANR 로 간다.
     * 서비스의 `vg-collector` 스레드를 빌려 쓰지 않는 이유 = 그쪽은 업로드(네트워크)가 쓰고 있어,
     * 판정이 길어지면 전송이 밀린다. 통로가 다르면 스레드도 다르게 둔다.
     */
    private var thread: HandlerThread? = null

    // ── 실효 Hz 계측 ──────────────────────────────────────────────────────
    // ★ 왜 필요한가. 이 워치의 가속도·자이로는 **wake-up 변형이 없다**(2026-08-27 실측 —
    //   `dumpsys sensorservice` 에 모션 계열 wakeUp 0건, 통제군 Wakeup 센서 148개). 게다가
    //   CollectorService 는 웨이크락을 안 잡는다(`Wake Locks: size=0`). 그러면 CPU 가 절전에
    //   들어갔을 때 표본이 **끊기는지 · 뭉쳐 오는지 · 그냥 느려지는지** 를 알 수 없다.
    //   웨이크락은 배터리를 먹으므로 붙이기 전에 먼저 잰다.
    // ⚠ 두 시각을 따로 센다 — 하나로는 못 가른다.
    //   표본 시각(event.timestamp) 기준 Hz = 센서가 실제로 몇 번 쟀나
    //   도착 시각(elapsedRealtime) 기준 Hz = 우리가 몇 번 받았나
    //   둘이 같으면 정상, 도착 쪽만 튀면 뭉쳐 온 것(배칭), 둘 다 낮으면 센서가 느려진 것.
    private var statN = 0
    private var statFirstEventNs = 0L
    private var statFirstArrivalNs = 0L
    private var statPrevArrivalNs = 0L
    private var statMaxGapMs = 0L

    /** 한 표본 — 모듈의 `ingest` 인자와 1:1. 시각은 `SensorEvent.timestamp`(부팅 후 나노초). */
    class Row(
        val ax: Double, val ay: Double, val az: Double,
        val gx: Double, val gy: Double, val gz: Double,
        val totalG: Double,
        val atNs: Long,
    )

    fun start(onSample: (Row) -> Unit) {
        this.onSample = onSample
        // ★ 통계를 여기서 반드시 초기화한다. 안 하면 **정지 구간이 센서 공백으로 둔갑한다** —
        //   08-27 첫 실측에서 착용이 떨려(착용→벗음→착용) `최대공백=4329ms` 가 찍혔는데
        //   그건 센서가 쉰 게 아니라 내가 `stop()` 을 부른 시간이었다. 다음 사람이 이 값을
        //   기기 문제로 읽으면 엉뚱한 곳을 판다.
        resetStats()
        if (!supported) {
            // ⚠ 이 로그가 자이로 유무를 확정하는 유일한 자리다 — 기기 없이는 코드로 못 안다.
            Log.w(TAG, "6축 미충족 — 가속도=${accel != null} 자이로=${gyro != null} · ML 비활성")
            dumpSensors()
            return
        }
        // maxReportLatencyUs = 0 — 배칭하지 말라는 요청. wake-up 센서는 화면이 꺼지면 표본을
        // FIFO 에 모았다가 몰아 주는데(2026-08-24 실측: 219초 공백 뒤 221건), 낙상은 **늦게 온
        // 판정이 거의 쓸모없다**. 유실이 아니라 지연이 문제이므로 시각은 event.timestamp 를 쓴다.
        val t = HandlerThread("vg-imu").apply { start() }
        thread = t
        val h = Handler(t.looper)
        manager.registerListener(this, accel, SAMPLING_US, 0, h)
        manager.registerListener(this, gyro, SAMPLING_US, 0, h)
        Log.i(TAG, "6축 시작 ${1_000_000 / SAMPLING_US}Hz 요청 · " +
            "가속도 wake=${accel?.isWakeUpSensor} min=${accel?.minDelay}µs · " +
            "자이로 wake=${gyro?.isWakeUpSensor} min=${gyro?.minDelay}µs")
    }

    private fun resetStats() {
        statN = 0
        statMaxGapMs = 0
    }

    /** 표본 하나가 도착했다 — 주기적으로 실효 Hz 를 찍는다. */
    private fun tally(eventNs: Long) {
        val arrivalNs = android.os.SystemClock.elapsedRealtimeNanos()
        if (statN == 0) {
            statFirstEventNs = eventNs; statFirstArrivalNs = arrivalNs; statPrevArrivalNs = arrivalNs
        } else {
            val gapMs = (arrivalNs - statPrevArrivalNs) / 1_000_000L
            if (gapMs > statMaxGapMs) statMaxGapMs = gapMs
            statPrevArrivalNs = arrivalNs
        }
        statN++
        if (statN < STAT_EVERY) return
        val bySample = hz(statN, eventNs - statFirstEventNs)
        val byArrival = hz(statN, arrivalNs - statFirstArrivalNs)
        Log.i(TAG, "실효Hz 표본기준=$bySample 도착기준=$byArrival · ${statN}건 · " +
            "최대공백=${statMaxGapMs}ms · 요청=${1_000_000 / SAMPLING_US}Hz")
        resetStats()
    }

    fun stop() {
        manager.unregisterListener(this)
        // ⚠ 순서가 중요하다 — 구독을 먼저 끊고 스레드를 접는다. 반대로 하면 죽은 루퍼로
        //   콜백이 들어와 예외가 난다.
        thread?.quitSafely()
        thread = null
        onSample = null
        lastGyro = null
    }

    /** 기기가 실제로 무엇을 갖고 있는지 한 번 찍는다 — 다음 사람이 추측하지 않게. */
    private fun dumpSensors() {
        val all = manager.getSensorList(Sensor.TYPE_ALL)
        Log.i(TAG, "센서 ${all.size}종 — 모션 계열만:")
        for (s in all) {
            if (s.type in MOTION_TYPES) {
                Log.i(TAG, "  ${s.stringType}(${s.type}) wake=${s.isWakeUpSensor} min=${s.minDelay}µs")
            }
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GYROSCOPE -> lastGyro = event.values.copyOf(3)
            Sensor.TYPE_ACCELEROMETER -> {
                val cb = onSample ?: return
                val row = pair(event.values, lastGyro, event.timestamp) ?: return
                tally(event.timestamp)
                cb(row)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    companion object {
        const val TAG = "VgImu"

        /** 50Hz — 모듈의 `FallMLPipeline.FS` 와 같은 값이어야 한다(피처가 fs 에 걸려 있다). */
        const val SAMPLING_US = 20_000

        private val MOTION_TYPES = setOf(
            Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE,
            Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_GRAVITY,
            Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_SIGNIFICANT_MOTION,
        )

        /** 몇 표본마다 실효 Hz 를 찍나. 50Hz 요청이면 60초에 한 번꼴이다. */
        const val STAT_EVERY = 3_000

        /** 건수와 경과 나노초 → Hz(소수 1자리). 경과가 0 이하면 **0 이 아니라 null 문자열**을 낸다. */
        internal fun hz(n: Int, elapsedNs: Long): String {
            if (elapsedNs <= 0L) return "?"      // 0.0 으로 적으면 "안 왔다" 로 오독된다
            return String.format(java.util.Locale.US, "%.1f", n * 1e9 / elapsedNs)
        }

        /** 표준 중력. 안드로이드 `SensorManager.GRAVITY_EARTH` 와 같은 값이되 시험에서 쓰려고 뗀다. */
        const val G = 9.80665

        /**
         * 안드로이드 m/s²(중력 포함) → 모듈 G(애플워치 규약).
         * 부호가 뒤집히는 이유 = 애플은 정지 시 **아래를 향한 축이 -1g** 로 나온다.
         */
        internal fun toModuleG(mss: Float): Double = -mss / G

        /**
         * 가속도 한 표본 + 최신 자이로 → 모듈 행 하나. **자이로가 없으면 null.**
         *
         * ★ 왜 떼어 놓는가. `SensorEvent` 는 시험에서 만들 수 없어서(생성자가 숨겨져 있다)
         *   `onSensorChanged` 안에 두면 이 규칙을 **부숴도 아무 시험이 안 빨개진다**.
         *   실제로 첫 판에서 그랬다 — 로거를 안 먹인 채 `assertNull` 을 보는 동어반복이었다.
         *   규칙을 순수 함수로 내리면 시험이 진짜로 잰다.
         */
        internal fun pair(accel: FloatArray, gyro: FloatArray?, atNs: Long): Row? {
            if (gyro == null) return null       // 0 으로 채우면 3채널이 "회전 없음" 이라 거짓말한다
            val ax = toModuleG(accel[0])
            val ay = toModuleG(accel[1])
            val az = toModuleG(accel[2])
            return Row(ax, ay, az,
                gyro[0].toDouble(), gyro[1].toDouble(), gyro[2].toDouble(),
                totalG = sqrt(ax * ax + ay * ay + az * az),
                atNs = atNs)
        }
    }
}

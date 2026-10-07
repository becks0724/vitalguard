package com.vitalguard.field.pilot.capture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.ExifInterface
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** ActivityResultLauncher는 매 Activity에 다시 등록하고, 진행 중 작업은 ViewModel에 남긴다. */
interface CaptureActivityHost {
    val activity: Activity
    fun launchScanner(sender: IntentSender)
    fun requestLocationPermission()
    fun requestCameraPermission()
}

/**
 * Flutter CaptureNative.kt에서 MethodChannel만 제거한 네이티브 포트.
 * applicationContext만 상시 보관한다. Activity 참조는 attach/detach 사이에만 유효하다.
 */
class CaptureNative(context: Context) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val hosts = MutableStateFlow<CaptureActivityHost?>(null)
    private val scannerMutex = Mutex()
    private val scanner = GmsDocumentScanning.getClient(
        GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build(),
    )
    private var preparedScanner: IntentSender? = null
    private data class ScanResult(val resultCode: Int, val data: Intent?)
    private var pendingScan: CompletableDeferred<ScanResult>? = null
    private var pendingLocationPermission: CompletableDeferred<Boolean>? = null
    private var pendingCameraPermission: CompletableDeferred<Boolean>? = null
    private var pendingLocation: CancellableContinuation<CaptureFix?>? = null
    private var locationCancellation: CancellationSignal? = null
    private var legacyLocationListener: LocationListener? = null
    private var locationTimeout: Runnable? = null

    fun attach(host: CaptureActivityHost) { hosts.value = host }

    fun detach(host: CaptureActivityHost) {
        if (hosts.value === host) hosts.value = null
    }

    private suspend fun currentHost(): CaptureActivityHost = hosts.filterNotNull().first()

    suspend fun prepareScanner(): Boolean = withContext(Dispatchers.Main.immediate) {
        try {
            scannerMutex.withLock {
                if (preparedScanner == null) preparedScanner = loadScannerIntent()
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun loadScannerIntent(): IntentSender = try {
        scanner.getStartScanIntent(currentHost().activity).awaitResult()
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        throw if (error is MlKitException && error.errorCode == MlKitException.UNSUPPORTED) {
            CaptureFailure("이 기기는 서류 스캔을 지원하지 않습니다.")
        } else {
            CaptureFailure(scannerPreparationMessage)
        }
    }

    suspend fun scanDocuments(): List<String>? = withContext(Dispatchers.Main.immediate) {
        if (pendingScan != null) throw CaptureFailure("이미 서류 스캔 중입니다.")
        val pending = CompletableDeferred<ScanResult>()
        pendingScan = pending
        val created = mutableListOf<File>()
        try {
            val sender = scannerMutex.withLock {
                val value = preparedScanner ?: loadScannerIntent()
                preparedScanner = null
                value
            }
            launchScanner(sender)
            val result = pending.await()
            if (result.resultCode != Activity.RESULT_OK) return@withContext null
            val pages = try {
                GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages.orEmpty()
            } catch (_: Exception) {
                throw CaptureFailure("스캔 이미지를 읽지 못했습니다.")
            }
            if (pages.isEmpty()) throw CaptureFailure("촬영된 서류가 없습니다.")
            try {
                withContext(Dispatchers.IO) {
                    pages.mapIndexed { index, page ->
                        val target = File(app.cacheDir, "scan-${UUID.randomUUID()}-${index + 1}.jpg")
                        created += target
                        app.contentResolver.openInputStream(page.imageUri).use { input ->
                            requireNotNull(input) { "스캔 이미지를 열 수 없습니다." }
                            target.outputStream().use(input::copyTo)
                        }
                        target.absolutePath
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                throw CaptureFailure("스캔 이미지를 읽지 못했습니다.")
            }
        } catch (error: Exception) {
            // 페이지 복사가 중간에 실패하거나 작업이 취소되면 복사 중인 원본도 정리한다.
            withContext(NonCancellable + Dispatchers.IO) { created.forEach { it.delete() } }
            throw error
        } finally {
            if (pendingScan === pending) pendingScan = null
        }
    }

    private suspend fun launchScanner(sender: IntentSender) {
        try {
            currentHost().launchScanner(sender)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw CaptureFailure(scannerPreparationMessage)
        }
    }

    fun onActivityResult(resultCode: Int, data: Intent?) {
        if (data?.hasExtra(ActivityResultContracts.StartIntentSenderForResult.EXTRA_SEND_INTENT_EXCEPTION) == true) {
            pendingScan?.completeExceptionally(CaptureFailure(scannerPreparationMessage))
        } else {
            pendingScan?.complete(ScanResult(resultCode, data))
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(app, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasLocationPermission(): Boolean =
        hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    suspend fun requestCameraPermission(): Boolean = withContext(Dispatchers.Main.immediate) {
        if (hasPermission(Manifest.permission.CAMERA)) return@withContext true
        val pending = CompletableDeferred<Boolean>()
        check(pendingCameraPermission == null)
        pendingCameraPermission = pending
        try {
            currentHost().requestCameraPermission()
            pending.await()
        } finally {
            if (pendingCameraPermission === pending) pendingCameraPermission = null
        }
    }

    fun onCameraPermissionResult(granted: Boolean) { pendingCameraPermission?.complete(granted) }

    fun onLocationPermissionResult(granted: Boolean) { pendingLocationPermission?.complete(granted) }

    suspend fun requestLocation(): CaptureFix? = withContext(Dispatchers.Main.immediate) {
        if (pendingLocation != null || pendingLocationPermission != null) {
            throw CaptureFailure("이미 위치를 확인하고 있습니다.")
        }
        if (!hasLocationPermission()) {
            val pending = CompletableDeferred<Boolean>()
            pendingLocationPermission = pending
            val granted = try {
                currentHost().requestLocationPermission()
                pending.await()
            } finally {
                if (pendingLocationPermission === pending) pendingLocationPermission = null
            }
            if (!granted) return@withContext null
        }
        suspendCancellableCoroutine { continuation ->
            pendingLocation = continuation
            continuation.invokeOnCancellation {
                main.post { completeLocation(null, continuation) }
            }
            try {
                beginLocation(continuation)
            } catch (_: Exception) {
                completeLocation(null, continuation)
            }
        }
    }

    @Suppress("MissingPermission")
    private fun recentLastLocation(manager: LocationManager): Location? {
        val now = System.currentTimeMillis()
        return manager.getProviders(true)
            .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .filter { now - it.time in 0..300_000 }
            .maxByOrNull { it.time }
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun beginLocation(pending: CancellableContinuation<CaptureFix?>) {
        if (!hasLocationPermission()) {
            completeLocation(null, pending)
            return
        }
        val manager = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val last = recentLastLocation(manager)
        val providers = manager.getProviders(true)
        val provider = when {
            hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) &&
                providers.contains(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            providers.contains(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> providers.firstOrNull()
        }
        if (provider == null) {
            completeLocation(last, pending)
            return
        }
        locationTimeout = Runnable { completeLocation(last, pending) }.also { main.postDelayed(it, 12_000) }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                locationCancellation = CancellationSignal()
                manager.getCurrentLocation(provider, locationCancellation, ContextCompat.getMainExecutor(app)) {
                    completeLocation(it ?: last, pending)
                }
            } else {
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) = completeLocation(location, pending)
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                    @Deprecated("Deprecated in Android")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                }
                legacyLocationListener = listener
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        } catch (_: Exception) {
            completeLocation(last, pending)
        }
    }

    private fun completeLocation(location: Location?, pending: CancellableContinuation<CaptureFix?>) {
        // 이전 요청의 늦은 콜백이 새 요청을 완료시키지 않도록 식별한다.
        if (pendingLocation !== pending) return
        pendingLocation = null
        locationTimeout?.let(main::removeCallbacks)
        locationTimeout = null
        locationCancellation?.cancel()
        locationCancellation = null
        legacyLocationListener?.let { listener ->
            val manager = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            runCatching { manager.removeUpdates(listener) }
        }
        legacyLocationListener = null
        if (pending.isActive) pending.resume(location?.let {
            CaptureFix(it.latitude, it.longitude, it.accuracy.toDouble(), Instant.ofEpochMilli(it.time))
        })
    }

    suspend fun reverseGeocode(fix: CaptureFix): String? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(app, Locale.KOREA)
        return if (Build.VERSION.SDK_INT >= 33) {
            suspendCancellableCoroutine { continuation ->
                // Geocoder의 콜백은 Binder 스레드에서 올 수 있다. Main에서 완료를 직렬화한다.
                fun complete(value: String?) { main.post { if (continuation.isActive) continuation.resume(value) } }
                try {
                    geocoder.getFromLocation(fix.latitude, fix.longitude, 1, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<Address>) {
                            complete(addresses.firstOrNull()?.let(::addressLine))
                        }
                        override fun onError(errorMessage: String?) { complete(null) }
                    })
                } catch (_: Exception) { complete(null) }
            }
        } else {
            withContext(Dispatchers.IO) {
                @Suppress("DEPRECATION")
                runCatching {
                    geocoder.getFromLocation(fix.latitude, fix.longitude, 1)?.firstOrNull()?.let(::addressLine)
                }.getOrNull()
            }
        }
    }

    private fun addressLine(address: Address): String? {
        val parts = listOf(
            address.adminArea, address.locality, address.subAdminArea,
            address.subLocality, address.thoroughfare, address.subThoroughfare,
        ).mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }.distinct()
        return parts.joinToString(" ").takeIf(String::isNotEmpty)
    }

    suspend fun stampResizeJpeg(path: String, lines: List<String>): ByteArray = withContext(Dispatchers.IO) {
        if (path.isBlank() || lines.isEmpty()) throw CaptureFailure("각인할 사진과 문구가 필요합니다.")
        try {
            val output = createStampedJpeg(path, lines, maxEdge = 2400, quality = 85)
            try { output.readBytes() } finally { output.delete() }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw CaptureFailure("각인 이미지를 만들지 못했습니다.")
        }
    }

    // 원본 CaptureNative.createStampedJpeg: EXIF 회전, 최대 변 2400, JPEG 85.
    private fun createStampedJpeg(path: String, lines: List<String>, maxEdge: Int, quality: Int): File {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
        val decoded = requireNotNull(
            BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample }),
        )
        val orientation = runCatching {
            ExifInterface(path).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val oriented = if (degrees == 0f) decoded else {
            Bitmap.createBitmap(
                decoded,
                0,
                0,
                decoded.width,
                decoded.height,
                Matrix().apply { postRotate(degrees) },
                true,
            ).also { decoded.recycle() }
        }
        val scale = (maxEdge.toFloat() / max(oriented.width, oriented.height)).coerceAtMost(1f)
        val width = (oriented.width * scale).roundToInt().coerceAtLeast(1)
        val height = (oriented.height * scale).roundToInt().coerceAtLeast(1)
        val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawBitmap(
            oriented,
            null,
            RectF(0f, 0f, width.toFloat(), height.toFloat()),
            Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
        )
        oriented.recycle()

        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textSize = max(14f, width * 0.026f)
        }
        var padding = textPaint.textSize * 0.5f
        val widest = lines.maxOf(textPaint::measureText)
        if (widest > width - padding * 2) {
            textPaint.textSize *= (width - padding * 2) / widest
            padding = textPaint.textSize * 0.5f
        }
        val lineHeight = textPaint.textSize * 1.32f
        val barHeight = lineHeight * lines.size + padding * 2
        canvas.drawRect(
            0f,
            height - barHeight,
            width.toFloat(),
            height.toFloat(),
            Paint().apply { color = Color.argb(158, 0, 0, 0) },
        )
        val metrics = textPaint.fontMetrics
        val firstBaseline = height - barHeight + padding - metrics.ascent
        lines.forEachIndexed { index, line ->
            canvas.drawText(line, padding, firstBaseline + index * lineHeight, textPaint)
        }

        val target = File(app.cacheDir, "stamped-${UUID.randomUUID()}.jpg")
        FileOutputStream(target).use { stream ->
            check(output.compress(Bitmap.CompressFormat.JPEG, quality, stream))
        }
        output.recycle()
        return target
    }


    fun close() {
        pendingScan?.cancel()
        pendingScan = null
        pendingCameraPermission?.cancel()
        pendingLocationPermission?.cancel()
        pendingLocation?.let { completeLocation(null, it) }
        preparedScanner = null
        hosts.value = null
    }
}

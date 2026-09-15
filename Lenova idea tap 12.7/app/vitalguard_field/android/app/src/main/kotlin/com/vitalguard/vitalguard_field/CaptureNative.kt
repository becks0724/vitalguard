package com.vitalguard.vitalguard_field

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
import androidx.core.app.ActivityCompat
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

class CaptureNative(
    private val activity: MainActivity,
    messenger: BinaryMessenger,
) {
    companion object {
        const val LOCATION_PERMISSION_REQUEST = 4102
        const val SCANNER_REQUEST = 5101
        private const val SCANNER_PREPARATION_MESSAGE = "인터넷에 연결해 한 번 준비해 주세요"
    }

    private val channel = MethodChannel(messenger, "vitalguard/capture")
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(false)
        .setPageLimit(20)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
    private val scanner = GmsDocumentScanning.getClient(scannerOptions)
    private var preparedScanner: IntentSender? = null
    private var pendingScan: MethodChannel.Result? = null
    private var pendingLocation: MethodChannel.Result? = null
    private var locationCancellation: CancellationSignal? = null
    private var legacyLocationListener: LocationListener? = null
    private var locationTimeout: Runnable? = null

    init {
        channel.setMethodCallHandler(::handle)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepareScanner" -> prepareScanner(result)
            "scanDocuments" -> scanDocuments(result)
            "requestLocation" -> requestLocation(result)
            "reverseGeocode" -> reverseGeocode(call, result)
            "stampResizeJpeg" -> stampResizeJpeg(call, result)
            else -> result.notImplemented()
        }
    }

    private fun scannerFailure(result: MethodChannel.Result, error: Exception) {
        if (error is MlKitException && error.errorCode == MlKitException.UNSUPPORTED) {
            result.error("scanner_unavailable", "이 기기는 서류 스캔을 지원하지 않습니다.", null)
        } else {
            result.error("scanner_not_ready", SCANNER_PREPARATION_MESSAGE, null)
        }
    }

    private fun prepareScanner(result: MethodChannel.Result) {
        preparedScanner?.let {
            result.success(true)
            return
        }
        scanner.getStartScanIntent(activity)
            .addOnSuccessListener {
                preparedScanner = it
                result.success(true)
            }
            .addOnFailureListener { scannerFailure(result, it) }
    }

    private fun scanDocuments(result: MethodChannel.Result) {
        if (pendingScan != null) {
            result.error("capture_busy", "이미 서류 스캔 중입니다.", null)
            return
        }
        pendingScan = result
        val ready = preparedScanner
        preparedScanner = null
        if (ready != null) {
            launchScanner(ready)
            return
        }
        scanner.getStartScanIntent(activity)
            .addOnSuccessListener(::launchScanner)
            .addOnFailureListener {
                val pending = pendingScan ?: return@addOnFailureListener
                pendingScan = null
                scannerFailure(pending, it)
            }
    }

    private fun launchScanner(intentSender: IntentSender) {
        try {
            activity.startIntentSenderForResult(
                intentSender,
                SCANNER_REQUEST,
                null,
                0,
                0,
                0,
            )
        } catch (_: IntentSender.SendIntentException) {
            pendingScan?.error("scanner_not_ready", SCANNER_PREPARATION_MESSAGE, null)
            pendingScan = null
        }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != SCANNER_REQUEST) return false
        val pending = pendingScan ?: return true
        pendingScan = null
        if (resultCode != Activity.RESULT_OK) {
            pending.success(null)
            return true
        }
        try {
            val scanned = GmsDocumentScanningResult.fromActivityResultIntent(data)
            val pages = scanned?.pages.orEmpty()
            if (pages.isEmpty()) {
                pending.error("scanner_empty", "촬영된 서류가 없습니다.", null)
                return true
            }
            val paths = pages.mapIndexed { index, page ->
                val target = File(activity.cacheDir, "scan-${UUID.randomUUID()}-${index + 1}.jpg")
                activity.contentResolver.openInputStream(page.imageUri).use { input ->
                    requireNotNull(input) { "스캔 이미지를 열 수 없습니다." }
                    target.outputStream().use(input::copyTo)
                }
                target.absolutePath
            }
            pending.success(paths)
        } catch (_: Exception) {
            pending.error("scanner_result_error", "스캔 이미지를 읽지 못했습니다.", null)
        }
        return true
    }

    private fun hasLocationPermission(): Boolean =
        activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun requestLocation(result: MethodChannel.Result) {
        if (pendingLocation != null) {
            result.error("location_busy", "이미 위치를 확인하고 있습니다.", null)
            return
        }
        pendingLocation = result
        if (!hasLocationPermission()) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                LOCATION_PERMISSION_REQUEST,
            )
            return
        }
        beginLocation()
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != LOCATION_PERMISSION_REQUEST) return false
        if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            beginLocation()
        } else {
            completeLocation(null)
        }
        return true
    }

    private fun recentLastLocation(manager: LocationManager): Location? {
        val now = System.currentTimeMillis()
        return manager.getProviders(true)
            .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .filter { now - it.time in 0..300_000 }
            .maxByOrNull { it.time }
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun beginLocation() {
        val pending = pendingLocation ?: return
        if (!hasLocationPermission()) {
            pendingLocation = null
            pending.success(null)
            return
        }
        val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val last = recentLastLocation(manager)
        val providers = manager.getProviders(true)
        val fineGranted =
            activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val provider = when {
            fineGranted && providers.contains(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            providers.contains(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> providers.firstOrNull()
        }
        if (provider == null) {
            completeLocation(last)
            return
        }
        locationTimeout = Runnable { completeLocation(last) }.also { main.postDelayed(it, 12_000) }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                locationCancellation = CancellationSignal()
                manager.getCurrentLocation(provider, locationCancellation, activity.mainExecutor) {
                    completeLocation(it ?: last)
                }
            } else {
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) = completeLocation(location)
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                    @Deprecated("Deprecated in Android")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                }
                legacyLocationListener = listener
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        } catch (_: Exception) {
            completeLocation(last)
        }
    }

    private fun completeLocation(location: Location?) {
        val pending = pendingLocation ?: return
        pendingLocation = null
        locationTimeout?.let(main::removeCallbacks)
        locationTimeout = null
        locationCancellation?.cancel()
        locationCancellation = null
        legacyLocationListener?.let { listener ->
            val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            runCatching { manager.removeUpdates(listener) }
        }
        legacyLocationListener = null
        if (location == null) {
            pending.success(null)
        } else {
            pending.success(
                mapOf(
                    "latitude" to location.latitude,
                    "longitude" to location.longitude,
                    "accuracyMeters" to location.accuracy.toDouble(),
                    "timestampEpochMs" to location.time,
                ),
            )
        }
    }

    private fun reverseGeocode(call: MethodCall, result: MethodChannel.Result) {
        val latitude = call.argument<Double>("latitude")
        val longitude = call.argument<Double>("longitude")
        if (latitude == null || longitude == null) {
            result.error("invalid_location", "주소를 찾을 좌표가 없습니다.", null)
            return
        }
        if (!Geocoder.isPresent()) {
            result.success(null)
            return
        }
        val geocoder = Geocoder(activity, Locale.KOREA)
        if (Build.VERSION.SDK_INT >= 33) {
            geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) {
                    main.post { result.success(addresses.firstOrNull()?.let(::addressLine)) }
                }

                override fun onError(errorMessage: String?) {
                    main.post { result.success(null) }
                }
            })
        } else {
            worker.execute {
                @Suppress("DEPRECATION")
                val address = runCatching {
                    geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()?.let(::addressLine)
                }.getOrNull()
                main.post { result.success(address) }
            }
        }
    }

    private fun addressLine(address: Address): String? {
        val parts = listOf(
            address.adminArea,
            address.locality,
            address.subAdminArea,
            address.subLocality,
            address.thoroughfare,
            address.subThoroughfare,
        ).mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }.distinct()
        return parts.joinToString(" ").takeIf(String::isNotEmpty)
    }

    private fun stampResizeJpeg(call: MethodCall, result: MethodChannel.Result) {
        val path = call.argument<String>("path")
        val lines = call.argument<List<String>>("lines")
        val maxEdge = call.argument<Int>("maxEdge") ?: 2400
        val quality = (call.argument<Int>("quality") ?: 85).coerceIn(1, 100)
        if (path.isNullOrBlank() || lines.isNullOrEmpty()) {
            result.error("invalid_capture", "각인할 사진과 문구가 필요합니다.", null)
            return
        }
        worker.execute {
            try {
                val output = createStampedJpeg(path, lines, maxEdge, quality)
                main.post { result.success(output.absolutePath) }
            } catch (_: Exception) {
                main.post { result.error("image_processing_failed", "각인 이미지를 만들지 못했습니다.", null) }
            }
        }
    }

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

        val target = File(activity.cacheDir, "stamped-${UUID.randomUUID()}.jpg")
        FileOutputStream(target).use { stream ->
            check(output.compress(Bitmap.CompressFormat.JPEG, quality, stream))
        }
        output.recycle()
        return target
    }

    fun close() {
        channel.setMethodCallHandler(null)
        pendingScan?.error("capture_closed", "촬영 화면이 종료됐습니다.", null)
        pendingScan = null
        completeLocation(null)
        preparedScanner = null
        worker.shutdown()
    }
}

package com.vitalguard.field.compatibility

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import com.vitalguard.field.data.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.record.InkStroke
import kotlinx.coroutines.runBlocking
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant

/** Included only in the isolated probe APK, never in the application release.
 * Reads the installed Flutter sandbox using the actual Compose storage/model classes.
 * Does not construct FieldCoordinator, open an Activity, refresh a session or write any data.
 * Only counts/booleans leave the device; tokens, account IDs and paths do not.
 */
class StorageCompatibilityProbe : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val report = Bundle()
        val root = targetContext.noBackupFilesDir
        val before = fingerprint(root)
        var success = false
        try {
            runBlocking {
                val store = DeviceLocalStore(targetContext)
                val hasToken = File(root, "field-session.enc").isFile
                // KeystoreTokens.key() may generate a key when absent. Reject before entering it.
                if (hasToken) check(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                    .containsAlias("vitalguard.field.session.v1"))
                report.putBoolean("token_present", hasToken)
                store.readTokenBundle()?.let { raw ->
                    val data = Json.decodeObject(raw)
                    val session = MobileSession(requireNotNull(data["session"].jsonObjectOrNull()))
                    check(session.accessToken.isNotEmpty() && session.refreshToken.isNotEmpty() && session.user.id.isNotEmpty())
                    check(session.user.role in setOf("platform_admin", "owner", "site_manager", "admin"))
                    parseInstant(data["localAccessExpiresAt"] as String)
                    report.putBoolean("refresh_not_expired", parseInstant(session.refreshExpiresAt) > Instant.now())
                    report.putBoolean("token_decoded_by_compose", true)
                }
                val accountsRoot = File(root, "field-records/accounts")
                val owners = if (!accountsRoot.exists()) emptyList() else accountsRoot.walkTopDown()
                    .filter { it.isDirectory && it.name == "entries" }
                    .map { it.parentFile.relativeTo(accountsRoot).invariantSeparatorsPath.split('/') }
                    .map { requireNotNull(localStoreKeyFromSegments(it)) }.toList()
                var keys = 0; var entries = 0; var pending = 0; var legacyPending = 0
                var missingFiles = 0; var drafts = 0; var invalid = 0
                for (owner in owners) for (key in store.keys(owner)) {
                    keys++
                    try {
                        when {
                            key == outboxStorageKey -> {
                                val data = Json.decodeObject(requireNotNull(store.read(owner, key)))
                                check(data["schemaVersion"] == 1)
                                for (item in data["items"] as List<*>) {
                                    val json = requireNotNull(item.jsonObjectOrNull())
                                    val record = OutboxEntry.fromJson(json)
                                    check(record.owner == owner && record.fields["clientOperationId"] == record.id)
                                    entries++
                                    if (record.phase != OutboxPhase.completed) {
                                        pending++
                                        if ("autoSendReady" !in json) legacyPending++
                                        if (record.kind != OutboxKind.text && store.readBytes(owner, record.bytesKey) == null) missingFiles++
                                    }
                                }
                            }
                            key.startsWith("annotation:") -> {
                                val data = Json.decodeObject(requireNotNull(store.read(owner, key)))
                                (data["strokes"] as? List<*>).orEmpty().forEach { InkStroke.fromJson(requireNotNull(it.jsonObjectOrNull())) }
                                drafts++
                            }
                            key == "record:active-draft" || key.startsWith("comment-draft:") ||
                                (key.startsWith("voice-comment-draft:") && !key.endsWith(":audio")) -> {
                                Json.decodeObject(requireNotNull(store.read(owner, key))); drafts++
                            }
                            else -> check(store.readBytes(owner, key) != null)
                        }
                    } catch (_: Exception) { invalid++ }
                }
                report.putInt("accounts", owners.size); report.putInt("keys", keys)
                report.putInt("outbox_entries", entries); report.putInt("pending_entries", pending)
                report.putInt("legacy_pending_entries", legacyPending); report.putInt("drafts", drafts)
                report.putInt("missing_pending_files", missingFiles); report.putInt("invalid_records", invalid)
                check(invalid == 0 && missingFiles == 0)
            }
            success = true
        } catch (_: Exception) { report.putString("failure", "storage_compatibility_failed") }
        val unchanged = before == fingerprint(root)
        report.putBoolean("files_unchanged", unchanged)
        report.putBoolean("success", success && unchanged)
        finish(if (success && unchanged) Activity.RESULT_OK else Activity.RESULT_CANCELED, report)
    }
    private fun fingerprint(root: File): Map<String, String> = root.walkTopDown().filter { it.isFile }.associate {
        it.relativeTo(root).invariantSeparatorsPath to MessageDigest.getInstance("SHA-256")
            .digest(it.readBytes()).joinToString("") { byte -> "%02x".format(byte) }
    }
}

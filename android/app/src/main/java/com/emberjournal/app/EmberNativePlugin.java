package com.emberjournal.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** The pairing code is encrypted by Android Keystore and never returned to JS. */
@CapacitorPlugin(name = "EmberNative")
public class EmberNativePlugin extends Plugin {
    private static final String PREFERENCES = "ember_native_connection";
    private static final String KEY_ALIAS = "ember.connection.aes.v1";
    private static final String RECORD = "encrypted_connection";
    private static final int MAX_BODY_BYTES = 5 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 200 * 1024;
    private static final int MAX_BACKUP_BYTES = 100 * 1024 * 1024;
    private final ExecutorService worker = Executors.newFixedThreadPool(2);
    private final AtomicLong generation = new AtomicLong();
    private final AtomicBoolean destroyed = new AtomicBoolean();
    private final AtomicBoolean identifying = new AtomicBoolean();
    private final AtomicReference<HttpsURLConnection> connection = new AtomicReference<>();
    private final AtomicReference<Backup> backup = new AtomicReference<>();
    private final Object settingsLock = new Object();
    private final WebViewListener lifecycle = new WebViewListener() {
        @Override public void onPageStarted(WebView view) { cancelOutstanding(); }
    };

    @Override public void load() { getBridge().addWebViewListener(lifecycle); }

    @PluginMethod public void getConnection(PluginCall call) {
        submit(call, epoch -> {
            SavedConnection saved = readConnection();
            resolve(call, epoch, summary(saved));
        });
    }

    @PluginMethod public void configureConnection(PluginCall call) {
        submit(call, epoch -> {
            String url = validateOrigin(call.getString("url"));
            String token = validateToken(call.getString("token"));
            call.getData().remove("token");
            synchronized (settingsLock) {
                if (!current(epoch)) return;
                byte[] plaintext = new JSONObject().put("url", url).put("token", token)
                    .toString().getBytes(StandardCharsets.UTF_8);
                try {
                    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey(true));
                    String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
                        Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP);
                    if (!preferences().edit().putString(RECORD, encrypted).commit())
                        throw new NativeFailure("STORAGE_FAILED", "The connection could not be saved on this phone.");
                } finally { Arrays.fill(plaintext, (byte) 0); }
            }
            resolve(call, epoch, summary(new SavedConnection(url, token)));
        });
    }

    @PluginMethod public void clearConnection(PluginCall call) {
        submit(call, epoch -> {
            synchronized (settingsLock) {
                if (!current(epoch)) return;
                if (!preferences().edit().remove(RECORD).commit())
                    throw new NativeFailure("STORAGE_FAILED", "The connection could not be removed. Please try again.");
                KeyStore store = KeyStore.getInstance("AndroidKeyStore");
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            }
            HttpsURLConnection active = connection.getAndSet(null);
            if (active != null) active.disconnect();
            resolve(call, epoch, summary(null));
        });
    }

    @PluginMethod public void identify(PluginCall call) {
        if (!identifying.compareAndSet(false, true)) {
            call.reject("Wait for the current identification to finish.", "IDENTIFICATION_BUSY");
            return;
        }
        submit(call, epoch -> {
            HttpsURLConnection request = null;
            byte[] body = null;
            try {
                SavedConnection saved = readConnection();
                if (saved == null)
                    throw new NativeFailure("NOT_CONFIGURED", "Pair this phone with an Ember service in Settings before identifying a photo.");
                String text = call.getString("body");
                if (text == null || text.isEmpty() || text.length() > MAX_BODY_BYTES)
                    throw new NativeFailure("INVALID_BODY", "Choose a smaller photo and try again.");
                body = text.getBytes(StandardCharsets.UTF_8);
                call.getData().remove("body");
                if (body.length > MAX_BODY_BYTES)
                    throw new NativeFailure("BODY_TOO_LARGE", "The photo request exceeds 5 MB. Choose a smaller photo.");
                new JSONObject(text);
                if (!current(epoch)) return;
                request = (HttpsURLConnection) new URI(saved.url + "/api/identify").toURL().openConnection();
                connection.set(request);
                request.setInstanceFollowRedirects(false);
                request.setConnectTimeout(15_000);
                request.setReadTimeout(90_000);
                request.setUseCaches(false);
                request.setRequestMethod("POST");
                request.setRequestProperty("Authorization", "Bearer " + saved.token);
                request.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                request.setRequestProperty("Accept", "application/json");
                request.setFixedLengthStreamingMode(body.length);
                request.setDoOutput(true);
                if (!current(epoch)) return;
                try (OutputStream output = request.getOutputStream()) { output.write(body); }
                int status = request.getResponseCode();
                JSObject data;
                if (status >= 300 && status < 400) {
                    data = new JSObject().put("error", "The service redirected this request. Enter its direct HTTPS address in Settings.")
                        .put("code", "REDIRECT_REFUSED");
                } else {
                    if (request.getContentLengthLong() > MAX_RESPONSE_BYTES)
                        throw new NativeFailure("RESPONSE_TOO_LARGE", "The service returned an oversized response.");
                    InputStream stream = status >= 400 ? request.getErrorStream() : request.getInputStream();
                    String response;
                    try (InputStream input = stream) { response = readResponse(input, epoch); }
                    try { data = new JSObject(response); }
                    catch (Exception ignored) {
                        if (status >= 200 && status < 300)
                            throw new NativeFailure("INVALID_RESPONSE", "The service returned an unreadable identification result.");
                        data = new JSObject().put("error", status == 401 || status == 403
                            ? "The service refused the pairing code. Check your connection in Settings."
                            : "The identification service could not finish. Please try again.");
                    }
                }
                resolve(call, epoch, new JSObject().put("status", status).put("data", data));
            } catch (NativeFailure failure) { throw failure; }
            catch (java.net.SocketTimeoutException ignored) {
                throw new NativeFailure("IDENTIFICATION_TIMEOUT", "Identification took too long. Try again when your connection is stable.");
            } catch (Exception ignored) {
                throw new NativeFailure("IDENTIFICATION_FAILED", "The secure service connection could not finish. Check the address, connection and pairing code.");
            } finally {
                if (body != null) Arrays.fill(body, (byte) 0);
                if (request != null) { connection.compareAndSet(request, null); request.disconnect(); }
                identifying.set(false);
            }
        }, () -> identifying.set(false));
    }

    @PluginMethod public void saveBackup(PluginCall call) {
        String contents = call.getString("contents");
        String filename = call.getString("filename");
        if (contents == null || contents.length() > MAX_BACKUP_BYTES) {
            call.reject("This backup exceeds 100 MB or has no contents.", "BACKUP_TOO_LARGE");
            return;
        }
        if (filename == null || filename.length() > 120 || !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]*\\.json")) {
            call.reject("Use a short JSON filename without folder paths.", "INVALID_FILENAME");
            return;
        }
        long epoch = generation.get();
        Backup pending = new Backup(call.getCallbackId(), contents, filename, epoch);
        if (!backup.compareAndSet(null, pending)) {
            call.reject("Finish or cancel the current backup first.", "BACKUP_BUSY");
            return;
        }
        // Never put photos or a large journal in an Android saved-state Bundle.
        call.getData().remove("contents");
        submit(call, taskEpoch -> {
            if (!current(epoch) || backup.get() != pending) return;
            if (utf8Length(contents) > MAX_BACKUP_BYTES) {
                backup.compareAndSet(pending, null);
                throw new NativeFailure("BACKUP_TOO_LARGE", "This backup exceeds 100 MB.");
            }
            getActivity().runOnUiThread(() -> {
                if (!current(epoch) || backup.get() != pending) return;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, pending.filename);
                try { startActivityForResult(call, intent, "backupPicked"); }
                catch (Exception ignored) {
                    backup.compareAndSet(pending, null);
                    reject(call, epoch, "Android could not open the document picker.", "PICKER_UNAVAILABLE");
                }
            });
        }, () -> backup.compareAndSet(pending, null));
    }

    @ActivityCallback private void backupPicked(PluginCall call, ActivityResult result) {
        Backup pending = backup.get();
        if (call == null || pending == null || !pending.callId.equals(call.getCallbackId()) || !current(pending.epoch)) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            backup.compareAndSet(pending, null);
            resolve(call, pending.epoch, new JSObject().put("saved", false));
            return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || !"content".equals(uri.getScheme())) {
            backup.compareAndSet(pending, null);
            reject(call, pending.epoch, "Android did not return a writable document.", "INVALID_DOCUMENT");
            return;
        }
        submit(call, epoch -> {
            try {
                if (!current(pending.epoch) || backup.get() != pending) return;
                OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w");
                if (output == null) throw new IOException("No stream");
                try (Writer writer = new OutputStreamWriter(output, StandardCharsets.UTF_8)) {
                    for (int offset = 0; offset < pending.contents.length(); offset += 8192) {
                        if (!current(pending.epoch)) throw new IOException("Cancelled");
                        writer.write(pending.contents, offset, Math.min(8192, pending.contents.length() - offset));
                    }
                }
                resolve(call, pending.epoch, new JSObject().put("saved", true));
            } catch (Exception ignored) {
                reject(call, pending.epoch, "The backup could not finish. The selected file may be incomplete; export it again.", "BACKUP_WRITE_FAILED");
            } finally { backup.compareAndSet(pending, null); }
        }, () -> backup.compareAndSet(pending, null));
    }

    @Override protected Bundle saveInstanceState() { return null; }

    @Override protected void handleOnDestroy() {
        destroyed.set(true);
        cancelOutstanding();
        getBridge().removeWebViewListener(lifecycle);
        worker.shutdownNow();
    }

    private void cancelOutstanding() {
        generation.incrementAndGet();
        Backup pending = backup.getAndSet(null);
        if (pending != null) getBridge().releaseCall(pending.callId);
        HttpsURLConnection active = connection.getAndSet(null);
        if (active != null) active.disconnect();
    }

    private boolean current(long epoch) { return !destroyed.get() && generation.get() == epoch; }

    private interface Work { void run(long epoch) throws Exception; }
    private void submit(PluginCall call, Work work) { submit(call, work, () -> {}); }
    private void submit(PluginCall call, Work work, Runnable skipped) {
        long epoch = generation.get();
        try {
            worker.execute(() -> {
                if (!current(epoch)) { skipped.run(); return; }
                try { work.run(epoch); }
                catch (NativeFailure failure) { reject(call, epoch, failure.getMessage(), failure.code); }
                catch (Exception ignored) { reject(call, epoch, "Android could not complete this operation. Please try again.", "NATIVE_FAILED"); }
            });
        } catch (RejectedExecutionException ignored) {
            skipped.run();
            reject(call, epoch, "Reopen Ember to try again.", "APP_CLOSED");
        }
    }

    private void resolve(PluginCall call, long epoch, JSObject data) {
        if (current(epoch)) getActivity().runOnUiThread(() -> { if (current(epoch)) call.resolve(data); });
    }
    private void reject(PluginCall call, long epoch, String message, String code) {
        if (current(epoch)) getActivity().runOnUiThread(() -> { if (current(epoch)) call.reject(message, code); });
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private SavedConnection readConnection() throws Exception {
        synchronized (settingsLock) {
            String record = preferences().getString(RECORD, null);
            if (record == null) return null;
            try {
                String[] parts = record.split("\\.", -1);
                if (parts.length != 2) throw new IOException("Invalid record");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, encryptionKey(false), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                byte[] plaintext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
                try {
                    JSONObject saved = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
                    return new SavedConnection(validateOrigin(saved.getString("url")), validateToken(saved.getString("token")));
                } finally { Arrays.fill(plaintext, (byte) 0); }
            } catch (Exception ignored) {
                throw new NativeFailure("CONNECTION_UNAVAILABLE", "The saved connection could not be unlocked. Pair this phone again in Settings.");
            }
        }
    }

    private SecretKey encryptionKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        if (!create) throw new IOException("Key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private static String validateOrigin(String value) throws NativeFailure {
        try {
            if (value == null || value.length() > 2048) throw new IllegalArgumentException();
            URI uri = new URI(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null ||
                (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/")) ||
                uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();
            return new URI("https", null, uri.getHost().toLowerCase(Locale.ROOT), uri.getPort(), null, null, null).toASCIIString();
        } catch (Exception ignored) {
            throw new NativeFailure("INVALID_SERVICE_URL", "Enter an HTTPS service address without a path, sign-in details, query or fragment.");
        }
    }

    private static String validateToken(String token) throws NativeFailure {
        if (token != null && token.startsWith("sk-"))
            throw new NativeFailure("INVALID_PAIRING_CODE", "Use an Ember pairing code, not an OpenAI API key.");
        if (token == null || token.length() < 32 || token.length() > 256 || !token.matches("[A-Za-z0-9._~+/-]+={0,2}"))
            throw new NativeFailure("INVALID_PAIRING_CODE", "Paste the complete Ember pairing code without spaces or line breaks.");
        return token;
    }

    private String readResponse(InputStream input, long epoch) throws Exception {
        if (input == null) return "";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (!current(epoch)) throw new IOException("Cancelled");
            if (bytes.size() + count > MAX_RESPONSE_BYTES)
                throw new NativeFailure("RESPONSE_TOO_LARGE", "The service returned an oversized response.");
            bytes.write(buffer, 0, count);
        }
        return bytes.toString(StandardCharsets.UTF_8.name());
    }

    private static long utf8Length(String value) {
        long bytes = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= 0x7f) bytes++;
            else if (c <= 0x7ff) bytes += 2;
            else if (Character.isHighSurrogate(c) && i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) { bytes += 4; i++; }
            else if (Character.isSurrogate(c)) bytes++;
            else bytes += 3;
            if (bytes > MAX_BACKUP_BYTES) return bytes;
        }
        return bytes;
    }

    private static JSObject summary(SavedConnection saved) {
        return new JSObject().put("url", saved == null ? "" : saved.url).put("configured", saved != null);
    }

    private static final class SavedConnection {
        final String url;
        final String token;
        SavedConnection(String url, String token) { this.url = url; this.token = token; }
    }

    private static final class Backup {
        final String callId;
        final String contents;
        final String filename;
        final long epoch;
        Backup(String callId, String contents, String filename, long epoch) {
            this.callId = callId; this.contents = contents; this.filename = filename; this.epoch = epoch;
        }
    }

    private static final class NativeFailure extends Exception {
        final String code;
        NativeFailure(String code, String message) { super(message); this.code = code; }
    }
}

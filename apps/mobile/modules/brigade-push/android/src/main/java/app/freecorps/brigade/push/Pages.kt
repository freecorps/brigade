package app.freecorps.brigade.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.freecorps.brigade.call.Calls
import app.freecorps.brigade.call.IncomingCall
import app.freecorps.brigade.call.PAGE_CHANNEL
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * What the phone does with a push from the relay (RFC 0006, RFC 0010): opens it with the device key, shows the page on
 * the "Pages" channel (or rings, for a call), and reports that it opened it. Unreadable, it still shows the fallback
 * text: never silent.
 */
object Pages {
  private const val TAG = "BrigadePush"
  /** Anything less urgent than a page: an incident's later news, with the default sound. */
  const val UPDATES_CHANNEL = "brigade_updates"
  const val EXTRA_INCIDENT = "app.freecorps.brigade.push.INCIDENT"
  const val EXTRA_WORKSPACE = "app.freecorps.brigade.push.WORKSPACE"
  const val EXTRA_ISSUED_AT = "app.freecorps.brigade.push.ISSUED_AT"
  const val EXTRA_PROOF = "app.freecorps.brigade.push.PROOF"
  private const val PREFS = "brigade_push"
  private const val RECEIPT_ORIGIN = "receipt-origin-v1"
  private const val TAP_KEY = "tap-key-v1"
  /** How long a receipt may take; the page is already on screen. Matches the iOS extension. */
  private const val RECEIPT_TIMEOUT_MS = 5_000

  private val main = Handler(Looper.getMainLooper())

  fun handle(context: Context, data: Map<String, String>) {
    val message = PushMessage.parse(data)
    val content = message?.let { open(context, it) }
    if (message == null || content == null) {
      // Malformed, another version, or not for this key (rotated, a reinstall): the fallback, on the channel its
      // urgency (in clear) asks for, or the pages channel when even that is unreadable.
      Log.w(TAG, "push not opened: fallback text")
      notify(context, null, message?.tag, message == null || message.isPage)
      return
    }
    if (message.isCall) {
      ring(context, IncomingCall(message.callId!!, content.title, content.body, content.incident))
    } else {
      notify(context, content, message.tag ?: content.incident, message.isPage)
    }
    // Only for a page it opened: the fallback has no token. Calls carry none (RFC 0006).
    content.receipt?.let { sendReceipt(context, it) }
  }

  private fun open(context: Context, message: PushMessage): PushContent? =
    try {
      val recipient = DeviceKey.existingPublicKey(context) ?: throw IllegalStateException("no device key")
      val plaintext = Hpke.open(message.enc, message.ct, PUSH_HPKE_INFO, recipient) { ephemeral ->
        DeviceKey.agree(context, ephemeral)
      }
      PushContent.parse(plaintext)
    } catch (error: Exception) {
      // Never the content or the key.
      Log.w(TAG, "decryption failed: ${error.javaClass.simpleName}")
      null
    }

  /** Calls lives on the main thread; the service waits (a few seconds at most) so the ring starts before it returns. */
  private fun ring(context: Context, call: IncomingCall) {
    val done = CountDownLatch(1)
    main.post {
      try {
        Calls.ring(context.applicationContext, call)
      } catch (error: Exception) {
        Log.w(TAG, "ring failed: $error")
        notify(context, PushContent(call.title, call.body, call.incident, null, null), call.incident, true)
      } finally {
        done.countDown()
      }
    }
    done.await(5, TimeUnit.SECONDS)
  }

  /** A page on the "Pages" channel (alarm sound, vibration), anything less urgent on the updates channel. */
  fun notify(context: Context, content: PushContent?, tag: String?, page: Boolean) {
    ensureChannels(context)
    val title = content?.title ?: context.brigadeString("push_fallback_title")
    val body = content?.body ?: context.brigadeString("push_fallback_body")
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      // Tapping opens this incident (the app reads them, src/hooks/use-page-taps.ts).
      if (content?.incident != null && content.workspace != null) {
        val issuedAt = System.currentTimeMillis()
        putExtra(EXTRA_INCIDENT, content.incident)
        putExtra(EXTRA_WORKSPACE, content.workspace)
        // The launcher activity is exported: the proof says this notification put them there (PageTap).
        putExtra(EXTRA_ISSUED_AT, issuedAt)
        putExtra(EXTRA_PROOF, PageTap.sign(tapKey(context), content.incident, content.workspace, issuedAt))
      }
    }
    val key = tag ?: "brigade"
    val notification = NotificationCompat.Builder(context, if (page) PAGE_CHANNEL else UPDATES_CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(if (page) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(if (page) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .apply {
        if (open != null) {
          setContentIntent(
            PendingIntent.getActivity(
              context,
              key.hashCode(),
              open,
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
          )
        }
      }
      .build()
    try {
      // The tag replaces an earlier notification for the same incident and urgency, as APNs' collapse id does.
      NotificationManagerCompat.from(context).notify(key, 0, notification)
    } catch (error: SecurityException) {
      // Notifications not allowed: nothing can show. The instance escalates without waiting on this phone.
      Log.w(TAG, "notification refused: $error")
    }
  }

  /**
   * The "Pages" channel comes from the call module (alarm sound, vibration; it asks Do Not Disturb to let pages
   * through, which only takes effect once the user grants Brigade that access in Settings: the app never asks). The
   * updates channel is the default sound.
   */
  fun ensureChannels(context: Context) {
    Calls.ensureChannels(context)
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(UPDATES_CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          UPDATES_CHANNEL,
          context.brigadeString("push_channel_updates"),
          NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { lockscreenVisibility = Notification.VISIBILITY_PUBLIC },
      )
    }
  }

  fun setReceiptOrigin(context: Context, value: String): Boolean {
    val origin = PushReceipt.originOf(value) ?: return false
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(RECEIPT_ORIGIN, origin).apply()
    return true
  }

  /** The key tap proofs are made with ([PageTap]), created on first use, in the app's private preferences. */
  @Synchronized
  fun tapKey(context: Context): ByteArray {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString(TAP_KEY, null)?.let(Base64url::decode)?.takeIf { it.size == PageTap.KEY_LENGTH }?.let { return it }
    val key = PageTap.newKey()
    prefs.edit().putString(TAP_KEY, Base64url.encode(key)).commit()
    return key
  }

  private fun receiptOrigin(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(RECEIPT_ORIGIN, null)

  /**
   * `POST { token }` to the page's receipt URL, only on the instance the app registered with: anyone holding the device
   * public key could seal a page naming another (RFC 0006 "Delivery receipts"). Best effort: 5 s, no retry, no
   * cookies, the token never logged.
   */
  private fun sendReceipt(context: Context, receipt: PushReceipt) {
    if (!receipt.isFor(receiptOrigin(context))) {
      Log.w(TAG, "receipt not sent: not the registered instance")
      return
    }
    try {
      val connection = URL(receipt.url).openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "POST"
        connection.connectTimeout = RECEIPT_TIMEOUT_MS
        connection.readTimeout = RECEIPT_TIMEOUT_MS
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(JSONObject().put("token", receipt.token).toString().toByteArray()) }
        Log.i(TAG, "receipt answered ${connection.responseCode}")
      } finally {
        connection.disconnect()
      }
    } catch (error: Exception) {
      Log.w(TAG, "receipt not sent: ${error.javaClass.simpleName}")
    }
  }
}

/** HPKE `info`, packages/push `PUSH_HPKE_INFO`: binds every page to this protocol and version. */
val PUSH_HPKE_INFO = "app.freecorps.brigade push v1".toByteArray()

/** A string from the app's resources, which plugins/incoming-call.ts generates from packages/i18n. */
internal fun Context.brigadeString(name: String): String {
  val id = resources.getIdentifier(name, "string", packageName)
  return if (id != 0) getString(id) else name
}

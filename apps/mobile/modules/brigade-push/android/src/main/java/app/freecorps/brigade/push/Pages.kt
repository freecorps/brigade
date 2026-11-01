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
  /** The instance a version 2 page sealed: the tap opens it there (RFC 0015 section 5). */
  const val EXTRA_ORIGIN = "app.freecorps.brigade.push.ORIGIN"
  private const val PREFS = "brigade_push"
  /** The one paired instance from before several instances; merged into [RECEIPT_ORIGINS] on the next change. */
  private const val RECEIPT_ORIGIN = "receipt-origin-v1"
  private const val RECEIPT_ORIGINS = "receipt-origins-v2"
  private const val TAP_KEY = "tap-key-v1"
  /** How long a receipt may take; the page is already on screen. Matches the iOS extension. */
  private const val RECEIPT_TIMEOUT_MS = 5_000

  private val main = Handler(Looper.getMainLooper())

  fun handle(context: Context, data: Map<String, String>) {
    val message = PushMessage.parse(data)
    if (message == null) {
      // Malformed or another version: the fallback on the pages channel. Never silent.
      Log.w(TAG, "push not readable: fallback text")
      notify(context, null, null, true)
      return
    }
    val opened = open(context, message)
    val content = opened.content
    // The sealed urgency picks the channel once the push opened (shown, or refused for another origin or pairing);
    // the clear one when it did not open or was expired, so those stay as loud as the relay asked.
    val page = PushChecks.isPage(message.isPage, opened.sealed, opened.refusal)
    // Version 2: only a sealed page rings (RFC 0015 section 4); a call push sealed as anything less is not one.
    val sealedNotPage = message.isCall && content?.sealed?.isPage == false
    if (content == null || sealedNotPage) {
      // Not for this key (rotated, a reinstall), or a v2 push refused: the fallback text. Never silent.
      Log.w(TAG, "push not opened: fallback text")
      notify(context, null, message.tag, page)
      return
    }
    if (message.isCall) {
      ring(
        context,
        IncomingCall(
          message.callId!!,
          content.title,
          content.body,
          content.incident,
          content.workspace,
          content.sealed?.origin,
        ),
      )
    } else {
      notify(context, content, message.tag ?: content.incident, page)
    }
    // Only for a page it opened: the fallback has no token. Calls carry none (RFC 0006). Only to a paired instance.
    val receipt = PushChecks.receiptToSend(content, receiptOrigins(context))
    if (receipt != null) {
      sendReceipt(receipt)
    } else if (content.receipt != null) {
      Log.w(TAG, "receipt not sent: not the paired instance")
    }
  }

  /**
   * What opening a push gave: the content to show (null: the fallback text), and for a v2 push that opened, what it
   * sealed and why it was refused, if it was.
   */
  private class Opened(val content: PushContent?, val sealed: PushSealed? = null, val refusal: String? = null)

  /**
   * Opens [message] with this phone's keys (packages/push `openOnPhone`): v1 with each key, the paired instance's
   * first; v2 with the key its id names only, then refused when expired, sealed for another origin than its key's, or
   * from an instance this phone is not paired with. No content for anything refused: the caller shows the fallback.
   */
  private fun open(context: Context, message: PushMessage): Opened =
    try {
      val keys = DeviceKey.keys(context)
      val paired = receiptOrigins(context)
      if (message.version == 1) {
        if (keys.isEmpty()) throw IllegalStateException("no device key")
        val ordered = keys.sortedBy { key -> if (paired.any { key.originFor(it) == it }) 0 else 1 }
        var last: Exception = IllegalStateException("no device key")
        var opened: PushContent? = null
        for (key in ordered) {
          try {
            opened = PushContent.parse(openWith(context, key, message, PUSH_HPKE_INFO))
            break
          } catch (error: Exception) {
            last = error
          }
        }
        Opened(opened ?: throw last)
      } else {
        val key = keys.firstOrNull { PushKeyId.of(it.publicKey) == message.keyId }
          ?: throw IllegalStateException("unknown key id")
        val content = PushContent.parse(openWith(context, key, message, PUSH_HPKE_INFO_V2), v2 = true)
        val sealed = content.sealed!!
        val refusal = PushChecks.refusal(
          sealed,
          key.originFor(sealed.origin),
          paired,
          System.currentTimeMillis() / 1000,
        )
        if (refusal != null) {
          Log.w(TAG, "push refused: $refusal")
          Opened(null, sealed, refusal)
        } else {
          Opened(content, sealed)
        }
      }
    } catch (error: Exception) {
      // Never the content or the key.
      Log.w(TAG, "decryption failed: ${error.javaClass.simpleName}")
      Opened(null)
    }

  private fun openWith(context: Context, key: DeviceKey.Key, message: PushMessage, info: ByteArray): ByteArray =
    Hpke.open(message.enc, message.ct, info, key.publicKey) { ephemeral -> key.agree(context, ephemeral) }

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
        val origin = content.sealed?.origin
        putExtra(EXTRA_INCIDENT, content.incident)
        putExtra(EXTRA_WORKSPACE, content.workspace)
        if (origin != null) putExtra(EXTRA_ORIGIN, origin)
        // The launcher activity is exported: the proof says this notification put them there (PageTap).
        putExtra(EXTRA_ISSUED_AT, issuedAt)
        putExtra(
          EXTRA_PROOF,
          PageTap.sign(tapKey(context), content.incident, content.workspace, issuedAt, origin),
        )
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

  /** Adds the instance at [value] to the paired ones (the app registered the phone there). False for a bad origin. */
  @Synchronized
  fun setReceiptOrigin(context: Context, value: String): Boolean {
    val origin = PushReceipt.originOf(value) ?: return false
    writeReceiptOrigins(context, ReceiptOrigins.with(receiptOrigins(context), origin))
    return true
  }

  /**
   * Forgets the instance at [value] (the member signed out there), or every one without it: its pages show the
   * fallback text and send nothing until it registers again. The others stay paired.
   */
  @Synchronized
  fun clearReceiptOrigin(context: Context, value: String?) {
    val origin = value?.let(PushReceipt::originOf)
    if (value != null && origin == null) return
    writeReceiptOrigins(
      context,
      if (origin == null) emptyList() else ReceiptOrigins.without(receiptOrigins(context), origin),
    )
  }

  /** Written as the list alone: the one from before several instances is in it, first, from the first change. */
  private fun writeReceiptOrigins(context: Context, origins: List<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(RECEIPT_ORIGIN)
      .putString(RECEIPT_ORIGINS, ReceiptOrigins.encode(origins))
      .commit()
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

  /** The instances this phone is paired with (registered with), the one from before several instances first. */
  internal fun receiptOrigins(context: Context): List<String> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return ReceiptOrigins.decode(prefs.getString(RECEIPT_ORIGINS, null), prefs.getString(RECEIPT_ORIGIN, null))
  }

  /**
   * The first paired instance: the one that may claim the key from before keys per instance ([DeviceKey],
   * [KeyChecks.mayTakeLegacy]), and the key JavaScript that names no origin gets.
   */
  internal fun receiptOrigin(context: Context): String? = receiptOrigins(context).firstOrNull()

  /**
   * `POST { token }` to the page's receipt URL, which [PushChecks.receiptToSend] already checked is on a paired
   * instance: anyone holding the device public key could seal a page naming another (RFC 0006 "Delivery receipts").
   * Best effort: 5 s, no retry, no cookies, the token never logged.
   */
  private fun sendReceipt(receipt: PushReceipt) {
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

/** A string from the app's resources, which plugins/incoming-call.ts generates from packages/i18n. */
internal fun Context.brigadeString(name: String): String {
  val id = resources.getIdentifier(name, "string", packageName)
  return if (id != 0) getString(id) else name
}

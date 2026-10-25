package app.freecorps.brigade.call

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.os.HandlerCompat
import java.lang.ref.WeakReference
import java.util.UUID

/** An incoming page, decrypted. `incident` is the id the ack names; null if the push carried none. */
data class IncomingCall(val id: String, val title: String, val body: String, val incident: String?) {
  fun toMap(): Map<String, Any?> = mapOf("id" to id, "title" to title, "body" to body, "incident" to incident)
}

/**
 * The calls this process knows about, and the paths that ring, answer and end them. Everything runs on the main
 * thread (the Expo module posts there; only [answered] may be read from another thread). FCM (a high-priority data
 * message, decrypted with the device key) and the debug receiver both call [ring]; nothing else starts a call.
 */
object Calls {
  private const val TAG = "BrigadeCall"
  private const val ACCOUNT_ID = "brigade"
  /** An unanswered call stops ringing after this; the instance escalates on its own timeout. */
  private const val RING_TIMEOUT_MS = 60_000L
  /**
   * An answered call hangs up this long after answering, ack or not, which also bounds how long the app is shown
   * over the lock screen. Mirrors `ANSWERED_CALL_MAX_MS` in apps/mobile/src/lib/call-route.ts.
   */
  const val ANSWERED_MAX_MS = 180_000L
  const val EXTRA_CALL_ID = "app.freecorps.brigade.call.ID"

  interface Listener {
    fun onAnswer(call: IncomingCall)
    fun onEnd(call: IncomingCall, reason: String)
  }

  private class State(val call: IncomingCall) {
    var connection: BrigadeConnection? = null
    var answered = false
  }

  private val main = Handler(Looper.getMainLooper())
  private val calls = LinkedHashMap<String, State>()
  /** Ended calls by id, so a late repeat of a page the responder handled does not ring again (`knownCall`). */
  private val ended = HashMap<String, EndedCall>()
  var listener: Listener? = null
  /** The React activity, so an answered call can show it over the lock screen (see [CallActivityListener]). */
  internal var mainActivity: WeakReference<Activity>? = null

  /**
   * The call the user answered and has not ended, for the JS call screen after a cold start. An immutable value
   * replaced on the main thread whenever a call is answered or ends, so the JS thread can read it without a lock.
   */
  @Volatile
  var answered: IncomingCall? = null
    private set

  private fun refreshAnswered() {
    answered = calls.values.firstOrNull { it.answered }?.call
  }

  fun get(id: String): IncomingCall? = calls[id]?.call

  fun conditions(context: Context): RingConditions {
    val notifications = NotificationManagerCompat.from(context)
    ensureChannels(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    fun enabled(id: String) =
      Build.VERSION.SDK_INT < 26 ||
        (manager.getNotificationChannel(id)?.importance ?: NotificationManager.IMPORTANCE_NONE) !=
        NotificationManager.IMPORTANCE_NONE
    val fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()
    val telecom = Build.VERSION.SDK_INT >= 26 && try {
      val handle = registerAccount(context)
      context.getSystemService(TelecomManager::class.java).isIncomingCallPermitted(handle)
    } catch (error: Exception) {
      Log.w(TAG, "telecom unavailable: $error")
      false
    }
    return RingConditions(
      notificationsEnabled = notifications.areNotificationsEnabled(),
      callChannelEnabled = enabled(CALL_CHANNEL),
      pageChannelEnabled = enabled(PAGE_CHANNEL),
      fullScreenAllowed = fullScreen,
      telecomPermitted = telecom,
    )
  }

  /**
   * Rings, or falls back to a page notification. Returns the route taken, or null for a repeat of a page that is
   * still ringing or answered, or that ended in a way that keeps it from ringing again (`knownCall`).
   */
  fun ring(context: Context, call: IncomingCall): CallRoute? {
    val app = context.applicationContext
    val now = SystemClock.elapsedRealtime()
    ended.entries.removeAll { now - it.value.atMs >= ENDED_MEMORY_MS }
    when (knownCall(calls.containsKey(call.id), ended[call.id], now)) {
      KnownCall.Active -> {
        Log.i(TAG, "repeat of a ringing or answered call: ignored")
        return null
      }
      KnownCall.Ended -> {
        Log.i(TAG, "repeat of an ended call: not ringing again")
        return null
      }
      KnownCall.New -> ended.remove(call.id)
    }
    val route = decideRoute(conditions(app))
    Log.i(TAG, "incoming page: route ${route.name}")
    when (route) {
      CallRoute.Ring -> {
        val state = State(call)
        calls[call.id] = state
        try {
          val extras = Bundle().apply { putString(EXTRA_CALL_ID, call.id) }
          app.getSystemService(TelecomManager::class.java).addNewIncomingCall(
            registerAccount(app),
            Bundle().apply { putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, extras) },
          )
          // The state is the token: `end` removes the timer, and it only acts on this call, not a later one
          // with the same id.
          HandlerCompat.postDelayed(main, { timeOut(app, state) }, state, RING_TIMEOUT_MS)
        } catch (error: Exception) {
          Log.w(TAG, "addNewIncomingCall failed: $error")
          calls.remove(call.id)
          return notifyFallback(app, call)
        }
      }
      is CallRoute.Notify -> notifyPage(app, call, route.channel)
      CallRoute.Blocked -> Unit
    }
    return route
  }

  // Telecom's callbacks (BrigadeConnectionService).

  internal fun connectionCreated(id: String, connection: BrigadeConnection) {
    calls[id]?.connection = connection
  }

  /** Telecom could not create the connection (another call in progress, a policy): notify instead. */
  internal fun connectionFailed(context: Context, id: String) {
    val state = calls.remove(id) ?: return
    main.removeCallbacksAndMessages(state)
    Log.w(TAG, "incoming connection failed: page notification instead")
    notifyFallback(context, state.call)
  }

  internal fun showRinging(context: Context, id: String) {
    val call = calls[id]?.call ?: return
    val caller = Person.Builder().setName(call.title).setImportant(true).build()
    val notification = NotificationCompat.Builder(context, CALL_CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle(call.title)
      .setContentText(context.brigadeString("call_ringing"))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setFullScreenIntent(activityIntent(context, call.id, IncomingCallActivity.ACTION_RING), true)
      .setStyle(
        NotificationCompat.CallStyle.forIncomingCall(
          caller,
          broadcastIntent(context, call.id, CallActionReceiver.ACTION_DECLINE),
          activityIntent(context, call.id, IncomingCallActivity.ACTION_ANSWER),
        ),
      )
      .build()
    // Rings until answered, declined or timed out, like a phone call.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(id.hashCode(), notification)
    } catch (error: Exception) {
      // Without the notification nothing rings or shows the ringing screen: end the call, post the page instead.
      Log.w(TAG, "ringing notification refused: $error")
      end(context, id, "failed")
      notifyFallback(context, call)
    }
  }

  /** From the ringing screen, the notification's Answer button, or Telecom (a headset, a watch). */
  fun answer(context: Context, id: String) {
    val state = calls[id] ?: return
    if (!state.answered) {
      state.answered = true
      state.connection?.setActive()
      cancelNotification(context, id)
      Log.i(TAG, "call answered")
      refreshAnswered()
      HandlerCompat.postDelayed(
        main,
        { if (timerApplies(state, calls[id])) end(context, id, "timed_out") },
        state,
        ANSWERED_MAX_MS,
      )
      listener?.onAnswer(state.call)
    }
    // The call screen is the React app, over the lock screen while the call lasts.
    mainActivity?.get()?.let(::showOverLockScreen)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    launch.putExtra(EXTRA_CALL_ID, id)
    context.startActivity(launch)
  }

  fun decline(context: Context, id: String) = end(context, id, "declined")

  /** Ends a call: declined, hung up from the call screen, ended by Telecom, missed, timed out or failed. */
  fun end(context: Context, id: String, reason: String) {
    val state = calls.remove(id) ?: return
    main.removeCallbacksAndMessages(state)
    ended[id] = EndedCall(reason, SystemClock.elapsedRealtime())
    refreshAnswered()
    state.connection?.let {
      val cause = when (reason) {
        "declined" -> DisconnectCause.REJECTED
        "missed" -> DisconnectCause.MISSED
        "failed" -> DisconnectCause.ERROR
        else -> DisconnectCause.LOCAL
      }
      it.setDisconnected(DisconnectCause(cause))
      it.destroy()
    }
    cancelNotification(context, id)
    CallSpeech.stop()
    if (answered == null) mainActivity?.get()?.let(::hideOverLockScreen)
    Log.i(TAG, "call ended: $reason")
    listener?.onEnd(state.call, reason)
    IncomingCallActivity.finishFor(id)
  }

  private fun timeOut(context: Context, state: State) {
    if (timerApplies(state, calls[state.call.id]) && !state.answered) end(context, state.call.id, "missed")
  }

  internal fun showOverLockScreen(activity: Activity) {
    if (Build.VERSION.SDK_INT >= 27) {
      activity.setShowWhenLocked(true)
      activity.setTurnScreenOn(true)
    }
  }

  private fun hideOverLockScreen(activity: Activity) {
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      }
    }
  }

  // Fallback: a page notification on a high-importance channel (RFC 0006 "Paging semantics").

  /** A call that was going to ring could not: the page notification, on `fallbackChannel` (CallRoute.kt). */
  private fun notifyFallback(context: Context, call: IncomingCall): CallRoute {
    val channel = fallbackChannel(conditions(context))
    notifyPage(context, call, channel)
    return CallRoute.Notify(channel)
  }

  internal fun notifyPage(context: Context, call: IncomingCall, channel: String) {
    ensureChannels(context)
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val notification = NotificationCompat.Builder(context, channel)
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setContentTitle(call.title)
      .setContentText(call.body)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setAutoCancel(true)
      .apply {
        if (open != null) {
          setContentIntent(
            PendingIntent.getActivity(context, call.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE),
          )
        }
      }
      .build()
    try {
      NotificationManagerCompat.from(context).notify(call.id.hashCode(), notification)
    } catch (error: SecurityException) {
      Log.w(TAG, "page notification refused: $error")
    }
  }

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CALL_CHANNEL) == null) {
      val ringtone: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      manager.createNotificationChannel(
        NotificationChannel(
          CALL_CHANNEL,
          context.brigadeString("call_channel_calls"),
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          setSound(
            ringtone,
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 1000, 1000)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }
    if (manager.getNotificationChannel(PAGE_CHANNEL) == null) {
      val alarm: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      manager.createNotificationChannel(
        NotificationChannel(
          PAGE_CHANNEL,
          context.brigadeString("call_channel_pages"),
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          setSound(
            alarm,
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
          )
          enableVibration(true)
          // Asks Do Not Disturb to let pages through; the user grants it in the channel's settings.
          setBypassDnd(true)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }
  }

  private fun registerAccount(context: Context): PhoneAccountHandle {
    val handle = PhoneAccountHandle(ComponentName(context, BrigadeConnectionService::class.java), ACCOUNT_ID)
    val account = PhoneAccount.builder(handle, context.brigadeString("app_name"))
      .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
      .build()
    context.getSystemService(TelecomManager::class.java).registerPhoneAccount(account)
    return handle
  }

  private fun cancelNotification(context: Context, id: String) {
    NotificationManagerCompat.from(context).cancel(id.hashCode())
  }

  private fun activityIntent(context: Context, id: String, action: String): PendingIntent {
    val intent = Intent(context, IncomingCallActivity::class.java)
      .setAction(action)
      .putExtra(EXTRA_CALL_ID, id)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      (action + id).hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun broadcastIntent(context: Context, id: String, action: String): PendingIntent {
    val intent = Intent(context, CallActionReceiver::class.java)
      .setAction(action)
      .putExtra(EXTRA_CALL_ID, id)
    return PendingIntent.getBroadcast(
      context,
      (action + id).hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  fun newCallId(): String = UUID.randomUUID().toString()
}

/** A string from the app's resources, which the config plugin generates from packages/i18n. */
internal fun Context.brigadeString(name: String): String {
  val id = resources.getIdentifier(name, "string", packageName)
  return if (id != 0) getString(id) else name
}

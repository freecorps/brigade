package app.freecorps.brigade.call

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS side of the call screen (modules/brigade-call/index.ts). */
class BrigadeCallModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("BrigadeCall")

    Events("onAnswer", "onEnd", "onAcknowledgeKey", "onSpoken")

    OnCreate {
      Calls.listener = object : Calls.Listener {
        override fun onAnswer(call: IncomingCall) = sendEvent("onAnswer", call.toMap())
        override fun onEnd(call: IncomingCall, reason: String) =
          sendEvent("onEnd", mapOf("id" to call.id, "reason" to reason))
      }
      CallSpeech.onDone = { sendEvent("onSpoken", emptyMap<String, Any>()) }
    }

    OnDestroy {
      Calls.listener = null
      CallSpeech.onDone = null
    }

    /** Which way a page would reach this phone now, and why: for the dev screen and, later, device registration. */
    Function("getRingStatus") {
      // System services only (no call state): safe on the JS thread.
      val conditions = Calls.conditions(context)
      mapOf(
        "route" to decideRoute(conditions).name,
        "notificationsEnabled" to conditions.notificationsEnabled,
        "fullScreenAllowed" to conditions.fullScreenAllowed,
        "telecomPermitted" to conditions.telecomPermitted,
        "callChannelEnabled" to conditions.callChannelEnabled,
        "pageChannelEnabled" to conditions.pageChannelEnabled,
      )
    }

    // Sync functions run on the JS thread; `Calls` lives on the main thread. Reads take its immutable, volatile
    // snapshot; everything else is posted to the main thread (never waited on, so it cannot deadlock).

    /** The answered call, if any: the call screen reads it after a cold start. */
    Function("getAnsweredCall") { Calls.answered?.toMap() }

    /** Development only: rings a test call after `delayMs`, through the path a push uses. */
    Function("simulateIncomingCall") { title: String, body: String, incident: String?, delayMs: Int ->
      val id = Calls.newCallId()
      val app = context.applicationContext
      main.postDelayed({ Calls.ring(app, IncomingCall(id, title, body, incident)) }, delayMs.toLong())
      id
    }

    Function("endCall") { id: String -> main.post { Calls.end(context.applicationContext, id, "hung_up") } }

    Function("speak") { text: String, language: String ->
      val app = context.applicationContext
      main.post { CallSpeech.speak(app, text, language) }
    }

    Function("stopSpeaking") { main.post { CallSpeech.stop() } }

    /** Android 14+: where the user allows full-screen intents, which a page needs to ring over the lock screen. */
    Function("openFullScreenIntentSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** iOS only: the PushKit token. */
    AsyncFunction("getVoipToken") { null as String? }
  }
}

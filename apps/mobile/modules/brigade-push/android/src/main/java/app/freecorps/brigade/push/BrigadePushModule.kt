package app.freecorps.brigade.push

import android.content.Intent
import com.google.firebase.FirebaseApp
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS side of pages on Android (modules/brigade-push/index.ts); the same names as the iOS module. */
class BrigadePushModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("BrigadePush")

    Events("onOpenPage")

    /** HPKE opens with the Keystore (Android 12+) or the wrapped key (DeviceKey.kt) on every supported version. */
    Constant("canDecrypt") { true }

    /**
     * Whether this build has a Firebase project (`google-services.json` at build time, app.config.ts). Without one
     * there is no FCM token, so the phone says pages are not set up here instead of failing to register.
     */
    Constant("fcmAvailable") {
      try {
        FirebaseApp.getApps(context).isNotEmpty()
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("getPublicKey") { Base64url.encode(DeviceKey.publicKey(context)) }

    Function("setReceiptOrigin") { origin: String -> Pages.setReceiptOrigin(context, origin) }

    /** iOS holds background time for the Acknowledge action; Android has no action yet, so nothing to finish. */
    Function("finishPageAction") { _: String -> }

    /** The page whose notification launched the app, once (a cold start from a tap). */
    Function("takeOpenedPage") { appContext.currentActivity?.intent?.let(::takePage) }

    // A tap while the app is running delivers a new intent to the activity.
    OnNewIntent { intent -> takePage(intent)?.let { sendEvent("onOpenPage", it) } }
  }

  private fun takePage(intent: Intent): Map<String, String>? {
    val incident = intent.getStringExtra(Pages.EXTRA_INCIDENT) ?: return null
    val workspace = intent.getStringExtra(Pages.EXTRA_WORKSPACE) ?: return null
    intent.removeExtra(Pages.EXTRA_INCIDENT)
    intent.removeExtra(Pages.EXTRA_WORKSPACE)
    return mapOf("incident" to incident, "workspace" to workspace)
  }
}

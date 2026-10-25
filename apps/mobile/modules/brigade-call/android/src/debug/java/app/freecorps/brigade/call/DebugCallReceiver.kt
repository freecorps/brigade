package app.freecorps.brigade.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log

/**
 * Development only: rings a test call without FCM, through the same [Calls.ring] a push will use.
 *
 *   adb shell am broadcast -a app.freecorps.brigade.call.DEBUG_RING -n app.freecorps.brigade/app.freecorps.brigade.call.DebugCallReceiver \
 *     --es title "SEV1 · Checkout down" --es body "502s from payments" --es incident inc_…
 *
 * The manifest only lets holders of DUMP (adb's shell) send it. It lives in the debug source set (src/debug), so a
 * release build does not contain it; the debuggable check stays as a second guard.
 */
class DebugCallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
    val call = IncomingCall(
      id = intent.getStringExtra("callId") ?: Calls.newCallId(),
      title = intent.getStringExtra("title") ?: context.brigadeString("push_fallback_title"),
      body = intent.getStringExtra("body") ?: context.brigadeString("push_fallback_body"),
      incident = intent.getStringExtra("incident"),
    )
    val route = Calls.ring(context, call)
    Log.i("BrigadeCall", "debug ring: ${route.name}")
    resultData = route.name
  }
}

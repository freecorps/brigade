package app.freecorps.brigade.call

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class BrigadeCallPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(CallActivityListener())

  override fun createReactActivityHandlers(
    activityContext: Context,
  ): List<ReactActivityHandler> = listOf(CallKeyHandler())
}

/**
 * Hands a hardware keyboard's keys to the call screen while a call is answered: 1 acknowledges there, as on CallKit's
 * keypad (src/lib/call-session.ts decides which keys count). Only keys the app gets, so only while it is in front,
 * and none is taken from React Native: the call screen has no text field.
 */
class CallKeyHandler : ReactActivityHandler {
  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    val call = Calls.answered ?: return false
    if (event.isCanceled) return false
    Calls.listener?.onKey(call, keyCode)
    return false
  }
}

/**
 * Keeps a reference to the React activity, and shows it over the lock screen while a call is answered: answering
 * on a locked phone must open the call screen, not the keyguard. The flag is cleared when the call ends.
 */
class CallActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    Calls.mainActivity = WeakReference(activity)
    if (Calls.answered != null) Calls.showOverLockScreen(activity)
  }

  override fun onResume(activity: Activity) {
    Calls.mainActivity = WeakReference(activity)
  }
}

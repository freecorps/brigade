package app.freecorps.brigade.call

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class BrigadeCallPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(CallActivityListener())
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

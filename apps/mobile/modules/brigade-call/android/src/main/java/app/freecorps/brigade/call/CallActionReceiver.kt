package app.freecorps.brigade.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The notification's Decline button. (Answer opens an activity: Android 12+ forbids starting one from here.) */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(Calls.EXTRA_CALL_ID) ?: return
    if (intent.action == ACTION_DECLINE) Calls.decline(context, id)
  }

  companion object {
    const val ACTION_DECLINE = "app.freecorps.brigade.call.DECLINE"
  }
}

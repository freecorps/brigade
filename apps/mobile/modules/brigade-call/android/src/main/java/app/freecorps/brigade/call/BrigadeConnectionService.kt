package app.freecorps.brigade.call

import android.net.Uri
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log

/** Telecom's side of a self-managed call: the system knows Brigade is ringing or in a call. */
class BrigadeConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(
    account: PhoneAccountHandle?,
    request: ConnectionRequest,
  ): Connection {
    val id = callId(request)
    val call = id?.let(Calls::get)
    if (id == null || call == null) {
      // Never null: Telecom would show nothing. A failed connection only: this process does not know the call (it
      // ended, or the process restarted), so it has no page to post. The step-1 alert push has notified already.
      Log.w("BrigadeCall", "no call for the incoming connection")
      return Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
    }
    return BrigadeConnection(applicationContext, id).apply {
      connectionProperties = Connection.PROPERTY_SELF_MANAGED
      audioModeIsVoip = true
      setAddress(Uri.fromParts("brigade", id, null), TelecomManager.PRESENTATION_ALLOWED)
      setCallerDisplayName(call.title, TelecomManager.PRESENTATION_ALLOWED)
      setRinging()
      Calls.connectionCreated(id, this)
    }
  }

  override fun onCreateIncomingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest) {
    callId(request)?.let { Calls.connectionFailed(applicationContext, it) }
  }

  private fun callId(request: ConnectionRequest): String? =
    request.extras?.getString(Calls.EXTRA_CALL_ID)
      ?: request.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)?.getString(Calls.EXTRA_CALL_ID)
}

class BrigadeConnection(private val context: android.content.Context, private val id: String) : Connection() {
  /** Telecom asks a self-managed app to show its own incoming-call UI. */
  override fun onShowIncomingCallUi() = Calls.showRinging(context, id)

  override fun onAnswer() = Calls.answer(context, id)

  override fun onAnswer(videoState: Int) = Calls.answer(context, id)

  override fun onReject() = Calls.end(context, id, "declined")

  override fun onDisconnect() = Calls.end(context, id, "hung_up")

  override fun onAbort() = Calls.end(context, id, "hung_up")
}

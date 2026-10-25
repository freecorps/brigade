package app.freecorps.brigade.call

import android.net.Uri
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

/** Telecom's side of a self-managed call: the system knows Brigade is ringing or in a call. */
class BrigadeConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(
    account: PhoneAccountHandle?,
    request: ConnectionRequest,
  ): Connection? {
    val id = callId(request) ?: return null
    val call = Calls.get(id) ?: return null
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

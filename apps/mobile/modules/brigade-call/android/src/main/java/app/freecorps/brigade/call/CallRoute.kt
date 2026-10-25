package app.freecorps.brigade.call

/**
 * How an incoming page reaches the responder (RFC 0010; paging paths need a fallback, AGENTS.md). Pure, so the
 * JVM unit tests cover every combination.
 */
sealed class CallRoute {
  /** Telecom call, CallStyle notification and full-screen ringing screen. */
  object Ring : CallRoute()

  /** A page notification on [channel] instead: the call cannot ring here. */
  data class Notify(val channel: String) : CallRoute()

  /** Nothing can be shown (notifications are off): the instance must escalate without waiting for this phone. */
  object Blocked : CallRoute()

  val name: String
    get() = when (this) {
      Ring -> "ring"
      is Notify -> "notify"
      Blocked -> "blocked"
    }
}

data class RingConditions(
  val notificationsEnabled: Boolean,
  val callChannelEnabled: Boolean,
  val pageChannelEnabled: Boolean,
  /** `NotificationManager.canUseFullScreenIntent()` on Android 14+; always true before. */
  val fullScreenAllowed: Boolean,
  /** Android 8+ (self-managed calls) and `TelecomManager.isIncomingCallPermitted`. */
  val telecomPermitted: Boolean,
)

const val CALL_CHANNEL = "brigade_calls"
const val PAGE_CHANNEL = "brigade_pages"

fun decideRoute(c: RingConditions): CallRoute = when {
  !c.notificationsEnabled -> CallRoute.Blocked
  // A CallStyle notification needs a full-screen intent (or a foreground service) to be posted at all, and
  // without one a locked phone would only show a heads-up: ring only when all of it works.
  c.callChannelEnabled && c.fullScreenAllowed && c.telecomPermitted -> CallRoute.Ring
  c.pageChannelEnabled -> CallRoute.Notify(PAGE_CHANNEL)
  c.callChannelEnabled -> CallRoute.Notify(CALL_CHANNEL)
  else -> CallRoute.Blocked
}

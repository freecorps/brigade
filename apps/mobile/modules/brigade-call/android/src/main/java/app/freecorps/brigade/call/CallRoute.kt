package app.freecorps.brigade.call

/**
 * How an incoming page reaches the responder (RFC 0010; paging paths need a fallback, AGENTS.md). Mirrors
 * `decideRoute`, `fallbackChannel` and `knownCall` in apps/mobile/src/lib/call-route.ts, the source of truth that CI
 * tests (its test also checks the code below); change both together. The JVM tests (CallRouteTest.kt) run only by
 * hand.
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

/** A page notification after a call that was going to ring could not: the page channel unless it is muted. */
fun fallbackChannel(c: RingConditions): String = if (c.pageChannelEnabled) PAGE_CHANNEL else CALL_CHANNEL

/** What the phone knows about an incoming page's call id. Repeats of one page share it. */
enum class KnownCall { New, Active, Ended }

/** How and when a call ended (`SystemClock.elapsedRealtime()`), kept for [ENDED_MEMORY_MS] in RAM only. */
data class EndedCall(val reason: String, val atMs: Long)

/** The longest a call push lives after it was sent (the relay's 5-minute cap): see `ENDED_CALL_MEMORY_MS`. */
const val ENDED_MEMORY_MS = 300_000L

/** Declined or answered: a repeat does not ring again. Missed and failed (and anything else) ring again. */
val REPEAT_SUPPRESSING_END_REASONS = setOf("declined", "hung_up", "timed_out")

fun knownCall(active: Boolean, ended: EndedCall?, nowMs: Long): KnownCall = when {
  active -> KnownCall.Active
  ended != null && nowMs - ended.atMs < ENDED_MEMORY_MS && ended.reason in REPEAT_SUPPRESSING_END_REASONS ->
    KnownCall.Ended
  else -> KnownCall.New
}

/** A timer acts only on the call instance that scheduled it, not on a later call that reuses its id. */
fun <T : Any> timerApplies(scheduledFor: T, current: T?): Boolean = current === scheduledFor

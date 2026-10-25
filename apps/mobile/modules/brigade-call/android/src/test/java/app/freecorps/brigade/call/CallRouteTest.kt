package app.freecorps.brigade.call

import org.junit.Assert.assertEquals
import org.junit.Test

class CallRouteTest {
  private val all = RingConditions(
    notificationsEnabled = true,
    callChannelEnabled = true,
    pageChannelEnabled = true,
    fullScreenAllowed = true,
    telecomPermitted = true,
  )

  @Test
  fun ringsWhenEverythingIsAllowed() {
    assertEquals(CallRoute.Ring, decideRoute(all))
  }

  @Test
  fun withoutFullScreenIntentFallsBackToAPageNotification() {
    assertEquals(CallRoute.Notify(PAGE_CHANNEL), decideRoute(all.copy(fullScreenAllowed = false)))
  }

  @Test
  fun whenTelecomRefusesFallsBackToAPageNotification() {
    assertEquals(CallRoute.Notify(PAGE_CHANNEL), decideRoute(all.copy(telecomPermitted = false)))
  }

  @Test
  fun aMutedCallChannelFallsBackToThePageChannel() {
    assertEquals(CallRoute.Notify(PAGE_CHANNEL), decideRoute(all.copy(callChannelEnabled = false)))
  }

  @Test
  fun aMutedPageChannelUsesTheCallChannelForTheNotification() {
    val conditions = all.copy(pageChannelEnabled = false, fullScreenAllowed = false)
    assertEquals(CallRoute.Notify(CALL_CHANNEL), decideRoute(conditions))
  }

  @Test
  fun blockedOnlyWhenNothingCanBeShown() {
    assertEquals(CallRoute.Blocked, decideRoute(all.copy(notificationsEnabled = false)))
    assertEquals(
      CallRoute.Blocked,
      decideRoute(all.copy(callChannelEnabled = false, pageChannelEnabled = false)),
    )
  }

  @Test
  fun everyCombinationThatCanShowSomethingDoes() {
    for (bits in 0 until 32) {
      val c = RingConditions(
        notificationsEnabled = bits and 1 != 0,
        callChannelEnabled = bits and 2 != 0,
        pageChannelEnabled = bits and 4 != 0,
        fullScreenAllowed = bits and 8 != 0,
        telecomPermitted = bits and 16 != 0,
      )
      val canShow = c.notificationsEnabled && (c.callChannelEnabled || c.pageChannelEnabled)
      assertEquals(c.toString(), canShow, decideRoute(c) != CallRoute.Blocked)
    }
  }
}

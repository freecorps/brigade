package app.freecorps.brigade.push

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageTapTest {
  private val key = PageTap.newKey()
  private val now = 1_760_000_000_000L
  private val incident = "inc_01JABCDEFGHJKMNPQRSTVWXYZ0"
  private val workspace = "org_1"

  @Test
  fun honoursItsOwnNotification() {
    val proof = PageTap.sign(key, incident, workspace, now)
    assertTrue(PageTap.verify(key, incident, workspace, now, proof, now))
    assertTrue(PageTap.verify(key, incident, workspace, now, proof, now + PageTap.MAX_AGE_MS))
  }

  @Test
  fun refusesExtrasAnotherAppMade() {
    // No proof, a made-up one, or one under another key.
    assertFalse(PageTap.verify(key, incident, workspace, now, null, now))
    assertFalse(PageTap.verify(key, incident, workspace, now, "AAAA", now))
    assertFalse(PageTap.verify(key, incident, workspace, now, "not base64url!", now))
    val other = PageTap.sign(PageTap.newKey(), incident, workspace, now)
    assertFalse(PageTap.verify(key, incident, workspace, now, other, now))
  }

  @Test
  fun refusesAProofMovedToOtherExtras() {
    val proof = PageTap.sign(key, incident, workspace, now)
    assertFalse(PageTap.verify(key, "inc_other", workspace, now, proof, now))
    assertFalse(PageTap.verify(key, incident, "org_2", now, proof, now))
    assertFalse(PageTap.verify(key, incident, workspace, now + 1, proof, now + 1))
    // Moving characters between the ids does not sign the same bytes.
    val split = PageTap.sign(key, "ab", "c", now)
    assertFalse(PageTap.verify(key, "a", "bc", now, split, now))
  }

  @Test
  fun refusesAnOldOrFutureTap() {
    val proof = PageTap.sign(key, incident, workspace, now)
    assertFalse(PageTap.verify(key, incident, workspace, now, proof, now + PageTap.MAX_AGE_MS + 1))
    assertFalse(PageTap.verify(key, incident, workspace, now, proof, now - 1))
  }

  @Test
  fun refusesWithoutAKey() {
    val proof = PageTap.sign(key, incident, workspace, now)
    assertFalse(PageTap.verify(ByteArray(0), incident, workspace, now, proof, now))
  }
}

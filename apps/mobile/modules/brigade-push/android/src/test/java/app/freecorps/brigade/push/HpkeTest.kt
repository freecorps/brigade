package app.freecorps.brigade.push

import java.math.BigInteger
import java.security.KeyFactory
import java.security.spec.ECPrivateKeySpec
import javax.crypto.KeyAgreement
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private fun hex(value: String): ByteArray =
  value.replace(Regex("\\s+"), "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()

/** ECDH in software with a raw private scalar, standing in for the Keystore. */
private fun dhWith(secret: ByteArray): (ByteArray) -> ByteArray = { ephemeral ->
  val key = KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, secret), P256.params))
  KeyAgreement.getInstance("ECDH").run {
    init(key)
    doPhase(P256.publicKey(ephemeral), true)
    generateSecret()
  }
}

class HpkeTest {
  // RFC 9180, appendix A.3.1: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, base mode, sequence 0.
  private val info = hex("4f6465206f6e2061204772656369616e2055726e")
  private val pkEm = hex(
    "04a92719c6195d5085104f469a8b9814d5838ff72b60501e2c4466e5e67b325ac98536d7b61a1af4b78e5b7f951c0900be863c403ce65c9bfcb9382657222d18c4",
  )
  private val pkRm = hex(
    "04fe8c19ce0905191ebc298a9245792531f26f0cece2460639e8bc39cb7f706a826a779b4cf969b8a0e539c7f62fb3d30ad6aa8f80e30f1d128aafd68a2ce72ea0",
  )
  private val skRm = hex("f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2")
  private val pt = hex("4265617574792069732074727574682c20747275746820626561757479")
  private val aad = hex("436f756e742d30")
  private val ct = hex("5ad590bb8baa577f8619db35a36311226a896e7342a6d836d8b7bcd2f20b6c7f9076ac232e3ab2523f39513434")

  @Test
  fun opensTheRfc9180Vector() {
    assertArrayEquals(pt, Hpke.open(pkEm, ct, info, pkRm, aad, dhWith(skRm)))
  }

  @Test
  fun refusesAnotherInfoAadOrAFlippedBit() {
    assertThrows(Exception::class.java) { Hpke.open(pkEm, ct, ByteArray(0), pkRm, aad, dhWith(skRm)) }
    assertThrows(Exception::class.java) { Hpke.open(pkEm, ct, info, pkRm, ByteArray(0), dhWith(skRm)) }
    val flipped = ct.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { Hpke.open(pkEm, flipped, info, pkRm, aad, dhWith(skRm)) }
  }

  @Test
  fun refusesAnEphemeralKeyOffTheCurve() {
    val off = pkEm.copyOf().also { it[64] = (it[64].toInt() xor 1).toByte() }
    assertFalse(P256.isPoint(off))
    assertFalse(P256.isPoint(ByteArray(65)))
    assertTrue(P256.isPoint(pkEm))
    assertThrows(IllegalArgumentException::class.java) { Hpke.open(off, ct, info, pkRm, aad, dhWith(skRm)) }
  }

  @Test
  fun encodesAPublicKeyAsTheUncompressedPoint() {
    val key = P256.publicKey(pkRm) as java.security.interfaces.ECPublicKey
    assertArrayEquals(pkRm, P256.encode(key.w))
  }

  /**
   * A page sealed by packages/push (`seal` with the vector's ephemeral key, to the vector's recipient, with
   * `PUSH_HPKE_INFO`), as the relay's FCM data message carries it: what the phone opens must match what the instance
   * sealed.
   */
  @Test
  fun opensAPageSealedByPackagesPush() {
    val message = PushMessage.parse(
      mapOf(
        "v" to "1",
        "enc" to "BKknGcYZXVCFEE9GmouYFNWDj_crYFAeLERm5eZ7MlrJhTbXthoa9LeOW3-VHAkAvoY8QDzmXJv8uTgmVyItGMQ",
        "ct" to "jXy4w1cPEzDLp9OBiU4-gLGyzooKq-qnSfzaCLtyAhW4PPjyX2DriupjXIMiRsTqTTuEOfw_Q-UQFYMmJ2oxCxhETOBATp54kd1XynpT6UIhNc9c2ZGDYkQ25fOHm_r2cmNL7yT2reVBBUMpPQUrXA0WRxdx6lvWkuINVy_1LJTDEHduHgCx_iW1xikHXYV5R7u9e3y6VZO_tPH95foDCyFhRLeoLkEHXjISeEeknwuhSKDl8vzWahpzKw-RkAnghJPSmSg4ivK5L_UQN2b_AtOGT9TvJcs1",
        "kind" to "alert",
        "urgency" to "page",
        "tag" to "inc_01",
      ),
    )!!
    val content = PushContent.parse(Hpke.open(message.enc, message.ct, PUSH_HPKE_INFO, pkRm, dh = dhWith(skRm)))
    assertEquals("SEV1 · INC-142", content.title)
    assertEquals("Checkout is down — 502s", content.body)
    assertEquals("inc_01", content.incident)
    assertEquals("ws_01", content.workspace)
    assertEquals(PushReceipt("https://brigade.example.com/api/receipts", "v1.k1.ws.inc.evt.dev.1.mac"), content.receipt)
    assertEquals("inc_01", message.tag)
    assertTrue(message.isPage)
    assertFalse(message.isCall)
    // Another key cannot open it.
    val other = hex("4995788ef4b9d6132b249ce59a77281493eb39af373d236a1fe415cb0c2d7beb")
    assertThrows(Exception::class.java) {
      Hpke.open(message.enc, message.ct, PUSH_HPKE_INFO, pkRm, dh = dhWith(other))
    }
  }
}

class PushPayloadTest {
  private val enc = "BKknGcYZXVCFEE9GmouYFNWDj_crYFAeLERm5eZ7MlrJhTbXthoa9LeOW3-VHAkAvoY8QDzmXJv8uTgmVyItGMQ"
  private val ct = "AAAAAAAAAAAAAAAAAAAAAA"
  private val callId = "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f"
  private fun data(vararg extra: Pair<String, String>) =
    mapOf("v" to "1", "enc" to enc, "ct" to ct, "kind" to "alert", "urgency" to "page") + extra

  @Test
  fun aCallCarriesItsId() {
    val call = PushMessage.parse(data("kind" to "call", "callId" to callId))!!
    assertTrue(call.isCall)
    assertEquals(callId, call.callId)
  }

  @Test
  fun refusesWhatItCannotOpenOrRing() {
    for (bad in listOf(
      data("v" to "2"),
      data("enc" to "not base64!"),
      data("enc" to "AAAA"),
      data("ct" to "AAAA"),
      data("kind" to "voip"),
      data("kind" to "call"),
      data("kind" to "call", "callId" to callId.uppercase()),
      data("kind" to "call", "callId" to callId, "urgency" to "high"),
    )) {
      assertNull(bad.toString(), PushMessage.parse(bad))
    }
    assertTrue(PushMessage.isBrigade(data()))
    assertFalse(PushMessage.isBrigade(mapOf("title" to "someone else's")))
  }

  @Test
  fun anUnknownUrgencyIsHighNotAPage() {
    assertEquals("high", PushMessage.parse(data("urgency" to "urgent"))!!.urgency)
  }

  @Test
  fun receiptsAsPackagesPushTakesThem() {
    fun receipt(url: String, token: String = "abc.DEF-1_~") =
      PushReceipt.parse(org.json.JSONObject().put("url", url).put("token", token))
    assertEquals("https://brigade.example.com", receipt("https://brigade.example.com/api/receipts")!!.origin)
    assertEquals("http://localhost:8787", receipt("http://localhost:8787/api/receipts")!!.origin)
    assertNull(receipt("http://brigade.example.com/api/receipts"))
    assertNull(receipt("https://user:pw@brigade.example.com/api/receipts"))
    assertNull(receipt("https://brigade.example.com/api/receipts", "has space"))
    assertNull(receipt("https://brigade.example.com/" + "x".repeat(600)))
    val ok = receipt("https://Brigade.Example.com:443/api/receipts")!!
    assertTrue(ok.isFor("https://brigade.example.com"))
    assertFalse(ok.isFor("https://other.example.com"))
    assertFalse(ok.isFor(null))
    assertEquals("https://brigade.example.com:8443", PushReceipt.originOf("https://brigade.example.com:8443/x"))
    assertNull(PushReceipt.originOf("ftp://brigade.example.com"))
  }

  @Test
  fun base64urlRoundTrips() {
    for (size in 0..70) {
      val bytes = ByteArray(size) { (it * 37 + 11).toByte() }
      assertArrayEquals(bytes, Base64url.decode(Base64url.encode(bytes)))
    }
    assertNull(Base64url.decode("a+b/"))
    assertNull(Base64url.decode("A"))
  }
}

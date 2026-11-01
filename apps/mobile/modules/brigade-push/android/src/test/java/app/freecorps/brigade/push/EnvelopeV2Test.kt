package app.freecorps.brigade.push

import java.math.BigInteger
import java.security.KeyFactory
import java.security.spec.ECPrivateKeySpec
import javax.crypto.KeyAgreement
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** Envelope version 2 (RFC 0015 section 4), as packages/push `sealPushV2` and `openOnPhone` define it. */
class EnvelopeV2Test {
  private fun hex(value: String): ByteArray = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  // RFC 9180 vector A.3.1's recipient, standing in for a device key.
  private val pkRm = hex(
    "04fe8c19ce0905191ebc298a9245792531f26f0cece2460639e8bc39cb7f706a826a779b4cf969b8a0e539c7f62fb3d30ad6aa8f80e30f1d128aafd68a2ce72ea0",
  )
  private val skRm = hex("f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2")
  private val origin = "https://brigade.example.com"
  private val iat = 1_793_534_400L

  /** Sealed by packages/push `sealPushV2` to pkRm: origin above, urgency page, TTL 900 s, iat above. */
  private val page = mapOf(
    "v" to "2",
    "k" to "hxDO5Zz-",
    "enc" to "BPppWodapKGlveMp3Ry5ZM2Lnhy3ftqP5VFxsfQyxPiqO9_LCj1qYwX39toMeiP96tKmmsk8cKWZCEXfd1tvDfY",
    "ct" to "SKjySqT-8uTvRjKGS8_z76JiCpJJDkC_rOluMhoeZXoISmT1HghmerBxBMPw0xLXOFuDy9SOIicLT4lm0DyIW-uQu81ZN1NDpW70PHlQhjicaRdNAUzqVYFHoSdNvSqydF-T4TvVTEsxkr-vSOuvg8vfz1BkQrmBCRMv0i1Eq0vvhBSyl4X8eQiIE4vyEJKGaEhB2mQhsNsxB4SR811laxo0keVyJNthGpDxwdNu8n3LGPrlmVFLOhxFL5KKNEKegdJGBjoMF3WRaOFu2xWRi8PAw0M7r9lrvDae0fA34Yp2JU0IZ5T3EveQatckzjsTFEdgcWhhQb8b5a9v9_xLdXqZhktvTPN8aGhkVakHYbj8uIs",
    "kind" to "alert",
    "urgency" to "low",
  )

  private fun dh(ephemeral: ByteArray): ByteArray {
    val key = KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, skRm), P256.params))
    return KeyAgreement.getInstance("ECDH").run {
      init(key)
      doPhase(P256.publicKey(ephemeral), true)
      generateSecret()
    }
  }

  @Test
  fun keyIdMatchesPackagesPush() {
    assertEquals("hxDO5Zz-", PushKeyId.of(pkRm))
    // packages/push tests/envelope-v2.test.ts and BrigadePushCrypto.swift: 0x04 then 0x01..0x40.
    assertEquals("DtOmq5V_", PushKeyId.of(ByteArray(65) { if (it == 0) 4 else it.toByte() }))
  }

  @Test
  fun opensAV2PageSealedByPackagesPush() {
    val message = PushMessage.parse(page)!!
    assertEquals(2, message.version)
    assertEquals("hxDO5Zz-", message.keyId)
    val plaintext = Hpke.open(message.enc, message.ct, PUSH_HPKE_INFO_V2, pkRm, dh = this::dh)
    val content = PushContent.parse(plaintext, v2 = true)
    assertEquals("SEV1 · INC-142", content.title)
    assertEquals(PushSealed(iat, iat + 900, origin, "page"), content.sealed)
    // The clear urgency says low; the sealed one, page, is what counts.
    assertEquals(false, message.isPage)
    assertEquals(true, content.sealed!!.isPage)
    // Under v1's info it does not open: versions do not cross.
    assertThrows(Exception::class.java) { Hpke.open(message.enc, message.ct, PUSH_HPKE_INFO, pkRm, dh = this::dh) }
  }

  @Test
  fun aV2MessageNeedsItsKeyId() {
    assertNull(PushMessage.parse(page - "k"))
    for (bad in listOf("", "short", "toolong12", "has spa ", "abc+/def")) assertNull(PushMessage.parse(page + ("k" to bad)))
    assertNull(PushMessage.parse(page + ("v" to "3")))
    // A v1 message ignores a k.
    assertNull(PushMessage.parse(page + ("v" to "1"))!!.keyId)
  }

  @Test
  fun sealedFieldsAsPackagesPushTakesThem() {
    val good = JSONObject().put("iat", iat).put("exp", iat + 60).put("origin", origin).put("urgency", "page")
    assertNotNull(PushSealed.parse(good))
    fun with(key: String, value: Any?) = JSONObject(good.toString()).apply { if (value == null) remove(key) else put(key, value) }
    for (bad in listOf(
      with("iat", null), with("iat", "1"), with("iat", 1.5), with("exp", iat - 1),
      with("exp", iat + 31L * 24 * 60 * 60), with("origin", "$origin/"), with("origin", "https://Brigade.example.com"),
      with("origin", null), with("urgency", "urgent"),
    )) {
      assertNull(bad.toString(), PushSealed.parse(bad))
    }
    // Past JavaScript's safe integers (an `exp` that never comes): refused, as packages/push and iOS refuse it.
    val unsafe = 9_007_199_254_740_992L
    assertNull(PushSealed.parse(JSONObject(good.toString()).put("iat", unsafe).put("exp", unsafe + 60)))
    assertNull(PushSealed.parse(JSONObject("""{"iat":$iat,"exp":99999999999999999999,"origin":"$origin","urgency":"page"}""")))
    val edge = 9_007_199_254_740_991L
    assertNotNull(PushSealed.parse(JSONObject(good.toString()).put("iat", edge - 60).put("exp", edge)))
    // A v2 plaintext without them does not parse.
    assertThrows(IllegalArgumentException::class.java) {
      PushContent.parse("""{"title":"t","body":"b"}""".toByteArray(), v2 = true)
    }
  }

  @Test
  fun refusalsAreTheFallbackText() {
    val sealed = PushSealed(iat, iat + 900, origin, "page")
    val other = "https://other.example.org"
    assertNull(PushChecks.refusal(sealed, origin, origin, iat + 60))
    // Within the 5 minutes of clock skew, then expired.
    assertNull(PushChecks.refusal(sealed, origin, origin, iat + 900 + 300))
    assertEquals("expired", PushChecks.refusal(sealed, origin, origin, iat + 900 + 301))
    assertEquals("wrong_origin", PushChecks.refusal(sealed, other, origin, iat))
    assertEquals("not_paired", PushChecks.refusal(sealed, origin, other, iat))
    assertEquals("not_paired", PushChecks.refusal(sealed, origin, null, iat))
    // The unclaimed key from before keys per instance counts as the paired instance's.
    assertNull(PushChecks.refusal(sealed, null, origin, iat))
  }

  @Test
  fun receiptsGoOnlyToTheSealedPairedOrigin() {
    val receipt = PushReceipt("$origin/api/receipts", "tok")
    val sealed = PushSealed(iat, iat + 900, origin, "page")
    val v2 = PushContent("t", "b", null, null, receipt, sealed)
    assertEquals(receipt, PushChecks.receiptToSend(v2, origin))
    assertNull(PushChecks.receiptToSend(v2, "https://other.example.org"))
    val elsewhere = v2.copy(receipt = PushReceipt("https://other.example.org/api/receipts", "tok"))
    assertNull(PushChecks.receiptToSend(elsewhere, origin))
    // Version 1, as before: the registered instance only.
    val v1 = v2.copy(sealed = null)
    assertEquals(receipt, PushChecks.receiptToSend(v1, origin))
    assertNull(PushChecks.receiptToSend(v1, null))
  }

  @Test
  fun severalInstancesArePairedAtOnce() {
    val other = "https://other.example.org"
    val third = "https://third.example.net"
    val sealed = PushSealed(iat, iat + 900, origin, "page")
    // Paired with this instance among others: it opens; with only others, it is the fallback.
    assertNull(PushChecks.refusal(sealed, origin, listOf(other, origin), iat))
    assertEquals("not_paired", PushChecks.refusal(sealed, origin, listOf(other, third), iat))
    assertEquals("not_paired", PushChecks.refusal(sealed, origin, emptyList<String>(), iat))
    val receipt = PushReceipt("$origin/api/receipts", "tok")
    val v2 = PushContent("t", "b", null, null, receipt, sealed)
    assertEquals(receipt, PushChecks.receiptToSend(v2, listOf(other, origin)))
    assertNull(PushChecks.receiptToSend(v2, listOf(other)))
    // A v2 page sealed by one paired instance naming another paired instance's receipt URL sends nothing.
    val crossed = v2.copy(receipt = PushReceipt("$other/api/receipts", "tok"))
    assertNull(PushChecks.receiptToSend(crossed, listOf(other, origin)))
    // Version 1 goes to any paired instance its URL is on.
    assertEquals(receipt, PushChecks.receiptToSend(v2.copy(sealed = null), listOf(other, origin)))
  }

  @Test
  fun receiptOriginsKeepTheOldOneFirst() {
    val other = "https://other.example.org"
    // Before several instances: only the one origin, which stays first once more are added.
    assertEquals(listOf(origin), ReceiptOrigins.decode(null, origin))
    val added = ReceiptOrigins.with(ReceiptOrigins.decode(null, origin), other)
    assertEquals(listOf(origin, other), added)
    assertEquals(added, ReceiptOrigins.with(added, other))
    assertEquals(added, ReceiptOrigins.decode(ReceiptOrigins.encode(added), origin))
    assertEquals(listOf(other), ReceiptOrigins.without(added, origin))
    assertEquals(emptyList<String>(), ReceiptOrigins.decode("", null))
    assertEquals(emptyList<String>(), ReceiptOrigins.decode(null, null))
  }

  @Test
  fun keySlotsAreShortAndPerOrigin() {
    val name = KeySlots.name(origin)
    assertEquals(16, name.length)
    assertEquals(name, KeySlots.name(origin))
    assertNotEquals(name, KeySlots.name("https://other.example.org"))
    assert(Regex("^[A-Za-z0-9_-]+$").matches(name))
  }

  @Test
  fun onlyThePairedInstanceTakesTheOldKey() {
    val other = "https://other.example.org"
    // Paired with this origin, or with none (a phone never registered since receipts): it takes the old key.
    assertEquals(true, KeyChecks.mayTakeLegacy(null, origin, origin))
    assertEquals(true, KeyChecks.mayTakeLegacy(null, null, other))
    // Paired with another: a new key, so the paired instance keeps the one it holds.
    assertEquals(false, KeyChecks.mayTakeLegacy(null, origin, other))
    // Once claimed, only the claimer, whatever the pairing says.
    assertEquals(true, KeyChecks.mayTakeLegacy(origin, other, origin))
    assertEquals(false, KeyChecks.mayTakeLegacy(origin, null, other))
  }

  @Test
  fun theChannelFollowsTheSealedUrgencyOnlyOnceItOpened() {
    val low = PushSealed(iat, iat + 900, origin, "low")
    val page = PushSealed(iat, iat + 900, origin, "page")
    // Every call is a page in clear: a call sealed `low` (shown or refused) is not.
    assertEquals(false, PushChecks.isPage(true, low, null))
    assertEquals(false, PushChecks.isPage(true, low, "wrong_origin"))
    assertEquals(false, PushChecks.isPage(true, low, "not_paired"))
    assertEquals(true, PushChecks.isPage(false, page, null))
    // Expired stays loud: a phone clock running ahead never quiets a page.
    assertEquals(true, PushChecks.isPage(true, low, "expired"))
    // Nothing opened (unknown key, AEAD failure) or v1: the clear urgency.
    assertEquals(true, PushChecks.isPage(true, null, null))
    assertEquals(false, PushChecks.isPage(false, null, null))
  }

  @Test
  fun originsAsJavaScriptWritesThem() {
    for ((url, expected) in listOf(
      "https://Brigade.Example.com/api/auth" to "https://brigade.example.com",
      "https://brigade.example.com:443/x" to "https://brigade.example.com",
      "http://localhost:8787/api" to "http://localhost:8787",
      "http://[::1]:8787/api" to "http://[::1]:8787",
      "https://[2001:db8::1]/" to "https://[2001:db8::1]",
      // java.net.URI has no host for these; JavaScript's URL does.
      "https://my_host.internal/api/auth" to "https://my_host.internal",
      "http://dev_box:8787" to "http://dev_box:8787",
      "https://user@brigade.example.com/" to "https://brigade.example.com",
      "ftp://brigade.example.com" to null,
      "https://brigade.example.com:99999/" to null,
      "not a url" to null,
    )) {
      assertEquals(url, expected, PushReceipt.originOf(url))
    }
    // A receipt on such a host is taken; one with user info is not.
    val json = { url: String -> JSONObject().put("url", url).put("token", "tok") }
    assertNotNull(PushReceipt.parse(json("https://my_host.internal/api/receipts")))
    assertNull(PushReceipt.parse(json("https://user@brigade.example.com/api/receipts")))
    assertNull(PushReceipt.parse(json("http://brigade.example.com/api/receipts")))
    assertNotNull(PushReceipt.parse(json("http://localhost:8787/api/receipts")))
  }
}

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
  fun keySlotsAreShortAndPerOrigin() {
    val name = KeySlots.name(origin)
    assertEquals(16, name.length)
    assertEquals(name, KeySlots.name(origin))
    assertNotEquals(name, KeySlots.name("https://other.example.org"))
    assert(Regex("^[A-Za-z0-9_-]+$").matches(name))
  }
}

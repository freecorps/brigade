package app.freecorps.brigade.push

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Proof that a tap's incident and workspace came from this app's own notification ([Pages.notify]) and not from
 * another app starting the launcher activity, which is exported, with the same extras to switch workspace or open an
 * incident: an HMAC-SHA256 over them and when the notification was made, under a random key kept in the app's private
 * preferences. Honoured for [MAX_AGE_MS]. Plain Kotlin, tested on the JVM (PageTapTest.kt).
 */
object PageTap {
  /** A page may sit in the notification shade overnight. */
  const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
  const val KEY_LENGTH = 32

  fun newKey(): ByteArray = ByteArray(KEY_LENGTH).also { SecureRandom().nextBytes(it) }

  fun sign(key: ByteArray, incident: String, workspace: String, issuedAt: Long): String =
    Base64url.encode(mac(key, incident, workspace, issuedAt))

  fun verify(key: ByteArray, incident: String, workspace: String, issuedAt: Long, proof: String?, now: Long): Boolean {
    if (key.size != KEY_LENGTH || proof == null) return false
    if (issuedAt > now || now - issuedAt > MAX_AGE_MS) return false
    val given = Base64url.decode(proof) ?: return false
    return MessageDigest.isEqual(given, mac(key, incident, workspace, issuedAt))
  }

  private fun mac(key: ByteArray, incident: String, workspace: String, issuedAt: Long): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    // Length-prefixed, so no two pairs of ids sign the same bytes.
    for (part in listOf("brigade page tap v1", incident, workspace, issuedAt.toString())) {
      val bytes = part.toByteArray()
      mac.update(bytes.size.toString().toByteArray())
      mac.update(':'.code.toByte())
      mac.update(bytes)
    }
    return mac.doFinal()
  }
}

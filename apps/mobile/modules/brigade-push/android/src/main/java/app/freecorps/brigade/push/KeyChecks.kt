package app.freecorps.brigade.push

import java.security.spec.InvalidKeySpecException
import javax.crypto.AEADBadTagException

/** What [DeviceKey] decides about a key, without the Keystore, so it is tested on the JVM (KeyChecksTest.kt). */
internal object KeyChecks {
  /**
   * A Keystore key that has done one ECDH, or null when making it or using it fails; then it is deleted, and the
   * caller makes the wrapped key instead. Some Keystores make a `PURPOSE_AGREE_KEY` key and then fail every
   * `KeyAgreement` with it: kept, that phone would register a key it can never open a page with.
   */
  fun <K> provenOrNull(
    generate: () -> K,
    agree: (K) -> ByteArray,
    delete: () -> Unit,
    log: (String) -> Unit = {},
  ): K? {
    try {
      val key = generate()
      val secret = agree(key)
      // P-256's shared secret is its x coordinate, 32 bytes.
      if (secret.size == Hpke.SECRET_LENGTH) {
        secret.fill(0)
        return key
      }
      log("Keystore key agreement gave ${secret.size} bytes")
    } catch (error: Exception) {
      log("Keystore key agreement unavailable: $error")
    }
    try {
      delete()
    } catch (_: Exception) {}
    return null
  }

  /**
   * Whether opening the wrapped key failed for good: its wrapping key no longer opens it (the tag does not match) or
   * what it opens to is not a key. Every page would fall back from then on, so the key is dropped and the next
   * registration makes and registers a new one. Anything else (a Keystore that is busy, say) may pass, so the key
   * stays.
   */
  fun unwrapLost(error: Throwable): Boolean =
    generateSequence(error) { it.cause }.take(8).any { it is AEADBadTagException || it is InvalidKeySpecException }

  /**
   * Whether the instance at [origin] may take the key from before keys per instance: the origin that claimed it, or,
   * while unclaimed, the instance the phone is paired with ([paired], registered with that key), or any origin when
   * it is paired with none. Another origin gets a new key, so the paired instance keeps the key it holds.
   */
  fun mayTakeLegacy(claimed: String?, paired: String?, origin: String): Boolean =
    if (claimed != null) claimed == origin else paired == null || paired == origin
}

/**
 * Names of the per-instance key slots ([DeviceKey]'s Keystore aliases and wrapped files), from the instance's origin
 * (RFC 0015 section 4): base64url of the first 12 bytes of SHA-256 over the origin, 16 characters, safe in an alias
 * and a file name whatever the origin's length. Plain, tested on the JVM.
 */
object KeySlots {
  const val AGREE_PREFIX = "app.freecorps.brigade.push.device-key.v2."
  const val WRAP_PREFIX = "app.freecorps.brigade.push.wrap-key.v2."
  const val FILE_PREFIX = "brigade-device-key-v2-"

  fun name(origin: String): String =
    Base64url.encode(java.security.MessageDigest.getInstance("SHA-256").digest(origin.toByteArray()).copyOfRange(0, 12))
}

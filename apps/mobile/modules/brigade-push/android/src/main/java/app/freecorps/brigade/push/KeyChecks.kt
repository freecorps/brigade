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
}

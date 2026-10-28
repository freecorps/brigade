package app.freecorps.brigade.push

import java.security.KeyStoreException
import java.security.spec.InvalidKeySpecException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyChecksTest {
  @Test
  fun keepsAKeystoreKeyThatAgrees() {
    var deleted = false
    val key = KeyChecks.provenOrNull(generate = { "key" }, agree = { ByteArray(32) }, delete = { deleted = true })
    assertEquals("key", key)
    assertFalse(deleted)
  }

  @Test
  fun dropsAKeystoreKeyThatIsMadeButCannotAgree() {
    var deleted = false
    val key = KeyChecks.provenOrNull<String>(
      generate = { "key" },
      agree = { throw java.security.InvalidKeyException("Keystore operation failed") },
      delete = { deleted = true },
    )
    assertNull(key)
    assertTrue(deleted)
  }

  @Test
  fun dropsAKeystoreKeyThatAgreesToTheWrongLength() {
    var deleted = false
    assertNull(KeyChecks.provenOrNull(generate = { "key" }, agree = { ByteArray(16) }, delete = { deleted = true }))
    assertTrue(deleted)
  }

  @Test
  fun fallsBackWhenTheKeystoreCannotMakeTheKey() {
    var deleted = false
    val key = KeyChecks.provenOrNull<String>(
      generate = { throw java.security.InvalidAlgorithmParameterException("no agree key") },
      agree = { error("not reached") },
      // A delete that fails too still falls back.
      delete = {
        deleted = true
        throw KeyStoreException("no entry")
      },
    )
    assertNull(key)
    assertTrue(deleted)
  }

  @Test
  fun aWrappedKeyThatNoLongerOpensIsLost() {
    val first = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val seal = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, first) }
    val sealed = seal.doFinal(ByteArray(64))
    val error = runCatching {
      Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.DECRYPT_MODE, other, GCMParameterSpec(128, seal.iv))
        doFinal(sealed)
      }
    }.exceptionOrNull()!!
    assertTrue(error is AEADBadTagException)
    assertTrue(KeyChecks.unwrapLost(error))
    assertTrue(KeyChecks.unwrapLost(InvalidKeySpecException("not PKCS #8")))
    assertTrue(KeyChecks.unwrapLost(IllegalStateException("wrapped", AEADBadTagException())))
  }

  @Test
  fun aKeystoreHiccupKeepsTheWrappedKey() {
    assertFalse(KeyChecks.unwrapLost(IllegalStateException("no wrapping key")))
    assertFalse(KeyChecks.unwrapLost(KeyStoreException("busy")))
    assertFalse(KeyChecks.unwrapLost(java.security.ProviderException("Keystore operation failed")))
  }
}

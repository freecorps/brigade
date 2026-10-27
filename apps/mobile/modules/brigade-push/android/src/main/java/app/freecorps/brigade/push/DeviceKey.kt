package app.freecorps.brigade.push

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The device key pages are sealed to (RFC 0006 "Device key"): P-256, for HPKE's DHKEM, as on iOS. Created on first
 * use; readable after the first unlock (no user authentication, no unlocked-device requirement), so a page decrypts
 * on a locked phone.
 *
 * - **Android 12+:** the private key is made inside the Android Keystore with `PURPOSE_AGREE_KEY` and never leaves it;
 *   the Keystore does the ECDH, the key schedule runs in [Hpke].
 * - **Android 7 to 11** cannot do ECDH with a Keystore key (`PURPOSE_AGREE_KEY` is API 31). There the key pair is
 *   made in software and its private key kept encrypted (AES-256-GCM) under a key that never leaves the Keystore, in
 *   the app's no-backup directory: it is decrypted in memory only to open a page. The closest safe option, recorded
 *   in RFC 0006.
 *
 * A phone that moves from 11 to 12 keeps the key it has (a new key is a new device id). Neither key is in a backup.
 */
object DeviceKey {
  private const val TAG = "BrigadePush"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val AGREE_ALIAS = "app.freecorps.brigade.push.device-key.v1"
  private const val WRAP_ALIAS = "app.freecorps.brigade.push.wrap-key.v1"
  private const val WRAPPED_FILE = "brigade-device-key-v1"

  /** The public key, uncompressed (65 bytes), creating the key on first use. */
  @Synchronized
  fun publicKey(context: Context): ByteArray {
    keystoreKey()?.let { return it.second }
    wrapped(context)?.let { return it.publicKey }
    return create(context)
  }

  /**
   * ECDH between the device key and a sender's ephemeral public key (uncompressed, already checked to be on the
   * curve): the shared x coordinate. Throws when there is no key (it was never made, or Android dropped it).
   */
  @Synchronized
  fun agree(context: Context, ephemeral: ByteArray): ByteArray {
    val peer = P256.publicKey(ephemeral)
    keystoreKey()?.let { (privateKey, _) ->
      val agreement = KeyAgreement.getInstance("ECDH", KEYSTORE)
      agreement.init(privateKey)
      agreement.doPhase(peer, true)
      return agreement.generateSecret()
    }
    val stored = wrapped(context) ?: throw IllegalStateException("no device key")
    val privateKey = unwrap(stored.sealed)
    val agreement = KeyAgreement.getInstance("ECDH")
    agreement.init(privateKey)
    agreement.doPhase(peer, true)
    return agreement.generateSecret()
  }

  /** The recipient's public key for [Hpke.open], without creating one. */
  @Synchronized
  fun existingPublicKey(context: Context): ByteArray? = keystoreKey()?.second ?: wrapped(context)?.publicKey

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun keystoreKey(): Pair<PrivateKey, ByteArray>? {
    val store = keyStore()
    val privateKey = store.getKey(AGREE_ALIAS, null) as? PrivateKey ?: return null
    val publicKey = store.getCertificate(AGREE_ALIAS)?.publicKey as? ECPublicKey ?: return null
    return privateKey to P256.encode(publicKey.w)
  }

  private fun create(context: Context): ByteArray {
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        generator.initialize(
          KeyGenParameterSpec.Builder(AGREE_ALIAS, KeyProperties.PURPOSE_AGREE_KEY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .build(),
        )
        val pair = generator.generateKeyPair()
        return P256.encode((pair.public as ECPublicKey).w)
      } catch (error: Exception) {
        // A Keystore that cannot agree keys (seen on some vendors' builds): the wrapped key below instead.
        Log.w(TAG, "Keystore key agreement unavailable: $error")
        try {
          keyStore().deleteEntry(AGREE_ALIAS)
        } catch (_: Exception) {}
      }
    }
    val generator = KeyPairGenerator.getInstance("EC")
    generator.initialize(ECGenParameterSpec("secp256r1"))
    val pair = generator.generateKeyPair()
    val publicKey = P256.encode((pair.public as ECPublicKey).w)
    val sealed = wrap(pair.private.encoded)
    val file = AtomicFile(File(context.noBackupFilesDir, WRAPPED_FILE))
    val out = file.startWrite()
    try {
      out.write(byteArrayOf(publicKey.size.toByte()))
      out.write(publicKey)
      out.write(sealed)
      file.finishWrite(out)
    } catch (error: Exception) {
      file.failWrite(out)
      throw error
    }
    return publicKey
  }

  private class Wrapped(val publicKey: ByteArray, val sealed: ByteArray)

  private fun wrapped(context: Context): Wrapped? {
    val file = File(context.noBackupFilesDir, WRAPPED_FILE)
    if (!file.exists()) return null
    val bytes = AtomicFile(file).readFully()
    val length = bytes.firstOrNull()?.toInt() ?: return null
    if (length != Hpke.POINT_LENGTH || bytes.size <= 1 + length + 12) return null
    // Without its wrapping key (cleared with the Keystore, say) the stored key is useless: start again.
    if (wrapKey() == null) {
      file.delete()
      return null
    }
    return Wrapped(bytes.copyOfRange(1, 1 + length), bytes.copyOfRange(1 + length, bytes.size))
  }

  private fun wrapKey(): SecretKey? = keyStore().getKey(WRAP_ALIAS, null) as? SecretKey

  private fun wrap(privateKey: ByteArray): ByteArray {
    val key = wrapKey() ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
      init(
        KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build(),
      )
      generateKey()
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    // The Keystore picks the IV; it goes first.
    return cipher.iv + cipher.doFinal(privateKey)
  }

  private fun unwrap(sealed: ByteArray): PrivateKey {
    val key = wrapKey() ?: throw IllegalStateException("no wrapping key")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
    val pkcs8 = cipher.doFinal(sealed.copyOfRange(12, sealed.size))
    try {
      return KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(pkcs8))
    } finally {
      pkcs8.fill(0)
    }
  }
}

package app.freecorps.brigade.push

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The device keys pages are sealed to (RFC 0006 "Device key"): P-256, for HPKE's DHKEM, as on iOS. One per instance
 * the phone is paired with, keyed by the instance's origin (RFC 0015 section 4), each in a slot of its own
 * ([KeySlots]). Created on first use; readable after the first unlock (no user authentication, no unlocked-device
 * requirement), so a page decrypts on a locked phone.
 *
 * - **Android 12+:** the private key is made inside the Android Keystore with `PURPOSE_AGREE_KEY` and never leaves it;
 *   the Keystore does the ECDH, the key schedule runs in [Hpke].
 * - **Android 7 to 11** cannot do ECDH with a Keystore key (`PURPOSE_AGREE_KEY` is API 31). There the key pair is
 *   made in software and its private key kept encrypted (AES-256-GCM) under a key that never leaves the Keystore, in
 *   the app's no-backup directory: it is decrypted in memory only to open a page. The closest safe option, recorded
 *   in RFC 0006.
 *
 * The one key from before keys per instance stays where it is (a Keystore alias cannot be renamed): the first origin
 * the app asks a key for claims it (`legacy-key-origin` in the app's private preferences), so a phone in the field
 * keeps its key and its device id at the instance it was registered with.
 *
 * A phone that moves from 11 to 12 keeps the key it has (a new key is a new device id). Neither key is in a backup.
 * A Keystore key is kept only once it has done one ECDH; a wrapped key that no longer opens is dropped
 * ([KeyChecks]), so the app registers a new one instead of every page falling back.
 */
object DeviceKey {
  private const val TAG = "BrigadePush"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val PREFS = "brigade_push"
  private const val LEGACY_ORIGIN = "legacy-key-origin"

  /** Where one key lives: its Keystore alias, or its wrapped file and that file's wrapping key. */
  internal class Slot(val agreeAlias: String, val wrapAlias: String, val file: String)

  private val LEGACY = Slot(
    "app.freecorps.brigade.push.device-key.v1",
    "app.freecorps.brigade.push.wrap-key.v1",
    "brigade-device-key-v1",
  )

  private fun slotFor(origin: String): Slot = slotNamed(KeySlots.name(origin))

  private fun slotNamed(name: String): Slot =
    Slot(KeySlots.AGREE_PREFIX + name, KeySlots.WRAP_PREFIX + name, KeySlots.FILE_PREFIX + name)

  /**
   * One key on this phone: its public key, the slot it is in ([slotName], null for the key from before keys per
   * instance) and, for that old key, the origin that claimed it ([legacyOrigin], null while unclaimed).
   */
  internal class Key(
    val publicKey: ByteArray,
    private val slot: Slot,
    private val slotName: String?,
    private val legacyOrigin: String?,
  ) {
    /**
     * The origin this key belongs to, as `PushChecks.refusal` takes it, for a page sealed for [sealedOrigin]: that
     * origin when the key is in its slot, another value when it is in another's, the claim (or null) for the old key.
     */
    fun originFor(sealedOrigin: String): String? = when {
      slotName == null -> legacyOrigin
      slotName == KeySlots.name(sealedOrigin) -> sealedOrigin
      else -> "another instance"
    }

    fun agree(context: Context, ephemeral: ByteArray): ByteArray = DeviceKey.agree(context, slot, ephemeral)
  }

  /** The key for the instance at [origin] (an http(s) origin, as `URL.origin` writes it), creating it on first use. */
  @Synchronized
  fun publicKey(context: Context, origin: String): ByteArray {
    val slot = slotFor(origin)
    existing(context, slot)?.let { return it }
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val claimed = prefs.getString(LEGACY_ORIGIN, null)
    if (claimed == null || claimed == origin) {
      existing(context, LEGACY)?.let { key ->
        if (claimed == null) prefs.edit().putString(LEGACY_ORIGIN, origin).commit()
        return key
      }
    }
    return create(context, slot)
  }

  /**
   * Without an origin (JavaScript that does not know it): the paired instance's key, else the old single key, else
   * the one instance key there is, else a new old-style key (which the first origin then claims). As on iOS.
   */
  @Synchronized
  fun publicKey(context: Context): ByteArray {
    Pages.receiptOrigin(context)?.let { paired ->
      keyFor(context, paired)?.let { return it }
    }
    existing(context, LEGACY)?.let { return it }
    keys(context).singleOrNull()?.let { return it.publicKey }
    return create(context, LEGACY)
  }

  /** The key the instance at [origin] has, without creating one. */
  private fun keyFor(context: Context, origin: String): ByteArray? {
    existing(context, slotFor(origin))?.let { return it }
    val claimed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LEGACY_ORIGIN, null)
    return if (claimed == origin) existing(context, LEGACY) else null
  }

  /** Every device key on this phone; one that cannot be read is left out, never in the way of the others. */
  @Synchronized
  internal fun keys(context: Context): List<Key> {
    val claimed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LEGACY_ORIGIN, null)
    val names = mutableSetOf<String>()
    try {
      for (alias in keyStore().aliases()) {
        if (alias.startsWith(KeySlots.AGREE_PREFIX)) names.add(alias.removePrefix(KeySlots.AGREE_PREFIX))
      }
    } catch (error: Exception) {
      Log.w(TAG, "Keystore not listed: ${error.javaClass.simpleName}")
    }
    context.noBackupFilesDir.listFiles()?.forEach { file ->
      if (file.name.startsWith(KeySlots.FILE_PREFIX)) names.add(file.name.removePrefix(KeySlots.FILE_PREFIX))
    }
    val out = mutableListOf<Key>()
    try {
      existing(context, LEGACY)?.let { out.add(Key(it, LEGACY, null, claimed)) }
    } catch (error: Exception) {
      Log.w(TAG, "old device key unreadable: ${error.javaClass.simpleName}")
    }
    for (name in names) {
      val slot = slotNamed(name)
      try {
        existing(context, slot)?.let { out.add(Key(it, slot, name, null)) }
      } catch (error: Exception) {
        Log.w(TAG, "device key unreadable: ${error.javaClass.simpleName}")
      }
    }
    return out
  }

  /** A slot's public key, if it has one. */
  private fun existing(context: Context, slot: Slot): ByteArray? =
    keystoreKey(slot)?.second ?: wrapped(context, slot)?.publicKey

  /**
   * ECDH between a slot's key and a sender's ephemeral public key (uncompressed, already checked to be on the
   * curve): the shared x coordinate. Throws when there is no key (it was never made, or Android dropped it).
   */
  @Synchronized
  internal fun agree(context: Context, slot: Slot, ephemeral: ByteArray): ByteArray {
    val peer = P256.publicKey(ephemeral)
    keystoreKey(slot)?.let { (privateKey, _) -> return keystoreAgree(privateKey, peer) }
    val stored = wrapped(context, slot) ?: throw IllegalStateException("no device key")
    val privateKey = try {
      unwrap(slot, stored.sealed)
    } catch (error: Exception) {
      if (KeyChecks.unwrapLost(error)) {
        // It will never open again: without this, every page falls back while the instance keeps sealing to it. The
        // app registers again when it next comes to the foreground, with a new key (a new device id; the instance
        // drops this one by its push token).
        Log.w(TAG, "wrapped device key unreadable: dropped")
        forget(context, slot)
      }
      throw error
    }
    val agreement = KeyAgreement.getInstance("ECDH")
    agreement.init(privateKey)
    agreement.doPhase(peer, true)
    return agreement.generateSecret()
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun keystoreKey(slot: Slot): Pair<PrivateKey, ByteArray>? {
    val store = keyStore()
    val privateKey = store.getKey(slot.agreeAlias, null) as? PrivateKey ?: return null
    val publicKey = store.getCertificate(slot.agreeAlias)?.publicKey as? ECPublicKey ?: return null
    return privateKey to P256.encode(publicKey.w)
  }

  private fun keystoreAgree(privateKey: PrivateKey, peer: PublicKey): ByteArray {
    val agreement = KeyAgreement.getInstance("ECDH", KEYSTORE)
    agreement.init(privateKey)
    agreement.doPhase(peer, true)
    return agreement.generateSecret()
  }

  /** Drops a slot's wrapped key and its wrapping key, so the next [publicKey] makes a new one. */
  private fun forget(context: Context, slot: Slot) {
    File(context.noBackupFilesDir, slot.file).delete()
    try {
      keyStore().deleteEntry(slot.wrapAlias)
    } catch (_: Exception) {}
  }

  private fun softwarePair(): KeyPair =
    KeyPairGenerator.getInstance("EC").run {
      initialize(ECGenParameterSpec("secp256r1"))
      generateKeyPair()
    }

  private fun create(context: Context, slot: Slot): ByteArray {
    if (Build.VERSION.SDK_INT >= 31) {
      // A Keystore that cannot agree keys (seen on some vendors' builds), at generation or only at use: the wrapped
      // key below instead. One ECDH with a throwaway key, read back from the Keystore as pages will, proves it.
      val publicKey = KeyChecks.provenOrNull(
        generate = {
          val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
          generator.initialize(
            KeyGenParameterSpec.Builder(slot.agreeAlias, KeyProperties.PURPOSE_AGREE_KEY)
              .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
              .build(),
          )
          generator.generateKeyPair()
          keystoreKey(slot) ?: throw IllegalStateException("Keystore key not stored")
        },
        agree = { (privateKey, _) -> keystoreAgree(privateKey, softwarePair().public) },
        delete = { keyStore().deleteEntry(slot.agreeAlias) },
        log = { Log.w(TAG, it) },
      )?.second
      if (publicKey != null) return publicKey
    }
    val pair = softwarePair()
    val publicKey = P256.encode((pair.public as ECPublicKey).w)
    val sealed = wrap(slot, pair.private.encoded)
    val file = AtomicFile(File(context.noBackupFilesDir, slot.file))
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

  private fun wrapped(context: Context, slot: Slot): Wrapped? {
    val file = File(context.noBackupFilesDir, slot.file)
    if (!file.exists()) return null
    val bytes = AtomicFile(file).readFully()
    val length = bytes.firstOrNull()?.toInt() ?: return null
    if (length != Hpke.POINT_LENGTH || bytes.size <= 1 + length + 12) return null
    // Without its wrapping key (cleared with the Keystore, say) the stored key is useless: start again.
    if (wrapKey(slot) == null) {
      file.delete()
      return null
    }
    return Wrapped(bytes.copyOfRange(1, 1 + length), bytes.copyOfRange(1 + length, bytes.size))
  }

  private fun wrapKey(slot: Slot): SecretKey? = keyStore().getKey(slot.wrapAlias, null) as? SecretKey

  private fun wrap(slot: Slot, privateKey: ByteArray): ByteArray {
    val key = wrapKey(slot) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
      init(
        KeyGenParameterSpec.Builder(slot.wrapAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
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

  private fun unwrap(slot: Slot, sealed: ByteArray): PrivateKey {
    val key = wrapKey(slot) ?: throw IllegalStateException("no wrapping key")
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

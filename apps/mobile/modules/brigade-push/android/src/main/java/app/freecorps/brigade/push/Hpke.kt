package app.freecorps.brigade.push

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The receiving half of HPKE (RFC 9180) as packages/push seals it (RFC 0006): base mode, single shot,
 * DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM. The Diffie-Hellman step is passed in ([dh]) so the private key
 * can stay in the Android Keystore; everything after it is the key schedule, in plain JCA. Plain Kotlin, tested on
 * the JVM (HpkeTest.kt, RFC 9180's vector A.3.1 and a page sealed by packages/push).
 */
object Hpke {
  private val V1 = "HPKE-v1".toByteArray()
  /** DHKEM(P-256, HKDF-SHA256): KEM id 0x0010. */
  private val KEM_SUITE = "KEM".toByteArray() + byteArrayOf(0x00, 0x10)
  /** KEM 0x0010, KDF 0x0001 (HKDF-SHA256), AEAD 0x0001 (AES-128-GCM). */
  private val HPKE_SUITE = "HPKE".toByteArray() + byteArrayOf(0x00, 0x10, 0x00, 0x01, 0x00, 0x01)
  private const val MODE_BASE: Byte = 0x00
  const val POINT_LENGTH = 65

  /**
   * Opens a ciphertext sealed to [recipientPublicKey] (uncompressed, 65 bytes). [dh] computes the shared x coordinate
   * with the recipient's private key and the sender's ephemeral public key ([enc], checked to be on the curve first).
   * Throws when anything does not match.
   */
  fun open(
    enc: ByteArray,
    ct: ByteArray,
    info: ByteArray,
    recipientPublicKey: ByteArray,
    aad: ByteArray = ByteArray(0),
    dh: (ephemeral: ByteArray) -> ByteArray,
  ): ByteArray {
    require(P256.isPoint(enc)) { "enc is not an uncompressed P-256 point" }
    require(recipientPublicKey.size == POINT_LENGTH) { "recipient key is not an uncompressed point" }
    require(ct.size >= 16) { "ciphertext shorter than its tag" }
    val shared = dh(enc)
    require(shared.size == 32) { "Diffie-Hellman result is not 32 bytes" }
    val eaePrk = labeledExtract(KEM_SUITE, ByteArray(0), "eae_prk", shared)
    val sharedSecret = labeledExpand(KEM_SUITE, eaePrk, "shared_secret", enc + recipientPublicKey, 32)
    val pskIdHash = labeledExtract(HPKE_SUITE, ByteArray(0), "psk_id_hash", ByteArray(0))
    val infoHash = labeledExtract(HPKE_SUITE, ByteArray(0), "info_hash", info)
    val context = byteArrayOf(MODE_BASE) + pskIdHash + infoHash
    val secret = labeledExtract(HPKE_SUITE, sharedSecret, "secret", ByteArray(0))
    val key = labeledExpand(HPKE_SUITE, secret, "key", context, 16)
    val nonce = labeledExpand(HPKE_SUITE, secret, "base_nonce", context, 12)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
    cipher.updateAAD(aad)
    return cipher.doFinal(ct)
  }

  private fun labeledExtract(suite: ByteArray, salt: ByteArray, label: String, ikm: ByteArray): ByteArray =
    extract(salt, V1 + suite + label.toByteArray() + ikm)

  private fun labeledExpand(suite: ByteArray, prk: ByteArray, label: String, info: ByteArray, length: Int): ByteArray =
    expand(prk, byteArrayOf((length shr 8).toByte(), length.toByte()) + V1 + suite + label.toByteArray() + info, length)

  /** HKDF-Extract (RFC 5869). An empty salt is HashLen zero bytes, which is how HMAC pads an empty key anyway. */
  private fun extract(salt: ByteArray, ikm: ByteArray): ByteArray =
    hmac(if (salt.isEmpty()) ByteArray(32) else salt, ikm)

  private fun expand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
    val out = ByteArray(length)
    var block = ByteArray(0)
    var offset = 0
    var counter = 1
    while (offset < length) {
      block = hmac(prk, block + info + byteArrayOf(counter.toByte()))
      val n = minOf(block.size, length - offset)
      System.arraycopy(block, 0, out, offset, n)
      offset += n
      counter++
    }
    return out
  }

  private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }
}

/** P-256 points as packages/push writes them: uncompressed, `04 || x || y`. */
object P256 {
  private val p = BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16)
  private val b = BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16)

  val params: ECParameterSpec by lazy {
    val parameters = AlgorithmParameters.getInstance("EC")
    parameters.init(ECGenParameterSpec("secp256r1"))
    parameters.getParameterSpec(ECParameterSpec::class.java)
  }

  /** Whether [point] is an uncompressed point on the curve (y² = x³ − 3x + b mod p), not the identity. */
  fun isPoint(point: ByteArray): Boolean {
    if (point.size != Hpke.POINT_LENGTH || point[0] != 0x04.toByte()) return false
    val x = BigInteger(1, point.copyOfRange(1, 33))
    val y = BigInteger(1, point.copyOfRange(33, 65))
    if (x >= p || y >= p) return false
    val left = y.modPow(BigInteger.valueOf(2), p)
    val right = x.modPow(BigInteger.valueOf(3), p).subtract(x.multiply(BigInteger.valueOf(3))).add(b).mod(p)
    return left == right
  }

  fun publicKey(point: ByteArray): PublicKey {
    require(isPoint(point)) { "not an uncompressed P-256 point" }
    val spec = ECPublicKeySpec(
      ECPoint(BigInteger(1, point.copyOfRange(1, 33)), BigInteger(1, point.copyOfRange(33, 65))),
      params,
    )
    return KeyFactory.getInstance("EC").generatePublic(spec)
  }

  /** `04 || x || y`, each coordinate left-padded to 32 bytes. */
  fun encode(point: ECPoint): ByteArray = byteArrayOf(0x04) + fixed(point.affineX) + fixed(point.affineY)

  private fun fixed(value: BigInteger): ByteArray {
    val bytes = value.toByteArray()
    return when {
      bytes.size == 32 -> bytes
      bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size)
      else -> ByteArray(32 - bytes.size) + bytes
    }
  }
}

package app.freecorps.brigade.push

import java.net.URI
import org.json.JSONObject

/**
 * An FCM data message from the relay (apps/relay src/fcm.ts `fcmData`): the sealed envelope (packages/push
 * `PushEnvelope`), what it is (`kind`, `urgency`, in clear like APNs' headers) and, for a call, its id; `tag` replaces
 * an earlier notification with the same one (the APNs collapse id's role). Plain Kotlin, tested on the JVM.
 */
data class PushMessage(
  val enc: ByteArray,
  val ct: ByteArray,
  val kind: String,
  /** The urgency in clear, as the relay wrote it. A version 2 page's sealed urgency wins over it ([PushSealed]). */
  val urgency: String,
  val callId: String?,
  val tag: String?,
  /** 1 or 2 (packages/push `PushEnvelope`). */
  val version: Int = 1,
  /** Version 2: the id of the device key it is sealed to (`k`, [PushKeyId]); null for version 1. */
  val keyId: String? = null,
) {
  val isCall: Boolean
    get() = kind == "call"

  val isPage: Boolean
    get() = urgency == "page"

  companion object {
    const val ENVELOPE_VERSION = "1"
    const val ENVELOPE_V2 = "2"
    /** A call id as the relay takes it: a lowercase UUID. */
    private val CALL_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    /** packages/push `PUSH_KEY_ID`. */
    private val KEY_ID = Regex("^[A-Za-z0-9_-]{8}$")
    val URGENCIES = setOf("low", "high", "page")

    /** Whether [data] is one of Brigade's (another sender's message is left to expo-notifications). */
    fun isBrigade(data: Map<String, String>): Boolean = data.containsKey("enc") && data.containsKey("ct")

    /**
     * The message, or null when it is not one this app can open (another version, a broken field). A null still
     * shows the fallback text: never silent (RFC 0006).
     */
    fun parse(data: Map<String, String>): PushMessage? {
      val version = when (data["v"]) {
        ENVELOPE_VERSION -> 1
        ENVELOPE_V2 -> 2
        else -> return null
      }
      val keyId = if (version == 2) data["k"]?.takeIf { KEY_ID.matches(it) } ?: return null else null
      val enc = base64url(data["enc"]) ?: return null
      val ct = base64url(data["ct"]) ?: return null
      if (enc.size != Hpke.POINT_LENGTH || ct.size < 16) return null
      val kind = data["kind"] ?: "alert"
      if (kind != "alert" && kind != "call") return null
      val urgency = data["urgency"]?.takeIf { it in URGENCIES } ?: "high"
      val callId = data["callId"]
      if (kind == "call" && (callId == null || !CALL_ID.matches(callId) || urgency != "page")) return null
      return PushMessage(enc, ct, kind, urgency, callId, data["tag"]?.takeIf { it.length in 1..64 }, version, keyId)
    }

    private fun base64url(value: String?): ByteArray? = value?.let(Base64url::decode)
  }
}

/** HPKE `info`, packages/push `PUSH_HPKE_INFO`: binds every page to this protocol and version. */
val PUSH_HPKE_INFO = "app.freecorps.brigade push v1".toByteArray()

/** packages/push `PUSH_HPKE_INFO_V2` (RFC 0015 section 4): a v2 page does not open as v1, nor the other way round. */
val PUSH_HPKE_INFO_V2 = "app.freecorps.brigade push v2".toByteArray()

/** Base64url without padding, as packages/push writes every binary field. `java.util.Base64` needs Android 8. */
object Base64url {
  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

  fun encode(bytes: ByteArray): String {
    val out = StringBuilder((bytes.size * 4 + 2) / 3)
    var i = 0
    while (i < bytes.size) {
      val b0 = bytes[i].toInt() and 0xff
      val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
      val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
      out.append(ALPHABET[b0 shr 2])
      out.append(ALPHABET[((b0 and 0x03) shl 4) or (b1 shr 4)])
      if (i + 1 < bytes.size) out.append(ALPHABET[((b1 and 0x0f) shl 2) or (b2 shr 6)])
      if (i + 2 < bytes.size) out.append(ALPHABET[b2 and 0x3f])
      i += 3
    }
    return out.toString()
  }

  /** Null for any character outside the alphabet (padding aside) or an impossible length. */
  fun decode(value: String): ByteArray? {
    val text = value.trimEnd('=')
    if (text.length % 4 == 1) return null
    val out = java.io.ByteArrayOutputStream(text.length * 3 / 4)
    var buffer = 0
    var bits = 0
    for (char in text) {
      val digit = ALPHABET.indexOf(char)
      if (digit < 0) return null
      buffer = (buffer shl 6) or digit
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write((buffer shr bits) and 0xff)
      }
    }
    return out.toByteArray()
  }
}

/** What the instance sealed (packages/push `PushContent`), as the iOS extension reads it (BrigadePushCrypto.swift). */
data class PushContent(
  val title: String,
  val body: String,
  val incident: String?,
  val workspace: String?,
  val receipt: PushReceipt?,
  /** What a version 2 envelope sealed; null for version 1. */
  val sealed: PushSealed? = null,
) {
  companion object {
    /**
     * The plaintext's JSON, or a thrown error when it is not `{ title, body, incident?, workspace?, receipt? }`, or
     * for version 2 ([v2]) lacks valid sealed fields ([PushSealed.parse]).
     */
    fun parse(plaintext: ByteArray, v2: Boolean = false): PushContent {
      val json = JSONObject(String(plaintext, Charsets.UTF_8))
      val title = json.opt("title") as? String ?: throw IllegalArgumentException("no title")
      val body = json.opt("body") as? String ?: throw IllegalArgumentException("no body")
      val sealed = if (v2) PushSealed.parse(json) ?: throw IllegalArgumentException("no sealed fields") else null
      return PushContent(
        title,
        body,
        json.opt("incident") as? String,
        json.opt("workspace") as? String,
        PushReceipt.parse(json.opt("receipt") as? JSONObject),
        sealed,
      )
    }
  }
}

/**
 * What a version 2 envelope seals besides the content (packages/push `PushSealed`, RFC 0015 section 4): when it was
 * made and until when it may be shown (Unix seconds), the instance's origin and the urgency.
 */
data class PushSealed(val iat: Long, val exp: Long, val origin: String, val urgency: String) {
  val isPage: Boolean
    get() = urgency == "page"

  companion object {
    /** packages/push `PUSH_MAX_TTL_SECONDS`. */
    const val MAX_TTL_SECONDS = 30L * 24 * 60 * 60
    /** packages/push `PUSH_CLOCK_SKEW_SECONDS`. */
    const val CLOCK_SKEW_SECONDS = 5L * 60

    /** packages/push `parseSealed`: whole seconds, `iat <= exp <= iat + 30 days`, a `URL.origin`, a known urgency. */
    fun parse(json: JSONObject): PushSealed? {
      val iat = integer(json.opt("iat")) ?: return null
      val exp = integer(json.opt("exp")) ?: return null
      if (iat < 0 || exp < iat || exp - iat > MAX_TTL_SECONDS) return null
      val origin = json.opt("origin") as? String ?: return null
      if (PushReceipt.originOf(origin) != origin) return null
      val urgency = json.opt("urgency") as? String ?: return null
      if (urgency !in PushMessage.URGENCIES) return null
      return PushSealed(iat, exp, origin, urgency)
    }

    /** org.json reads a JSON integer as Int or Long, a fraction as Double (refused). */
    private fun integer(value: Any?): Long? = when (value) {
      is Int -> value.toLong()
      is Long -> value
      else -> null
    }
  }
}

/**
 * Why a version 2 page is shown as the fallback text (packages/push `openOnPhone`), or null to show it. Plain, so the
 * JVM tests cover every branch. [keyOrigin]: the origin the key that opened it belongs to (null: the key from before
 * keys per instance, not claimed yet, which counts as the paired instance's). [paired]: the instance the phone is
 * paired with.
 */
object PushChecks {
  fun refusal(sealed: PushSealed, keyOrigin: String?, paired: String?, nowSeconds: Long): String? {
    if (nowSeconds > sealed.exp + PushSealed.CLOCK_SKEW_SECONDS) return "expired"
    if (keyOrigin != null && keyOrigin != sealed.origin) return "wrong_origin"
    if (paired != sealed.origin) return "not_paired"
    return null
  }

  /** The receipt to post, if any: v1 to the registered instance (as before), v2 only to its sealed, paired origin. */
  fun receiptToSend(content: PushContent, paired: String?): PushReceipt? {
    val receipt = content.receipt ?: return null
    val sealed = content.sealed ?: return receipt.takeIf { it.isFor(paired) }
    return receipt.takeIf { it.origin == sealed.origin && paired == sealed.origin }
  }
}

/**
 * packages/push `pushKeyId`: base64url of the first 6 bytes of SHA-256 over the uncompressed public key (65 bytes), 8
 * characters. A version 2 envelope names its device key with it, so the phone tries that one only.
 */
object PushKeyId {
  fun of(publicKey: ByteArray): String =
    Base64url.encode(java.security.MessageDigest.getInstance("SHA-256").digest(publicKey).copyOfRange(0, 6))
}

/**
 * A delivery receipt (RFC 0006 "Delivery receipts"): an https URL (http only for a loopback development server) and
 * an opaque token, each at most 512 characters, mirroring packages/push `parseReceipt`. Anything else is no receipt;
 * the page still shows.
 */
data class PushReceipt(val url: String, val token: String) {
  /** `scheme://host[:port]`, lowercased, the default port left out: JavaScript's `URL.origin`. */
  val origin: String?
    get() = originOf(url)

  /** Whether this receipt goes to the instance the app registered the phone with (`registered`), and only there. */
  fun isFor(registered: String?): Boolean = registered != null && origin == registered

  companion object {
    const val MAX_LENGTH = 512
    private val TOKEN = Regex("^[A-Za-z0-9._~-]+$")

    fun parse(value: JSONObject?): PushReceipt? {
      val url = value?.opt("url") as? String ?: return null
      val token = value.opt("token") as? String ?: return null
      if (url.length > MAX_LENGTH || token.length > MAX_LENGTH || !TOKEN.matches(token)) return null
      val uri = try {
        URI(url)
      } catch (_: Exception) {
        return null
      }
      val host = uri.host ?: return null
      if (uri.rawUserInfo != null) return null
      val loopback = host == "localhost" || host == "127.0.0.1"
      if (uri.scheme != "https" && !(uri.scheme == "http" && loopback)) return null
      return PushReceipt(url, token)
    }

    /** The origin of an http(s) URL, or null. */
    fun originOf(url: String): String? {
      val uri = try {
        URI(url)
      } catch (_: Exception) {
        return null
      }
      val scheme = uri.scheme?.lowercase() ?: return null
      if (scheme != "https" && scheme != "http") return null
      val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
      val defaultPort = if (scheme == "https") 443 else 80
      return if (uri.port == -1 || uri.port == defaultPort) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }
  }
}

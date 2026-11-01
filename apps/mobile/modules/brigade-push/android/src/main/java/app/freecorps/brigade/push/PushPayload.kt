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

    /** JavaScript's `Number.MAX_SAFE_INTEGER`: packages/push `parseSealed` takes safe integers only. */
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

    /**
     * org.json reads a JSON integer as Int or Long (a larger one as BigInteger), a fraction as Double: only a safe
     * integer is taken, as packages/push and iOS do.
     */
    private fun integer(value: Any?): Long? = when (value) {
      is Int -> value.toLong()
      is Long -> value.takeIf { it in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER }
      else -> null
    }
  }
}

/**
 * Why a version 2 page is shown as the fallback text (packages/push `openOnPhone`), or null to show it. Plain, so the
 * JVM tests cover every branch. [keyOrigin]: the origin the key that opened it belongs to (null: the key from before
 * keys per instance, not claimed yet, which counts as the paired instance's). [paired]: the instances the phone is
 * paired with (RFC 0015 section 5: one per instance it is signed in to and registered with).
 */
object PushChecks {
  fun refusal(sealed: PushSealed, keyOrigin: String?, paired: Collection<String>, nowSeconds: Long): String? {
    if (nowSeconds > sealed.exp + PushSealed.CLOCK_SKEW_SECONDS) return "expired"
    if (keyOrigin != null && keyOrigin != sealed.origin) return "wrong_origin"
    if (sealed.origin !in paired) return "not_paired"
    return null
  }

  /** [refusal] for a phone paired with one instance, or none. */
  fun refusal(sealed: PushSealed, keyOrigin: String?, paired: String?, nowSeconds: Long): String? =
    refusal(sealed, keyOrigin, listOfNotNull(paired), nowSeconds)

  /**
   * Whether a push (shown, or the fallback text) goes on the pages channel: its sealed urgency whenever it opened and
   * was not refused as expired ([refusal]), so the relay cannot make a refused or a sealed `low` push (a call
   * included: every call is a page in clear) ring as a page; else the urgency in clear ([clearIsPage]), so a push that
   * does not open, or a phone clock running ahead, never quiets a page. packages/push `fallbackUrgency`.
   */
  fun isPage(clearIsPage: Boolean, sealed: PushSealed?, refusal: String?): Boolean =
    if (sealed != null && refusal != "expired") sealed.isPage else clearIsPage

  /**
   * The receipt to post, if any: v2 only to its sealed origin, when the phone is paired with it; v1, which seals no
   * origin, only to the first paired instance (the one from before several instances), so a v1 page sealed by anyone
   * holding a device key cannot make the phone call out to another paired instance. An instance added later that
   * still seals v1 gets no receipts; its pages still show.
   */
  fun receiptToSend(content: PushContent, paired: List<String>): PushReceipt? {
    val receipt = content.receipt ?: return null
    val sealed = content.sealed ?: return receipt.takeIf { it.isFor(paired.firstOrNull()) }
    return receipt.takeIf { it.origin == sealed.origin && sealed.origin in paired }
  }

  /** [receiptToSend] for a phone paired with one instance, or none. */
  fun receiptToSend(content: PushContent, paired: String?): PushReceipt? = receiptToSend(content, listOfNotNull(paired))
}

/**
 * The instances this phone is paired with, as kept in the app's preferences (RFC 0015 section 5): one origin per line
 * (`receipt-origins-v2`), the first the one paired before several instances (`receipt-origin-v1`, merged in front), so
 * it stays the one that may claim the key from before keys per instance ([KeyChecks.mayTakeLegacy]). Plain, tested on
 * the JVM.
 */
object ReceiptOrigins {
  fun decode(list: String?, legacy: String?): List<String> {
    val stored = list?.split('\n')?.filter { it.isNotEmpty() } ?: emptyList()
    return (listOfNotNull(legacy) + stored).distinct()
  }

  fun encode(origins: List<String>): String = origins.joinToString("\n")

  fun with(origins: List<String>, origin: String): List<String> =
    if (origin in origins) origins else origins + origin

  fun without(origins: List<String>, origin: String): List<String> = origins.filter { it != origin }
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
      val authority = Authority.of(url) ?: return null
      if (authority.userInfo) return null
      val loopback = authority.host == "localhost" || authority.host == "127.0.0.1"
      if (authority.scheme != "https" && !(authority.scheme == "http" && loopback)) return null
      return PushReceipt(url, token)
    }

    /**
     * The origin of an http(s) URL as JavaScript's `URL.origin` writes it (lowercase, the default port left out, an
     * IPv6 host in brackets), or null.
     */
    fun originOf(url: String): String? {
      val authority = Authority.of(url) ?: return null
      val defaultPort = if (authority.scheme == "https") 443 else 80
      val port = authority.port
      return if (port == -1 || port == defaultPort) {
        "${authority.scheme}://${authority.host}"
      } else {
        "${authority.scheme}://${authority.host}:$port"
      }
    }
  }
}

/**
 * The scheme and authority of an http(s) URL, read leniently: `java.net.URI` has no host for a name it does not take
 * as a server name (`my_host.internal`, with an underscore), where JavaScript's URL and iOS's do. [port] is -1 when
 * there is none. Plain, tested on the JVM.
 */
data class Authority(val scheme: String, val host: String, val port: Int, val userInfo: Boolean) {
  companion object {
    fun of(url: String): Authority? {
      val uri = try {
        URI(url)
      } catch (_: Exception) {
        return null
      }
      val scheme = uri.scheme?.lowercase() ?: return null
      if (scheme != "https" && scheme != "http") return null
      var rest = uri.rawAuthority ?: return null
      val at = rest.lastIndexOf('@')
      val userInfo = at >= 0
      if (userInfo) rest = rest.substring(at + 1)
      val host: String
      var port = -1
      if (rest.startsWith("[")) {
        val end = rest.indexOf(']')
        if (end < 0) return null
        host = rest.substring(0, end + 1)
        val after = rest.substring(end + 1)
        if (after.isNotEmpty()) {
          if (!after.startsWith(":")) return null
          port = port(after.substring(1)) ?: return null
        }
      } else {
        val colon = rest.lastIndexOf(':')
        if (colon >= 0) {
          host = rest.substring(0, colon)
          port = port(rest.substring(colon + 1)) ?: return null
        } else {
          host = rest
        }
      }
      if (host.isEmpty() || host == "[]") return null
      return Authority(scheme, host.lowercase(), port, userInfo)
    }

    /** -1 for an empty port (`http://host:/`, as JavaScript reads it), null for one that is not a port. */
    private fun port(value: String): Int? {
      if (value.isEmpty()) return -1
      if (value.length > 5 || !value.all { it in '0'..'9' }) return null
      return value.toInt().takeIf { it <= 65535 }
    }
  }
}

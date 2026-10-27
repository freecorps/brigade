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
  val urgency: String,
  val callId: String?,
  val tag: String?,
) {
  val isCall: Boolean
    get() = kind == "call"

  val isPage: Boolean
    get() = urgency == "page"

  companion object {
    const val ENVELOPE_VERSION = "1"
    /** A call id as the relay takes it: a lowercase UUID. */
    private val CALL_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val URGENCIES = setOf("low", "high", "page")

    /** Whether [data] is one of Brigade's (another sender's message is left to expo-notifications). */
    fun isBrigade(data: Map<String, String>): Boolean = data.containsKey("enc") && data.containsKey("ct")

    /**
     * The message, or null when it is not one this app can open (another version, a broken field). A null still
     * shows the fallback text: never silent (RFC 0006).
     */
    fun parse(data: Map<String, String>): PushMessage? {
      if (data["v"] != ENVELOPE_VERSION) return null
      val enc = base64url(data["enc"]) ?: return null
      val ct = base64url(data["ct"]) ?: return null
      if (enc.size != Hpke.POINT_LENGTH || ct.size < 16) return null
      val kind = data["kind"] ?: "alert"
      if (kind != "alert" && kind != "call") return null
      val urgency = data["urgency"]?.takeIf { it in URGENCIES } ?: "high"
      val callId = data["callId"]
      if (kind == "call" && (callId == null || !CALL_ID.matches(callId) || urgency != "page")) return null
      return PushMessage(enc, ct, kind, urgency, callId, data["tag"]?.takeIf { it.length in 1..64 })
    }

    private fun base64url(value: String?): ByteArray? = value?.let(Base64url::decode)
  }
}

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
) {
  companion object {
    /** The plaintext's JSON, or a thrown error when it is not `{ title, body, incident?, workspace?, receipt? }`. */
    fun parse(plaintext: ByteArray): PushContent {
      val json = JSONObject(String(plaintext, Charsets.UTF_8))
      val title = json.opt("title") as? String ?: throw IllegalArgumentException("no title")
      val body = json.opt("body") as? String ?: throw IllegalArgumentException("no body")
      return PushContent(
        title,
        body,
        json.opt("incident") as? String,
        json.opt("workspace") as? String,
        PushReceipt.parse(json.opt("receipt") as? JSONObject),
      )
    }
  }
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

package app.freecorps.brigade.call

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Reads the incident aloud in the call, with the platform's text-to-speech, on the voice-call stream (the earpiece
 * or headset, like the rest of a call). Stand-in for the voice bot's server-side TTS (RFC 0010).
 */
object CallSpeech {
  private const val UTTERANCE = "brigade-call"
  private var tts: TextToSpeech? = null
  private var ready = false
  private var pending: Pair<String, String>? = null
  var onDone: ((utterance: String) -> Unit)? = null

  fun speak(context: Context, text: String, language: String) {
    pending = text to language
    val engine = tts
    if (engine == null) {
      tts = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (!ready) {
          Log.w("BrigadeCall", "text-to-speech unavailable: $status")
          // Nothing will be spoken: tell the call session, which waits for it, that this utterance is over.
          if (pending != null) {
            pending = null
            onDone?.invoke(UTTERANCE)
          }
        }
        flush()
      }.apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        setOnUtteranceProgressListener(
          object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) {
              Log.i("BrigadeCall", "speaking")
            }
            override fun onDone(utteranceId: String) {
              Log.i("BrigadeCall", "spoken")
              onDone?.invoke(utteranceId)
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String) {
              Log.w("BrigadeCall", "speech failed")
              // As if spoken: the call session moves on (hangs up after an ack) instead of waiting.
              onDone?.invoke(utteranceId)
            }

            override fun onError(utteranceId: String, errorCode: Int) {
              Log.w("BrigadeCall", "speech failed: $errorCode")
              onDone?.invoke(utteranceId)
            }
          },
        )
      }
    } else if (ready) {
      flush()
    }
  }

  private fun flush() {
    val (text, language) = pending ?: return
    val engine = tts ?: return
    if (!ready) return
    pending = null
    val result = engine.setLanguage(Locale.forLanguageTag(language))
    if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
      Log.w("BrigadeCall", "no voice for $language; using the engine's default")
    }
    if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE) == TextToSpeech.ERROR) {
      Log.w("BrigadeCall", "speech not queued")
      onDone?.invoke(UTTERANCE)
    }
  }

  fun stop() {
    pending = null
    tts?.stop()
  }
}

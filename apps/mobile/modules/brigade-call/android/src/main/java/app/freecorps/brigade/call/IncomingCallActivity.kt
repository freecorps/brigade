package app.freecorps.brigade.call

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * The ringing screen: what the full-screen intent opens over the lock screen. Native, so it draws at once
 * while the React app may still be starting. Answer hands over to the React call screen.
 */
class IncomingCallActivity : Activity() {
  private var callId: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handle(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handle(intent)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun handle(intent: Intent) {
    val id = intent.getStringExtra(Calls.EXTRA_CALL_ID)
    val call = id?.let(Calls::get)
    if (call == null) return finish()
    callId = id
    current = WeakReference(this)
    if (intent.action == ACTION_ANSWER) {
      Calls.answer(this, id)
      return finish()
    }
    setContentView(layout(call))
  }

  private fun layout(call: IncomingCall): LinearLayout {
    val dp = resources.displayMetrics.density
    fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
      this.text = value
      textSize = size
      setTextColor(color)
      gravity = Gravity.CENTER
      if (bold) typeface = Typeface.DEFAULT_BOLD
    }
    fun button(label: String, color: Int, onClick: () -> Unit) = Button(this).apply {
      text = label
      textSize = 18f
      setTextColor(Color.WHITE)
      isAllCaps = false
      background = GradientDrawable().apply {
        cornerRadius = 32 * dp
        setColor(color)
      }
      setOnClickListener { onClick() }
      layoutParams = LinearLayout.LayoutParams(0, (64 * dp).toInt(), 1f).apply {
        marginStart = (8 * dp).toInt()
        marginEnd = (8 * dp).toInt()
      }
    }
    val id = call.id
    return LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.rgb(17, 17, 19))
      val pad = (24 * dp).toInt()
      setPadding(pad, (96 * dp).toInt(), pad, (64 * dp).toInt())
      addView(text(brigadeString("call_ringing"), 16f, Color.rgb(170, 170, 178)))
      addView(
        text(call.title, 28f, Color.WHITE, bold = true).apply { setPadding(0, (16 * dp).toInt(), 0, 0) },
        LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
      )
      addView(
        text(call.body, 16f, Color.rgb(210, 210, 216)).apply { setPadding(0, (12 * dp).toInt(), 0, 0) },
        LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f),
      )
      addView(
        LinearLayout(this@IncomingCallActivity).apply {
          orientation = LinearLayout.HORIZONTAL
          addView(button(brigadeString("call_decline"), Color.rgb(220, 38, 38)) { Calls.decline(context, id) })
          addView(button(brigadeString("call_answer"), Color.rgb(22, 163, 74)) {
            Calls.answer(context, id)
            finish()
          })
        },
        LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
      )
    }
  }

  companion object {
    const val ACTION_RING = "app.freecorps.brigade.call.RING"
    const val ACTION_ANSWER = "app.freecorps.brigade.call.ANSWER"
    private var current: WeakReference<IncomingCallActivity>? = null

    /** Closes the ringing screen when its call ends elsewhere (declined from the notification, timed out). */
    fun finishFor(id: String) {
      val activity = current?.get() ?: return
      if (activity.callId == id) activity.finish()
    }
  }
}

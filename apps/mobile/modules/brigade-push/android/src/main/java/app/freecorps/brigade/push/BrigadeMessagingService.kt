package app.freecorps.brigade.push

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Receives FCM messages (RFC 0006). Brigade's own (a data message from the relay: `enc` and `ct`) are opened and shown
 * here, in native code, so a page shows with the app killed and before JavaScript loads, like the iOS Notification
 * Service Extension. Anything else, and every new token, goes on to expo-notifications, so
 * `Notifications.addPushTokenListener` still hears a refreshed token and the app registers it again. Declared with a
 * higher priority than expo-notifications' own service (the manifest), which is how FCM picks this one.
 */
class BrigadeMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (!PushMessage.isBrigade(data)) return super.onMessageReceived(remoteMessage)
    Pages.handle(applicationContext, data)
  }
}

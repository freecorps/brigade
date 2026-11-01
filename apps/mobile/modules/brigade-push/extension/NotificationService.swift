// The Notification Service Extension (spike S1, RFC 0006). APNs delivers `{ aps: { alert: <localized fallback>,
// mutable-content: 1 }, brigade: <envelope> }`; this decrypts the envelope with the device key and shows its title
// and body, with the Acknowledge action when it names an incident and its workspace (BrigadePage). If anything
// fails it shows the fallback, never nothing, and without the action: there is nothing to acknowledge by. Both are
// copies of the delivered content, so they keep its sound and interruption level as APNs set them: a SEV1 page sent
// as a Critical Alert (RFC 0006 "Critical Alerts") stays critical, decrypted or not. A version 2 envelope (RFC 0015
// section 4) also seals its urgency, which then sets the level (`applyUrgency`); one expired, sealed for another
// origin than its key's, from an instance this phone is not paired with, or naming a key it does not have is the
// fallback too.
import os
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private let log = Logger(subsystem: "app.freecorps.brigade.NotificationService", category: "push")
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let fallback = Self.fallbackContent(for: request.content)
    self.fallback = fallback

    do {
      let decrypted = try BrigadePushCrypto.open(envelope: request.content.userInfo["brigade"])
      guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
        return deliver(fallback)
      }
      content.title = decrypted.title
      content.body = decrypted.body
      if let sealed = decrypted.sealed { Self.applyUrgency(sealed.urgency, to: content) }
      BrigadePage.mark(
        content, incident: decrypted.incident, workspace: decrypted.workspace, origin: decrypted.sealed?.origin)
      log.info("push decrypted")
      // Started before the page shows and never waited on: the page is what matters (RFC 0006 "Delivery receipts").
      if let receipt = decrypted.receiptToSend {
        Self.sendReceipt(receipt, log: log)
      } else if decrypted.receipt != nil {
        log.error("receipt not sent: not the paired instance")
      }
      deliver(content)
    } catch {
      // The error names the step (no key, malformed envelope, AEAD failure), never content.
      log.error("push not decrypted: \(String(describing: error), privacy: .public)")
      deliver(fallback)
    }
  }

  /// A version 2 page's interruption level and sound come from its sealed urgency, as the relay would set them
  /// (apps/relay `apnsPayload`), not from the clear `aps` the relay wrote: a page is time-sensitive, anything less
  /// `active` with the default sound. A Critical Alert stays critical only on a sealed page, so the relay can no
  /// longer raise a low push to one. Never quieter than a page asks for, never louder than it says.
  static func applyUrgency(_ urgency: String, to content: UNMutableNotificationContent) {
    if urgency == "page" {
      if content.interruptionLevel != .critical { content.interruptionLevel = .timeSensitive }
      if content.sound == nil { content.sound = .default }
    } else {
      content.interruptionLevel = .active
      content.sound = .default
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let fallback { deliver(fallback) }
  }

  private func deliver(_ content: UNNotificationContent) {
    contentHandler?(content)
    contentHandler = nil
  }

  /// "New alert / Open Brigade to see it", in the device language, from this extension's Localizable.strings
  /// (generated from packages/i18n). Set explicitly rather than trusting the payload's `loc-key`.
  private static func fallbackContent(for original: UNNotificationContent) -> UNNotificationContent {
    guard let content = original.mutableCopy() as? UNMutableNotificationContent else { return original }
    content.title = NSLocalizedString("push_fallback_title", comment: "")
    content.body = NSLocalizedString("push_fallback_body", comment: "")
    return content
  }
}

// MARK: - Delivery receipts

extension NotificationService {
  /// How long a receipt may take. The extension has about 30 seconds in all, and the page is already on screen.
  static let receiptTimeout: TimeInterval = 5

  /// Tells the server this phone opened the page: `POST <url>` with `{ "token": … }`, only when `<url>` is on the
  /// instance the app registered with; the token sealed in the page for this device alone, so no session is needed or sent. Fire and forget: no retry, no cookies, no cache, and a
  /// failure is only logged (the page is shown either way). The token is never logged.
  static func sendReceipt(_ receipt: BrigadePushCrypto.Receipt, log: Logger) {
    // Only to the paired instance (`Content.receiptToSend`): a page naming any other origin gets no receipt.
    guard let body = try? JSONSerialization.data(withJSONObject: ["token": receipt.token]) else { return }
    var request = URLRequest(url: receipt.url, timeoutInterval: receiptTimeout)
    request.httpMethod = "POST"
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = receiptTimeout
    configuration.timeoutIntervalForResource = receiptTimeout
    configuration.waitsForConnectivity = false
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration)
    session.dataTask(with: request) { _, response, error in
      if let error {
        log.error("receipt not sent: \(String(describing: error), privacy: .public)")
      } else if let status = (response as? HTTPURLResponse)?.statusCode {
        log.info("receipt answered \(status, privacy: .public)")
      }
    }.resume()
    // The running task keeps the session alive; it goes once the task ends.
    session.finishTasksAndInvalidate()
  }
}

// Keeps the app running while JavaScript acknowledges from a notification (RFC 0004 "Clients"). Acknowledge is a
// background action: iOS launches or resumes the app without showing it, and expo-notifications hands the tap to
// JavaScript but tells iOS it is done at once (on a cold launch, before JavaScript has even loaded), after which the
// app may be suspended mid-request. So this sees the tap first, through expo-notifications' delegate list, and holds
// a background task until apps/mobile/src/lib/page-action.ts says it finished (`finishPageAction`) or iOS takes the
// time back (about 30 seconds).
import ExpoNotifications
import UIKit
import UserNotifications
import os

final class PageActions: NotificationDelegate, Sendable {
  static let shared = PageActions()

  private let log = Logger(subsystem: "app.freecorps.brigade", category: "page-action")
  /// Background tasks by notification request id. `UIApplication` is the main actor's, so they are too.
  @MainActor private var tasks: [String: UIBackgroundTaskIdentifier] = [:]

  /// Registered at launch (BrigadePushAppDelegate), before iOS delivers the tap that launched the app.
  func start() {
    NotificationCenterManager.shared.addDelegate(self)
  }

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    let request = response.notification.request
    guard
      response.actionIdentifier == BrigadePage.ackAction,
      request.content.categoryIdentifier == BrigadePage.category
    else { return false }
    // Synchronously: expo-notifications tells iOS the tap is handled as soon as this returns.
    Self.onMain { self.begin(request.identifier) }
    log.info("ack action received")
    // Not handled: expo-notifications still delivers the tap to JavaScript (or keeps it until JavaScript loads).
    return false
  }

  /// JavaScript finished with the ack for `id` (or gave up): the app may be suspended again. Called on the
  /// JavaScript thread.
  func finish(_ id: String) {
    Task { @MainActor in self.end(id) }
  }

  @MainActor private func begin(_ id: String) {
    let task = UIApplication.shared.beginBackgroundTask(withName: "brigade.ack") {
      // On the main thread, and the task has to end before this returns.
      MainActor.assumeIsolated {
        self.log.error("ack ran out of background time")
        self.end(id)
      }
    }
    if task == .invalid {
      log.error("no background time for the ack")
    } else if let replaced = tasks.updateValue(task, forKey: id) {
      UIApplication.shared.endBackgroundTask(replaced)
    }
  }

  @MainActor private func end(_ id: String) {
    guard let task = tasks.removeValue(forKey: id) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }

  /// Runs `body` on the main actor before returning. iOS calls notification delegates on the main thread, but
  /// nothing promises it, and a trap here would lose the tap.
  private static func onMain(_ body: @MainActor () -> Void) {
    if Thread.isMainThread {
      MainActor.assumeIsolated(body)
    } else {
      DispatchQueue.main.sync(execute: body)
    }
  }
}

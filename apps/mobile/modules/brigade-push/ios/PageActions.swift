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

final class PageActions: NotificationDelegate, @unchecked Sendable {
  static let shared = PageActions()

  private let log = Logger(subsystem: "app.freecorps.brigade", category: "page-action")
  /// Background tasks by notification request id. Delegate calls and the module's function arrive on different
  /// threads.
  private let tasks = OSAllocatedUnfairLock<[String: UIBackgroundTaskIdentifier]>(initialState: [:])

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
    let id = request.identifier
    let task = UIApplication.shared.beginBackgroundTask(withName: "brigade.ack") { [weak self] in
      self?.log.error("ack ran out of background time")
      self?.finish(id)
    }
    if task == .invalid {
      log.error("no background time for the ack")
    } else {
      let replaced = tasks.withLock { tasks in
        defer { tasks[id] = task }
        return tasks[id]
      }
      if let replaced { UIApplication.shared.endBackgroundTask(replaced) }
    }
    log.info("ack action received")
    // Not handled: expo-notifications still delivers the tap to JavaScript (or keeps it until JavaScript loads).
    return false
  }

  /// JavaScript finished with the ack for `id` (or gave up): the app may be suspended again.
  func finish(_ id: String) {
    guard let task = tasks.withLock({ $0.removeValue(forKey: id) }) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }
}

// A page notification's Acknowledge action (RFC 0004 "Clients", RFC 0006): the category and the ids the app's
// handler reads. The Notification Service Extension compiles this file too (plugins/notification-service.ts), and
// the BrigadeCall pod marks the page it posts when CallKit refuses a call. The names must match
// apps/mobile/src/lib/page-action.ts, which registers the category and handles the action.
import UserNotifications

public enum BrigadePage {
  /// `PAGE_CATEGORY`: the category whose Acknowledge action the app registers at launch.
  public static let category = "brigade_page"
  /// `ACK_ACTION`.
  public static let ackAction = "ack"
  /// `PAGE_DATA_KEY`: the user info key holding `{ incident, workspace, origin? }`.
  public static let dataKey = "page"

  /// Offers the Acknowledge action on `content` when the page names its incident and the incident's workspace. A
  /// page without them (the fallback text, an instance from before the workspace was sealed) shows no action.
  /// `origin`: the instance a version 2 page sealed (RFC 0015 section 4); the app sends the ack only there.
  public static func mark(
    _ content: UNMutableNotificationContent, incident: String?, workspace: String?, origin: String? = nil
  ) {
    guard let incident, let workspace else { return }
    content.categoryIdentifier = category
    var userInfo = content.userInfo
    var page = ["incident": incident, "workspace": workspace]
    if let origin { page["origin"] = origin }
    userInfo[dataKey] = page
    content.userInfo = userInfo
  }
}

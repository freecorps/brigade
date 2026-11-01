import ExpoModulesCore
import WidgetKit

/// Keeps the "I'm on call" widget's snapshot (src/lib/widget.ts) in the App Group's shared defaults, where the widget
/// extension reads it, and reloads the widget's timelines. Only the snapshot (times, a locale, a count) goes there:
/// no names, tokens or credentials.
public class BrigadeWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrigadeWidget")

    /// Keeps `json` (a version 1 snapshot) and the app's locale; true when the App Group could be opened.
    Function("setSnapshot") { (json: String, locale: String) -> Bool in
      guard let defaults = WidgetStore.defaults else { return false }
      defaults.set(json, forKey: WidgetStore.snapshotKey)
      defaults.set(locale, forKey: WidgetStore.localeKey)
      WidgetCenter.shared.reloadAllTimelines()
      return true
    }

    /// Signing out: forgets the snapshot, so the widget says "Sign in to Brigade". The locale stays, for that line.
    Function("clear") { () -> Void in
      WidgetStore.defaults?.removeObject(forKey: WidgetStore.snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}

/// The App Group keys; the widget's copy is in ../widget/WidgetState.swift.
enum WidgetStore {
  /// `group.<bundle id>`, from the app's Info.plist (plugins/notification-service.ts); the store app's group without
  /// it.
  static let appGroup =
    Bundle.main.object(forInfoDictionaryKey: "BrigadeAppGroup") as? String ?? "group.app.freecorps.brigade"
  static let snapshotKey = "widget.snapshot"
  static let localeKey = "widget.locale"
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

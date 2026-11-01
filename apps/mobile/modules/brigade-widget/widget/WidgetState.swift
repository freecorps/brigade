// The "I'm on call" widget's data and decisions: the snapshot the app keeps in the App Group (src/lib/widget.ts,
// written by modules/brigade-widget/ios/BrigadeWidgetModule.swift) and what it says at a given instant. A copy of
// `widgetState` and `widgetTimeline` there, which are tested in CI; the two must agree. No network, no credentials:
// only times walked with the clock.
import Foundation

/// The App Group keys, as the app's module writes them.
enum WidgetStore {
  /// `group.<bundle id>`, from the widget's Info.plist (plugins/widget.ts); the store app's group without it.
  static let appGroup =
    Bundle.main.object(forInfoDictionaryKey: "BrigadeAppGroup") as? String ?? "group.app.freecorps.brigade"
  static let snapshotKey = "widget.snapshot"
  static let localeKey = "widget.locale"

  static func read() -> (snapshot: WidgetSnapshot?, locale: String?) {
    let defaults = UserDefaults(suiteName: appGroup)
    let locale = defaults?.string(forKey: localeKey)
    guard let json = defaults?.string(forKey: snapshotKey), let data = json.data(using: .utf8) else {
      return (nil, locale)
    }
    return (WidgetSnapshot.decode(data), locale)
  }
}

/// Version 1 of the snapshot. Times are ms since the epoch in JSON, `Date`s here.
struct WidgetSnapshot: Equatable {
  struct Shift: Equatable {
    let start: Date
    /// Nil: no handoff ends it within the app's look-ahead.
    let end: Date?
  }

  let writtenAt: Date
  let staleAt: Date
  let locale: String
  let schedules: Bool
  let shifts: [Shift]
  let openIncidents: Int?
  /// The open workspace's name; nil in snapshots from before it.
  let workspace: String?
  /// The member's other workspaces on this phone, their shifts as last seen there, each until its own `staleAt`.
  let others: [Other]

  struct Other: Equatable {
    let name: String
    let shifts: [Shift]
    let staleAt: Date
  }

  private struct Raw: Decodable {
    let v: Int
    let writtenAt: Double
    let staleAt: Double
    let locale: String
    let schedules: Bool
    let shifts: [[Double?]]
    let openIncidents: Int?
    let workspace: String?
    let others: [RawOther]?
  }

  private struct RawOther: Decodable {
    let name: String
    let shifts: [[Double?]]
    let staleAt: Double
  }

  private static func shifts(_ pairs: [[Double?]]) -> [Shift]? {
    var shifts: [Shift] = []
    for pair in pairs {
      guard pair.count == 2, let start = pair[0] else { return nil }
      shifts.append(Shift(start: date(start), end: pair[1].map(date)))
    }
    return shifts
  }

  /// Nil for anything but a well-formed version 1 snapshot: the widget then asks to open the app.
  static func decode(_ data: Data) -> WidgetSnapshot? {
    guard let raw = try? JSONDecoder().decode(Raw.self, from: data), raw.v == 1,
      let own = shifts(raw.shifts)
    else { return nil }
    // An other workspace that does not read is left out, never the whole snapshot.
    let others = (raw.others ?? []).compactMap { other in
      shifts(other.shifts).map { Other(name: other.name, shifts: $0, staleAt: date(other.staleAt)) }
    }
    return WidgetSnapshot(
      writtenAt: date(raw.writtenAt),
      staleAt: date(raw.staleAt),
      locale: raw.locale,
      schedules: raw.schedules,
      shifts: own,
      openIncidents: raw.openIncidents,
      workspace: raw.workspace,
      others: others
    )
  }

  private static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
}

enum WidgetState: Equatable {
  case signedOut
  case stale
  case noSchedules
  case on(until: Date?)
  /// Off call (or no schedules) in the open workspace, on call in `workspace`, another this phone pages them for.
  case onElsewhere(workspace: String, until: Date?)
  case off(next: Date?)

  /// What the widget shows at `date` (`widgetState` in src/lib/widget.ts).
  init(_ snapshot: WidgetSnapshot?, at date: Date) {
    guard let snapshot else {
      self = .signedOut
      return
    }
    if date >= snapshot.staleAt {
      self = .stale
      return
    }
    let here = WidgetState.own(snapshot, at: date)
    if case .on = here {
      self = here
      return
    }
    for other in snapshot.others where date < other.staleAt {
      if let current = WidgetState.shift(other.shifts, at: date) {
        self = .onElsewhere(workspace: other.name, until: current.end)
        return
      }
    }
    self = here
  }

  private static func own(_ snapshot: WidgetSnapshot, at date: Date) -> WidgetState {
    if !snapshot.schedules { return .noSchedules }
    if let current = shift(snapshot.shifts, at: date) { return .on(until: current.end) }
    return .off(next: snapshot.shifts.first(where: { $0.start > date })?.start)
  }

  /// The shift under way at `date`, if any.
  private static func shift(_ shifts: [WidgetSnapshot.Shift], at date: Date) -> WidgetSnapshot.Shift? {
    shifts.first { $0.start <= date && ($0.end.map { date < $0 } ?? true) }
  }

  /// Whether the snapshot's numbers still hold (its open incidents count is only shown then).
  var isCurrent: Bool {
    switch self {
    case .signedOut, .stale: false
    case .noSchedules, .on, .onElsewhere, .off: true
    }
  }
}

/// The instants the timeline needs an entry at (`widgetTimeline` in src/lib/widget.ts): `from`, every handoff before
/// the snapshot goes stale, and the moment it does.
func widgetTimeline(_ snapshot: WidgetSnapshot, from: Date) -> [Date] {
  var times: Set<Date> = [from]
  func add(_ at: Date?, until: Date) {
    if let at, at > from, at < min(until, snapshot.staleAt) { times.insert(at) }
  }
  for shift in snapshot.shifts {
    add(shift.start, until: snapshot.staleAt)
    add(shift.end, until: snapshot.staleAt)
  }
  for other in snapshot.others {
    for shift in other.shifts {
      add(shift.start, until: other.staleAt)
      add(shift.end, until: other.staleAt)
    }
    add(other.staleAt, until: .distantFuture)
  }
  if snapshot.staleAt > from { times.insert(snapshot.staleAt) }
  return times.sorted()
}

/// The widget's strings, from its own `<locale>.lproj/Localizable.strings` (generated from packages/i18n by
/// plugins/widget.ts) in the app's language when the app said which, else the system's.
struct WidgetStrings {
  let bundle: Bundle
  let locale: Locale

  init(locale identifier: String?) {
    if let identifier,
      let path = Bundle.main.path(forResource: identifier, ofType: "lproj"),
      let bundle = Bundle(path: path)
    {
      self.bundle = bundle
      self.locale = Locale(identifier: identifier)
    } else {
      self.bundle = .main
      self.locale = .current
    }
  }

  func callAsFunction(_ key: String) -> String {
    bundle.localizedString(forKey: key, value: nil, table: nil)
  }

  /// `key`'s text with `{time}` (`%@` in the strings file) filled in.
  func callAsFunction(_ key: String, time: String) -> String {
    String(format: self(key), locale: locale, time)
  }

  /// `key`'s text with `{name}` (`%@` in the strings file) filled in.
  func callAsFunction(_ key: String, name: String) -> String {
    String(format: self(key), locale: locale, name)
  }

  /// A time on the phone's clock, as short as still clear (`statusTime` in src/lib/oncall.ts): "9:00 AM" on the day,
  /// "Tue, 9:00 AM" within the week, "Nov 3, 9:00 AM" beyond.
  func time(_ date: Date, now: Date) -> String {
    var calendar = Calendar.current
    calendar.locale = locale
    let time = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale))
    if calendar.isDate(date, inSameDayAs: now) { return time }
    let day =
      date.timeIntervalSince(now) < 6 * 24 * 60 * 60
      ? date.formatted(Date.FormatStyle().weekday(.abbreviated).locale(locale))
      : date.formatted(Date.FormatStyle().month(.abbreviated).day().locale(locale))
    return "\(day), \(time)"
  }
}

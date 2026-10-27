// The "I'm on call" widget (roadmap Phase 2): on the home screen (small) and the lock screen (rectangular, inline), whether
// the signed-in member is on call now and until when, or when their next shift is, and the open incidents. It reads the
// app's snapshot from the App Group (WidgetState.swift) and lays out one entry per handoff, so it flips on time without
// the app running; past the snapshot's staleness bound it asks to open Brigade. Tapping it opens the on-call screen.
import SwiftUI
import WidgetKit

struct OnCallEntry: TimelineEntry {
  let date: Date
  let state: WidgetState
  let openIncidents: Int?
  /// The open workspace's name, which the open incidents and "Not on call" are about.
  let workspace: String?
  let strings: WidgetStrings
}

struct OnCallProvider: TimelineProvider {
  func placeholder(in context: Context) -> OnCallEntry {
    let now = Date()
    return OnCallEntry(
      date: now,
      state: .on(until: now.addingTimeInterval(6 * 60 * 60)),
      openIncidents: 0,
      workspace: nil,
      strings: WidgetStrings(locale: nil)
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (OnCallEntry) -> Void) {
    completion(entries(from: Date()).first ?? placeholder(in: context))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<OnCallEntry>) -> Void) {
    // The last entry is the stale one (or signed out): nothing changes after it until the app writes a new
    // snapshot, which reloads the timeline.
    completion(Timeline(entries: entries(from: Date()), policy: .never))
  }

  private func entries(from now: Date) -> [OnCallEntry] {
    let stored = WidgetStore.read()
    let strings = WidgetStrings(locale: stored.snapshot?.locale ?? stored.locale)
    let times = stored.snapshot.map { widgetTimeline($0, from: now) } ?? [now]
    return times.map { date in
      OnCallEntry(
        date: date,
        state: WidgetState(stored.snapshot, at: date),
        openIncidents: stored.snapshot?.openIncidents,
        workspace: stored.snapshot?.workspace,
        strings: strings
      )
    }
  }
}

/// The two lines every size says: what (on call, not, or what to do) and when.
struct OnCallText {
  let title: String
  let detail: String?
  let on: Bool

  init(_ entry: OnCallEntry) {
    let s = entry.strings
    let time = { (date: Date) in s.time(date, now: entry.date) }
    switch entry.state {
    case .signedOut:
      self.init(title: s("widget_signed_out"), detail: nil, on: false)
    case .stale:
      self.init(title: s("widget_stale"), detail: nil, on: false)
    case .noSchedules:
      self.init(title: s("widget_no_schedules"), detail: nil, on: false)
    case .on(let until):
      self.init(
        title: s("widget_on_call"), detail: until.map { s("widget_until", time: time($0)) }, on: true)
    case .onElsewhere(let workspace, let until):
      self.init(
        title: s("widget_on_call_in", name: workspace),
        detail: until.map { s("widget_until", time: time($0)) },
        on: true
      )
    case .off(let next):
      self.init(
        title: s("widget_off_call"),
        detail: next.map { s("widget_next", time: time($0)) } ?? s("widget_no_shift"),
        on: false
      )
    }
  }

  private init(title: String, detail: String?, on: Bool) {
    self.title = title
    self.detail = detail
    self.on = on
  }
}

struct OnCallWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: OnCallEntry

  var body: some View {
    let text = OnCallText(entry)
    Group {
      switch family {
      case .accessoryInline:
        Text([text.title, text.detail].compactMap { $0 }.joined(separator: " · "))
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 2) {
          Label(text.title, systemImage: text.on ? "bell.badge.fill" : "calendar")
            .font(.headline)
            .widgetAccentable()
          if let detail = text.detail {
            Text(detail).font(.subheadline).foregroundStyle(.secondary)
          }
          if let workspace = shownWorkspace {
            Text(workspace).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      default:
        small(text)
      }
    }
    .widgetURL(URL(string: "brigade://oncall"))
    .widgetBackground()
  }

  /// The open workspace's name: what "Not on call" and the open incidents are about.
  private var shownWorkspace: String? {
    entry.state.isCurrent ? entry.workspace : nil
  }

  private func small(_ text: OnCallText) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Image(systemName: text.on ? "bell.badge.fill" : "calendar")
        .font(.title3)
        .foregroundStyle(text.on ? Color.red : Color.secondary)
        .accessibilityHidden(true)
      Spacer(minLength: 0)
      Text(text.title)
        .font(.headline)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      if let detail = text.detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
      }
      if let workspace = shownWorkspace {
        Text(workspace)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      if entry.state.isCurrent, let count = entry.openIncidents {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(count, format: .number.locale(entry.strings.locale))
            .font(.caption.weight(.semibold))
            .monospacedDigit()
          Text(entry.strings("widget_open_incidents"))
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

extension View {
  /// iOS 17 asks widgets for a container background (it removes it where the system draws its own).
  @ViewBuilder
  func widgetBackground() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    } else {
      padding().background(Color(uiColor: .systemBackground))
    }
  }
}

struct OnCallWidget: Widget {
  var body: some WidgetConfiguration {
    let strings = WidgetStrings(locale: WidgetStore.read().locale)
    return StaticConfiguration(kind: "app.freecorps.brigade.oncall", provider: OnCallProvider()) { entry in
      OnCallWidgetView(entry: entry)
    }
    .configurationDisplayName(strings("widget_name"))
    .description(strings("widget_description"))
    .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct BrigadeWidgets: WidgetBundle {
  var body: some Widget {
    OnCallWidget()
  }
}

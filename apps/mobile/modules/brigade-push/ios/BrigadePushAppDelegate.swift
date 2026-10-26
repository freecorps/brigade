import ExpoModulesCore

/// Watches for the Acknowledge action from launch, so a tap that launches the app in the background keeps it
/// running until the ack is sent (PageActions).
public class BrigadePushAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PageActions.shared.start()
    return false
  }
}

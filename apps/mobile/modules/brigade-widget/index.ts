import { requireOptionalNativeModule } from "expo";

interface BrigadeWidgetModule {
  /**
   * Keeps the widget's snapshot (`JSON.stringify` of a `WidgetSnapshot`, src/lib/widget.ts) and the app's locale in
   * the App Group, and reloads the widget. False when the App Group could not be opened.
   */
  setSnapshot(json: string, locale: string): boolean;
  /** Forgets the snapshot (signing out): the widget then asks to sign in. */
  clear(): void;
}

/** iOS only (WidgetKit); null on Android and web, and in an app binary built before the widget. */
export const BrigadeWidget = requireOptionalNativeModule<BrigadeWidgetModule>("BrigadeWidget");

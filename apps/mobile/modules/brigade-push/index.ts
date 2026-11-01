import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** A page notification the member tapped (Android): the incident it is about and its workspace. */
export type OpenedPage = { incident: string; workspace: string };

type Events = {
  /** Android: a page's notification was tapped while the app was running. */
  onOpenPage(page: OpenedPage): void;
};

interface BrigadePushModule {
  /** The device public key (base64url, uncompressed P-256) that instances seal pushes to. Created on first call. */
  getPublicKey(): Promise<string>;
  /**
   * The device public key for the instance at `origin` (`https://brigade.example.com`): one key per instance (RFC
   * 0015 section 4), in the App Group Keychain on iOS and the Android Keystore. Created on first call; the key from
   * before keys per instance becomes the first origin's, so a phone in the field keeps its device id. Absent from an
   * app binary from before it (`devicePublicKey` falls back to `getPublicKey`).
   */
  getInstancePublicKey?(origin: string): Promise<string>;
  /**
   * Done with the Acknowledge action on notification `id` (its request identifier): the app may be suspended
   * again. Native code held background time for it from the tap (modules/brigade-push/ios/PageActions.swift). A no-op
   * on Android.
   */
  finishPageAction(id: string): void;
  /**
   * Keeps the instance's origin (`https://brigade.example.com`) where the code that opens pages reads it (the iOS
   * App Group, Android's preferences): it posts delivery receipts to that origin only. False for an origin it could
   * not read. Absent from an app binary built before receipts.
   */
  setReceiptOrigin?(origin: string): boolean;
  /** Whether pages can be opened on this OS (HPKE needs iOS 17; every supported Android version). */
  readonly canDecrypt: boolean;
  /**
   * Android: whether the build has a Firebase project (`google-services.json`, app.config.ts), so FCM has a token to
   * give. Absent on iOS.
   */
  readonly fcmAvailable?: boolean;
  /** Android: the page whose notification launched the app, once. Absent on iOS. */
  takeOpenedPage?(): OpenedPage | null;
  addListener?<E extends keyof Events>(event: E, listener: Events[E]): EventSubscription;
}

/** iOS and Android; null on web. */
export const BrigadePush = requireOptionalNativeModule<BrigadePushModule>("BrigadePush");

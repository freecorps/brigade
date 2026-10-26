import { requireOptionalNativeModule } from "expo";

interface BrigadePushModule {
  /** The device public key (base64url, uncompressed P-256) that instances seal pushes to. Created on first call. */
  getPublicKey(): Promise<string>;
  /**
   * Done with the Acknowledge action on notification `id` (its request identifier): the app may be suspended
   * again. Native code held background time for it from the tap (modules/brigade-push/ios/PageActions.swift).
   */
  finishPageAction(id: string): void;
  /** Whether the Notification Service Extension can decrypt on this OS (HPKE needs iOS 17). */
  readonly canDecrypt: boolean;
}

/** iOS only for now (spike S1); null on Android and web. */
export const BrigadePush = requireOptionalNativeModule<BrigadePushModule>("BrigadePush");

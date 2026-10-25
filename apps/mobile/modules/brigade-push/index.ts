import { requireOptionalNativeModule } from "expo";

interface BrigadePushModule {
  /** The device public key (base64url, uncompressed P-256) that instances seal pushes to. Created on first call. */
  getPublicKey(): Promise<string>;
  /** Whether the Notification Service Extension can decrypt on this OS (HPKE needs iOS 17). */
  readonly canDecrypt: boolean;
}

/** iOS only for now (spike S1); null on Android and web. */
export const BrigadePush = requireOptionalNativeModule<BrigadePushModule>("BrigadePush");

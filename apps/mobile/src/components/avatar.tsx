import { AvatarView } from "@/components/avatar-view";

/**
 * A member at a row's leading edge (`AvatarView`). iOS hosts a row's edges as React Native views by itself; Android's
 * rows are Compose, so its version hosts the view (`avatar.android.tsx`).
 */
export function Avatar({ name }: { name: string | null }) {
  return <AvatarView name={name} />;
}

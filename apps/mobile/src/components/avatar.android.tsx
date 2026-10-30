import { RNHostView } from "@expo/ui";
import { AvatarView } from "@/components/avatar-view";

/** A member at a Compose row's leading edge: the React Native avatar, hosted. */
export function Avatar({ name }: { name: string | null }) {
  return (
    <RNHostView matchContents>
      <AvatarView name={name} />
    </RNHostView>
  );
}

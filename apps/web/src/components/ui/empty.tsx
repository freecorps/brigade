import { cn } from "cn";
import type * as React from "react";

// Brigade's one look for "nothing here yet": a muted box the width of the content it stands in for, so an empty
// list keeps its frame (and its place on the page) instead of collapsing into a line of loose text.
function Empty({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty"
      className={cn("rounded-md bg-muted p-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Empty };

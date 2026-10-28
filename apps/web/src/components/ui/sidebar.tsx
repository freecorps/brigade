import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";
import type * as React from "react";

// Restyled for Brigade and trimmed to what the dashboard uses (shadcn's base-nova sidebar): the parts, not the
// provider. The sidebar sits on the frame's ground (`bg-sidebar`) on wide screens and in the left sheet on phones,
// so it has no state of its own: no collapsed rail, no cookie, no shortcut. Rows are 44px touch targets on phones
// and 32px under a fine pointer, where the list has to fit a laptop screen; the current page is a neutral pill with
// its label unchanged, never a colour.

function Sidebar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar"
      className={cn("flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground", className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-header" className={cn("flex flex-col p-2", className)} {...props} />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex flex-col gap-0.5 border-t border-sidebar-border p-2", className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-group" className={cn("flex flex-col pt-4", className)} {...props} />
  );
}

/**
 * Sentence case and grey, never uppercase. Not a heading: the sidebar comes before the page, and its group names
 * would sit above the page's h1 in the outline. The group points at it with `aria-labelledby`.
 */
function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn("px-2 pb-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-px", className)} {...props} />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("relative", className)} {...props} />;
}

/**
 * A row: an icon, its label and an optional badge at the end. Renders a link through `render` (`<Link>`); the
 * current page sets `aria-current="page"`, which styles it, so the router's own active state drives it.
 */
function SidebarMenuButton({ className, render, ...props }: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "flex h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground/85 outline-none pointer-fine:h-8",
          "transition-colors duration-(--brigade-duration-fast) ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring",
          "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground",
          "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-sidebar-accent-foreground [&>span]:truncate",
          className,
        ),
      },
      props,
    ),
    state: { slot: "sidebar-menu-button" },
  });
}

/**
 * A count at the row's end, only on a queue that needs someone (incidents open now): a plain number in the row's
 * grey, so the sidebar stays quiet. The caller colours it when the count is urgent (a SEV1 is open).
 */
function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        "ml-auto shrink-0 text-xs font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
};

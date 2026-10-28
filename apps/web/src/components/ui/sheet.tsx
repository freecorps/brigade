import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";

// Restyled for Brigade and trimmed to what the dashboard uses (shadcn's base-nova sheet): a panel from the left
// edge, for the sidebar on phones. It slides in on the drawer curve and only fades under reduced motion (the travel
// token is 0 there). No close button of its own: the caller labels one in the reader's language.

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({ className, children, ...props }: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-(--brigade-duration-base) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col border-r bg-sidebar text-sm text-sidebar-foreground shadow-lg outline-none",
          "transition-[translate,opacity] duration-(--brigade-duration-slow) ease-(--brigade-ease-drawer) data-ending-style:translate-x-[calc(-100%*var(--brigade-motion-travel))] data-starting-style:translate-x-[calc(-100%*var(--brigade-motion-travel))] motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };

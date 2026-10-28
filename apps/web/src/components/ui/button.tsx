import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Restyled for Brigade (packages/ui README): focus is the opaque `ring-ring` (tested at 3:1 on every
// surface), destructive keeps a full fill on light and draws a tint with red text on dark. Every size is
// a 44px touch target (h-11, off the spacing scale on purpose) on touch screens and 36px under a fine
// pointer, where a laptop screen has to hold the form. Filled and outline buttons are raised: a 1px edge,
// a highlight along the top and a short shadow below (`shadow-raised`, styles.css), so they read as keys
// standing off the sheet; ghost and link stay flat. Press feedback scales to the press-scale motion token,
// which is 1 under reduced motion, so only the colour changes there.
// Disabled covers both the native attribute and Base UI's `data-disabled` (`focusableWhenDisabled`
// keeps the button focusable, so it is not natively disabled); a disabled button never scales. It turns
// muted rather than translucent, so a focused disabled button keeps its opaque ring.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[transform,background-color,color,border-color,box-shadow] duration-(--brigade-duration-fast) ease-out focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:not-data-disabled:scale-(--brigade-motion-press-scale) disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:bg-none disabled:text-muted-foreground disabled:shadow-none data-disabled:pointer-events-none data-disabled:border-border data-disabled:bg-muted data-disabled:bg-none data-disabled:text-muted-foreground data-disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary bg-clip-border bg-linear-to-b from-white/14 to-transparent text-primary-foreground shadow-raised-primary hover:from-white/22 dark:from-white/24 dark:hover:from-white/32",
        // A key one step lighter than the card it sits on, with the same top sheen as the primary, so it reads as
        // the quiet sibling of the filled button rather than a hole in the sheet.
        outline:
          "bg-card bg-clip-border bg-linear-to-b from-white/60 to-transparent text-foreground shadow-raised hover:bg-secondary aria-expanded:bg-secondary dark:bg-secondary dark:from-white/6 dark:hover:bg-secondary dark:hover:from-white/11 dark:aria-expanded:from-white/11",
        secondary:
          "bg-secondary bg-clip-border bg-linear-to-b from-white/40 to-transparent text-secondary-foreground shadow-raised hover:bg-muted aria-expanded:bg-muted dark:from-white/6 dark:hover:bg-secondary dark:hover:from-white/11",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive bg-clip-border bg-linear-to-b from-white/12 to-transparent text-white shadow-raised-destructive hover:bg-destructive/95 dark:bg-destructive/15 dark:bg-none dark:text-destructive dark:shadow-none dark:hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 pointer-fine:h-9 pointer-fine:px-3",
        icon: "size-11 pointer-fine:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

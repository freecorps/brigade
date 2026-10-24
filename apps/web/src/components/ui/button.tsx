import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Restyled for Brigade (packages/ui README): focus is the opaque `ring-ring` (tested at 3:1 on every
// surface), destructive keeps a full fill on light and draws a tint with red text on dark, and every
// size is a 44px touch target (h-11, off the spacing scale on purpose). Press feedback scales to the
// press-scale motion token, which is 1 under reduced motion, so only the colour changes there.
// Disabled covers both the native attribute and Base UI's `data-disabled` (`focusableWhenDisabled`
// keeps the button focusable, so it is not natively disabled); a disabled button never scales. It turns
// muted rather than translucent, so a focused disabled button keeps its opaque ring.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[transform,background-color,color,border-color] duration-(--brigade-duration-fast) ease-out focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:not-data-disabled:scale-(--brigade-motion-press-scale) disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-muted-foreground data-disabled:pointer-events-none data-disabled:border-border data-disabled:bg-muted data-disabled:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted aria-expanded:bg-muted",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive text-white hover:bg-destructive/95 dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4",
        icon: "size-11",
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

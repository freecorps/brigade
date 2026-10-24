import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Restyled for Brigade: the severity and status pairs come from packages/ui (tested for AA in both
// themes; SEV1 is the only solid fill). A badge never shrinks or wraps (it is a label, not prose).
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent px-2 text-xs font-medium whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        destructive: "bg-destructive text-white dark:bg-destructive/15 dark:text-destructive",
        sev1: "bg-sev1 text-sev1-foreground",
        sev2: "bg-sev2 text-sev2-foreground",
        sev3: "bg-sev3 text-sev3-foreground",
        sev4: "bg-sev4 text-sev4-foreground",
        triage: "bg-status-triage text-status-triage-foreground",
        investigating: "bg-status-investigating text-status-investigating-foreground",
        fixing: "bg-status-fixing text-status-fixing-foreground",
        monitoring: "bg-status-monitoring text-status-monitoring-foreground",
        resolved: "bg-status-resolved text-status-resolved-foreground",
        declined: "bg-status-declined text-status-declined-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };

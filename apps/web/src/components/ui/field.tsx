import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import { useId, type ComponentProps, type Ref } from "react";

// A labelled text input in the dashboard's form style (the declare form's input): label above, hint and error
// below, error tied to the input with aria-describedby. 16px text, so iOS does not zoom into it.
export function Field({
  label,
  hint,
  error,
  className,
  ref,
  ...input
}: Omit<ComponentProps<"input">, "id" | "ref"> & {
  label: string;
  hint?: string;
  /** Shown under the input, announced, and marks it invalid. */
  error?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [error ? errorId : undefined, hint ? hintId : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
        {...input}
      />
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A form-level failure (the server refused, the network is down), announced when it appears, and settling in. */
export function FormError({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="enter flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

import { cn } from "cn";
import { useId } from "react";

/**
 * A choice of two to four views (all or mine, a period): native radios drawn on a field's inset track, the height of
 * the inputs, with the chosen one raised on it. As wide as its options, never stretched across a card.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** The group's accessible name. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("field inline-grid auto-cols-fr grid-flow-col gap-0.5 p-0.5", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex h-full cursor-pointer items-center justify-center rounded-sm px-3 text-sm whitespace-nowrap select-none",
              "transition-[color,background-color,box-shadow] duration-(--brigade-duration-fast) ease-out",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring",
              selected
                ? "bg-card font-medium text-foreground shadow-raised dark:bg-secondary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

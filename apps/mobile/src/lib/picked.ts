// A setting switched on this phone shows as picked until the synced row agrees with it, as the dashboard's cards do:
// clearing it when the mutation answers would show the old row for a moment, and a second quick switch could start
// from it and undo the first.

/** Whether the synced `value` caught up with what was `picked` (every key `picked` has). */
export function caughtUp<T extends object>(picked: T, value: T): boolean {
  return (Object.keys(picked) as (keyof T)[]).every((key) => picked[key] === value[key]);
}

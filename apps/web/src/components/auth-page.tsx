import type { ReactNode } from "react";

/**
 * The frame of the sign-in, sign-up and create-workspace screens: one narrow column, a heading and a short line of
 * context, the form, then whatever leads elsewhere. The column sits in the middle of the page; its text is
 * left-aligned, like the rest of the dashboard.
 */
export function AuthPage({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-8 sm:py-16">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold text-balance">{title}</h1>
        {description ? (
          <p className="text-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
      {footer ? <p className="text-sm text-muted-foreground">{footer}</p> : null}
    </div>
  );
}

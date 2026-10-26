import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { checkStack, type StackReport } from "@/lib/stack";

interface StackStatus {
  /** The last finished check; kept on screen while a new one runs. */
  report: StackReport | undefined;
  checking: boolean;
  recheck: () => void;
}

const StackStatusContext = createContext<StackStatus | null>(null);

export function useStackStatus(): StackStatus {
  const status = use(StackStatusContext);
  if (!status) throw new Error("useStackStatus needs a <StackStatusProvider>");
  return status;
}

/**
 * Runs the stack check for the member's workspace once on mount and again on demand. Switching language
 * re-renders the result in place (the dashboard route is not remounted), so it does not check again.
 */
export function StackStatusProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  // Tagged with its workspace, so switching workspaces never shows the previous one's result while the new check runs.
  const [last, setLast] = useState<{ workspaceId: string; report: StackReport }>();
  const [run, setRun] = useState(0);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Aborted on cleanup: unmounting (or StrictMode's second run in dev) cancels the requests in
    // flight, and their results are dropped.
    const controller = new AbortController();
    setChecking(true);
    void checkStack(workspaceId, fetch, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setLast({ workspaceId, report: next });
      setChecking(false);
    });
    return () => controller.abort();
  }, [run, workspaceId]);

  const report = last?.workspaceId === workspaceId ? last.report : undefined;
  const recheck = useCallback(() => setRun((count) => count + 1), []);
  const value = useMemo(() => ({ report, checking, recheck }), [report, checking, recheck]);
  return <StackStatusContext value={value}>{children}</StackStatusContext>;
}

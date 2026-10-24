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
 * Runs the stack check once on load and again on demand. It sits above the locale-keyed part of the
 * tree, so switching language re-renders the result instead of checking again.
 */
export function StackStatusProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<StackReport>();
  const [run, setRun] = useState(0);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let current = true;
    setChecking(true);
    void checkStack().then((next) => {
      if (!current) return;
      setReport(next);
      setChecking(false);
    });
    return () => {
      current = false;
    };
  }, [run]);

  const recheck = useCallback(() => setRun((count) => count + 1), []);
  const value = useMemo(() => ({ report, checking, recheck }), [report, checking, recheck]);
  return <StackStatusContext value={value}>{children}</StackStatusContext>;
}

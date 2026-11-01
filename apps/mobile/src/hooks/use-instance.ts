// The instance the app shows (RFC 0015 section 5), provided by src/components/session.tsx: its Better Auth client,
// server URLs and stores (src/lib/instance-clients.ts).
import { createContext, use } from "react";
import type { InstanceClients } from "@/lib/instance-clients";

export const InstanceContext = createContext<InstanceClients | undefined>(undefined);

/** Undefined only in a build with no server at all (the session's `no-server`). */
export function useActiveInstance(): InstanceClients | undefined {
  return use(InstanceContext);
}

/** The instance the app shows, below a session that has one (the signed-in screens, sign-in and sign-up). */
export function useInstance(): InstanceClients {
  const clients = use(InstanceContext);
  if (!clients) throw new Error("useInstance needs an instance");
  return clients;
}

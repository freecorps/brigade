// Vitest global setup, run in Node: a TCP listener on a loopback port, one on the IPv6 loopback, and a port nothing
// listens on, for the real-socket tests of the TCP check (test/monitors.test.ts). The Worker's `connect()` reaches
// them through workerd's local network.
import { createServer, type Server } from "node:net";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  export interface ProvidedContext {
    tcpOpenPort: number;
    /** A listener on `::1`, or 0 when the machine has no IPv6 loopback. */
    tcpOpenPortV6: number;
    tcpClosedPort: number;
  }
}

const listen = (server: Server, host: string) =>
  new Promise<number>((resolve) => {
    // No IPv6 loopback (EADDRNOTAVAIL): 0, and the test that needs it is skipped.
    server.once("error", () => resolve(0));
    server.listen(0, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

const close = (server: Server) =>
  new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));

export default async function setup(project: TestProject) {
  const open = createServer((socket) => socket.end());
  const openV6 = createServer((socket) => socket.end());
  project.provide("tcpOpenPort", await listen(open, "127.0.0.1"));
  project.provide("tcpOpenPortV6", await listen(openV6, "::1"));
  // Port 1 (tcpmux): below 1024, so only root could listen there, and nothing does on a dev machine or a CI
  // runner. A port bound and closed again here could be taken by another process before the test connects.
  project.provide("tcpClosedPort", 1);
  return async () => {
    await Promise.all([close(open), close(openV6)]);
  };
}

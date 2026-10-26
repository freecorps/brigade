// Vitest global setup, run in Node: a TCP listener on a loopback port, and a port nothing listens on, for the
// real-socket test of the TCP check (test/monitors.test.ts). The Worker's `connect()` reaches them through
// workerd's local network.
import { createServer, type Server } from "node:net";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  export interface ProvidedContext {
    tcpOpenPort: number;
    tcpClosedPort: number;
  }
}

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

export default async function setup(project: TestProject) {
  const open = createServer((socket) => socket.end());
  project.provide("tcpOpenPort", await listen(open));
  // Port 1 (tcpmux): below 1024, so only root could listen there, and nothing does on a dev machine or a CI
  // runner. A port bound and closed again here could be taken by another process before the test connects.
  project.provide("tcpClosedPort", 1);
  return () => new Promise<void>((resolve) => open.close(() => resolve()));
}

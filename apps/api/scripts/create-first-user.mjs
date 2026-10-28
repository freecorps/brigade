#!/usr/bin/env node
// Creates the first owner of a new Brigade instance and their workspace (RFC 0002 "The first owner",
// apps/api/README.md "First owner"). Sign-up is closed by default, so this is how the first person gets in.
//
//   BOOTSTRAP_TOKEN=… node apps/api/scripts/create-first-user.mjs --url https://brigade.example.com
//     [--email owner@example.com] [--name "Ana Lima"] [--workspace "Acme"]
//
// `--url` is the dashboard's origin (BRIGADE_URL also works); the API answers under its `/api`. BOOTSTRAP_TOKEN is the
// same value as the API Worker's secret, read from the environment so it never lands in shell history. Without
// `--email` the owner is `owner@<the instance's host>`. The password is generated here, sent once over HTTPS, stored
// only as Better Auth's hash, and printed once: keep it in a password manager, then change it from the dashboard if
// you like. The API refuses once any user exists, so running this again does nothing.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const usage = `Usage: BOOTSTRAP_TOKEN=… node apps/api/scripts/create-first-user.mjs --url <dashboard origin>
  [--email <address>] [--name <name>] [--workspace <workspace name>]`;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      url: { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
      workspace: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (error) {
  fail(`${error.message}\n${usage}`);
}
if (values.help) {
  console.log(usage);
  process.exit(0);
}

const token = process.env.BOOTSTRAP_TOKEN?.trim();
if (!token) fail(`Set BOOTSTRAP_TOKEN to the API Worker's secret.\n${usage}`);

let origin;
try {
  origin = new URL(values.url ?? process.env.BRIGADE_URL ?? "");
} catch {
  fail(`Give the dashboard's origin with --url.\n${usage}`);
}
const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if (origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) {
  fail(
    "The URL must be HTTPS (plain HTTP only for localhost): the password travels in the request.",
  );
}

const email = (values.email ?? `owner@${origin.hostname}`).trim().toLowerCase();
const name = (values.name ?? "Owner").trim();
const workspace = (values.workspace ?? "Brigade").trim();
// 24 random bytes: 32 characters of base64url, within Better Auth's 8 to 128.
const password = randomBytes(24).toString("base64url");

let response;
try {
  response = await fetch(new URL("/api/setup/first-user", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, name, workspace, password }),
  });
} catch (error) {
  fail(`Could not reach ${origin.origin}: ${error.message}`);
}

const reasons = {
  400: "The email, name or workspace name was refused; check them.",
  401: "BOOTSTRAP_TOKEN does not match the API Worker's secret.",
  404: "The instance has no BOOTSTRAP_TOKEN secret set (or the URL is not the dashboard's).",
  409: "This instance already has a user: sign in instead, or ask an owner for an invitation.",
  503: "The API Worker's BOOTSTRAP_TOKEN is too short: set one of at least 32 characters.",
};
if (response.status !== 201) {
  fail(
    `Creating the first owner failed (${response.status}). ${reasons[response.status] ?? ""}`.trim(),
  );
}
const created = await response.json();

console.log(`First owner created on ${origin.origin}

  Email:     ${created.email}
  Password:  ${password}
  Workspace: ${workspace}

This password is shown only now. Save it in a password manager, then remove the BOOTSTRAP_TOKEN secret
(wrangler secret delete BOOTSTRAP_TOKEN). Invite your team from the dashboard.`);

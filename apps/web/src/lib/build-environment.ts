// Which deployment a dashboard build is (RFC 0002 "Environments"), for vite.config.ts to define as
// `import.meta.env.BRIGADE_ENV`: `vp dev` is local, and a build is the Wrangler environment it was built for
// (`CLOUDFLARE_ENV`, unset for production). Apart from src/lib/environment.ts, which reads the defined value, because
// the config loader runs this file and has no `import.meta.env`.

export type Environment = "local" | "dev" | "staging" | "production";

/** The environment a build is for: anything but `dev` or `staging` is production. */
export function buildEnvironment(command: "serve" | "build", cloudflareEnv?: string): Environment {
  if (command === "serve") return "local";
  return cloudflareEnv === "dev" || cloudflareEnv === "staging" ? cloudflareEnv : "production";
}

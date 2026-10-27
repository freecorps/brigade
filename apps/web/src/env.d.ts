interface ImportMetaEnv {
  /** Which deployment this build is (src/lib/build-environment.ts), defined in vite.config.ts. */
  readonly BRIGADE_ENV: import("./lib/build-environment.ts").Environment;
}

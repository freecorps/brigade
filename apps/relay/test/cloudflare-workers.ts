// What the tests use of `cloudflare:workers`, which exists only inside workerd (vite.config.ts aliases it here for
// `vp test`, which runs in Node). `DurableObject` keeps `ctx` and `env` like the real base class.
export class DurableObject<Env = unknown> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: Env,
  ) {}
}

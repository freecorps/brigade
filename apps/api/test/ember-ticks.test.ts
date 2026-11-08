// The Worker's lost-tick sweep (#192, src/ember-ticks.ts): every workspace on Ember has its shard sweep its ticks,
// and one that fails never stops the others.
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { newId } from "@freecorps/brigade-schema";
import { setWorkspaceEngine, workspaceShard } from "../src/ember.ts";
import { sweepEmberTicks } from "../src/ember-ticks.ts";

const workspace = () => newId("ws", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));

describe("the lost-tick sweep from the Cron Trigger", () => {
  test("asks each workspace on Ember, and only those, carrying on past a shard that fails", async () => {
    const [a, b, old] = [workspace(), workspace(), workspace()];
    await setWorkspaceEngine(env.DB, a, "ember", Date.now());
    await setWorkspaceEngine(env.DB, b, "ember", Date.now());
    await setWorkspaceEngine(env.DB, old, "brigade", Date.now());
    const asked: { shard: string; fn: string }[] = [];
    const SHARD = {
      getByName: (shard: string) => ({
        async mutation(name: string, fn: string, args: unknown, identity: null, internal: boolean) {
          asked.push({ shard: name, fn });
          if (name === workspaceShard(a)) throw new Error("shard reset");
          // The real shard: an empty one has nothing to sweep.
          return (
            env.SHARD.getByName(shard) as unknown as {
              mutation(...a: unknown[]): Promise<unknown>;
            }
          ).mutation(name, fn, args, identity, internal);
        },
      }),
    } as unknown as Env["SHARD"];
    await sweepEmberTicks({ DB: env.DB, SHARD });
    const shards = asked.map((call) => call.shard);
    expect(shards).toContain(workspaceShard(a));
    expect(shards).toContain(workspaceShard(b));
    expect(shards).not.toContain(workspaceShard(old));
    expect(new Set(asked.map((call) => call.fn))).toEqual(new Set(["ticks:sweep"]));
  });
});

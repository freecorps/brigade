import { RegistryDO, type RegistryNamespace, type RegistryStub } from "../src/registry.ts";

/**
 * The registry's namespace over real `RegistryDO`s, each with a Map for its storage. Like an RPC call, every call
 * yields once and copies its arguments and result; the methods are synchronous, so calls to one object never
 * interleave, as in workerd. `failing` makes every call throw, like an unreachable object.
 */
export function fakeRegistry() {
  const storage = new Map<string, Map<string, unknown>>();
  const objects = new Map<string, RegistryDO>();
  const alarms = new Map<string, number>();
  const object = (name: string): RegistryDO => {
    let found = objects.get(name);
    if (!found) {
      const data = registry.storage(name);
      const kv = {
        get: (key: string) => structuredClone(data.get(key)),
        put: (key: string, value: unknown) => void data.set(key, structuredClone(value)),
        delete: (key: string) => data.delete(key),
      };
      // Only `storage.kv`, the alarm and `deleteAll` are used by the class.
      const state = {
        storage: {
          kv,
          setAlarm: async (at: number) => {
            if (registry.failingAlarms === true || registry.failingAlarms === name) {
              throw new Error("alarm not set");
            }
            alarms.set(name, at);
          },
          deleteAll: async () => {
            data.clear();
            alarms.delete(name);
          },
        },
      };
      found = new RegistryDO(state as unknown as DurableObjectState, {} as Cloudflare.Env);
      objects.set(name, found);
    }
    return found;
  };
  const registry = {
    failing: false,
    /** `setAlarm` throws, as storage that cannot be written would: on every object, or on the one named. */
    failingAlarms: false as boolean | string,
    /** Methods that throw as an unreachable object would, while the others answer. */
    failingMethods: new Set<string>(),
    /** How many times each method was called, on any object. */
    calls: new Map<string, number>(),
    storage(name: string): Map<string, unknown> {
      let data = storage.get(name);
      if (!data) storage.set(name, (data = new Map()));
      return data;
    },
    /** When the object's alarm is set for, if it is. */
    alarmAt: (name: string) => alarms.get(name),
    /** Runs the object's alarm, as workerd would at its time. */
    async fireAlarm(name: string) {
      alarms.delete(name);
      await object(name).alarm();
    },
    getByName(name: string): RegistryStub {
      const target = object(name);
      const rpc = <K extends keyof RegistryStub>(name: K) =>
        (async (...args: unknown[]) => {
          await Promise.resolve();
          if (registry.failing || registry.failingMethods.has(name)) {
            throw new Error("Durable Object unreachable");
          }
          registry.calls.set(name, (registry.calls.get(name) ?? 0) + 1);
          // Awaited for the async methods, whose check-and-update runs before their first await.
          const result: unknown = await Reflect.apply(target[name], target, structuredClone(args));
          return structuredClone(result);
        }) as RegistryStub[K];
      return {
        record: rpc("record"),
        canRequestCode: rpc("canRequestCode"),
        requestCode: rpc("requestCode"),
        takeAddressSlot: rpc("takeAddressSlot"),
        releaseAddressSlot: rpc("releaseAddressSlot"),
        register: rpc("register"),
        changeKeys: rpc("changeKeys"),
      };
    },
  } satisfies RegistryNamespace & Record<string, unknown>;
  return registry;
}

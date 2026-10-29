import { describe, expect, it, vi } from "vite-plus/test";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { announceDeclare, onDeclare, type Declared } from "./declares";

const sent = (incidentId: string): Declared => ({
  incidentId,
  title: "Checkout is down",
  outcome: Promise.resolve({ ok: true } as MutationOutcome),
});

describe("declares", () => {
  it("hands a declare to every list listening", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onDeclare(first);
    const stopSecond = onDeclare(second);
    const declared = sent("inc_1");
    announceDeclare(declared);
    expect(first).toHaveBeenCalledWith(declared);
    expect(second).toHaveBeenCalledWith(declared);
    stopFirst();
    stopSecond();
  });

  it("keeps a declare sent with no list listening for the next one, once", () => {
    const declared = sent("inc_2");
    announceDeclare(declared);
    const late = vi.fn();
    const stop = onDeclare(late);
    expect(late).toHaveBeenCalledExactlyOnceWith(declared);
    stop();
    const later = vi.fn();
    onDeclare(later)();
    expect(later).not.toHaveBeenCalled();
  });

  it("stops handing declares to a list that stopped listening", () => {
    const listener = vi.fn();
    const keep = vi.fn();
    onDeclare(listener)();
    const stop = onDeclare(keep);
    announceDeclare(sent("inc_3"));
    expect(listener).not.toHaveBeenCalled();
    expect(keep).toHaveBeenCalledOnce();
    stop();
  });
});

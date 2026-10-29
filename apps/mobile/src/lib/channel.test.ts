import { describe, expect, it, vi } from "vite-plus/test";
import { channel } from "./channel";

const { send: announceDeclare, listen: onDeclare } = channel<{ incidentId: string }>();
const sent = (incidentId: string) => ({ incidentId });

describe("channel", () => {
  it("hands a message to every listener", () => {
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

  it("keeps a message sent with nobody listening for the next listener, once", () => {
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

  it("stops handing messages to a listener that stopped", () => {
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

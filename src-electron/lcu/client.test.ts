import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const sockets: EventEmitter[] = [];
vi.mock("ws", () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    send = vi.fn();
    terminate = vi.fn();
    constructor() {
      super();
      sockets.push(this);
    }
  },
}));
import { LcuClient } from "./client";

describe("LCU event connection", () => {
  it("contains socket errors, avoids duplicate connects, and ignores unrelated events", () => {
    const client = new LcuClient({ port: 54321, token: "test" });
    const onPhase = vi.fn();
    client.connectGameflowEvents(onPhase);
    const socket = sockets.at(-1)!;
    client.connectGameflowEvents(onPhase);
    expect(sockets).toHaveLength(1);
    expect(() => socket.emit("error", new Error("Disconnected"))).not.toThrow();
    socket.emit(
      "message",
      JSON.stringify([8, "event", { uri: "/other", data: "Lobby" }]),
    );
    socket.emit(
      "message",
      JSON.stringify([
        8,
        "event",
        { uri: "/lol-gameflow/v1/gameflow-phase", data: "ReadyCheck" },
      ]),
    );
    expect(onPhase.mock.calls).toEqual([["ReadyCheck"]]);
    client.close();
  });
});

import { describe, expect, it } from "vitest";
import { createDefaultAppConfig } from "../src-electron/config/appConfig";
import { toForm, validateForm } from "./settingsModel";

describe("settings validation", () => {
  const defaults = createDefaultAppConfig({}).settings;
  it("round-trips settings with subsecond precision", () => {
    const settings = { ...defaults, postGameDelayMinMs: 1234 };
    expect(validateForm(toForm(settings)).settings).toEqual(settings);
  });
  it("rejects timer overflow, submillisecond values, zero, and excessive polling", () => {
    const form = toForm(defaults);
    Object.assign(form, {
      pollIntervalMs: "0.001",
      cycleReconnectTimeoutMs: "9999999999",
      postGameDelayMinMs: "0.0001",
      homeResetCooldownMs: "0",
    });
    expect(Object.keys(validateForm(form).errors)).toHaveLength(4);
  });
  it("rejects unsafe queue IDs and reversed delay ranges", () => {
    const form = {
      ...toForm(defaults),
      queueId: "9007199254740993",
      postGameDelayMaxMs: "0.5",
    };
    expect(validateForm(form).errors).toMatchObject({
      queueId: "queueError",
      postGameDelayMaxMs: "delayError",
    });
  });
});

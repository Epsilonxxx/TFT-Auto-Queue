import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonConfigStore, createDefaultAppConfig, resolveConfigFilePath } from "./appConfig";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("JsonConfigStore", () => {
  it("creates a config file with defaults when none exists", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-config-"));
    tempDirs.push(tempDir);

    const filePath = resolveConfigFilePath(tempDir);
    const store = new JsonConfigStore(filePath, createDefaultAppConfig({ TFT_QUEUE_ID: "1220" }));

    expect(fs.existsSync(filePath)).toBe(true);
    expect(store.get().settings.queueId).toBe(1220);
    expect(store.get().settings.language).toBe("zh-CN");
    expect(store.get().settings.scheduledRestartHours).toBe(0);
    expect(store.get().stats.totalCycleCount).toBe(0);
  });

  it("persists updated stats across store instances", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-config-"));
    tempDirs.push(tempDir);

    const filePath = resolveConfigFilePath(tempDir);
    const store = new JsonConfigStore(filePath, createDefaultAppConfig());

    store.update((current) => ({
      ...current,
      stats: {
        totalCycleCount: 12,
        sessionCycleCount: 3
      }
    }));

    const reloadedStore = new JsonConfigStore(filePath, createDefaultAppConfig());
    expect(reloadedStore.get().stats).toEqual({
      totalCycleCount: 12,
      sessionCycleCount: 3
    });
  });

  it("persists language settings across store instances", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-config-"));
    tempDirs.push(tempDir);

    const filePath = resolveConfigFilePath(tempDir);
    const store = new JsonConfigStore(filePath, createDefaultAppConfig({ APP_LANGUAGE: "en-US" }));

    store.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        language: "zh-CN"
      }
    }));

    const reloadedStore = new JsonConfigStore(filePath, createDefaultAppConfig({ APP_LANGUAGE: "en-US" }));
    expect(reloadedStore.get().settings.language).toBe("zh-CN");
  });

  it("persists scheduled restart hours across store instances", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-config-"));
    tempDirs.push(tempDir);

    const filePath = resolveConfigFilePath(tempDir);
    const store = new JsonConfigStore(filePath, createDefaultAppConfig());

    store.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        scheduledRestartHours: 4
      }
    }));

    const reloadedStore = new JsonConfigStore(filePath, createDefaultAppConfig());
    expect(reloadedStore.get().settings.scheduledRestartHours).toBe(4);
  });
});

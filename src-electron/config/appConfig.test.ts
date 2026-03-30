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

  it("stores the optional League install path", () => {
    const defaults = createDefaultAppConfig({ LEAGUE_INSTALL_PATH: "E:\\Riot Games\\League of Legends" });
    expect(defaults.settings.leagueInstallPath).toBe("E:\\Riot Games\\League of Legends");
  });

  it("recovers from the backup file when the primary config becomes corrupted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-config-"));
    tempDirs.push(tempDir);

    const filePath = resolveConfigFilePath(tempDir);
    const store = new JsonConfigStore(filePath, createDefaultAppConfig());

    store.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        language: "en-US",
        queueId: 1220
      }
    }));

    fs.writeFileSync(filePath, "{not valid json", "utf8");

    const recoveredStore = new JsonConfigStore(filePath, createDefaultAppConfig());
    expect(recoveredStore.get().settings.language).toBe("en-US");
    expect(recoveredStore.get().settings.queueId).toBe(1220);
    expect(recoveredStore.consumeLoadWarning?.()).toContain("配置文件已损坏");

    const archivedCopies = fs
      .readdirSync(tempDir)
      .filter((name) => name.startsWith("tft-auto-queue.config.json.corrupt-"));
    expect(archivedCopies.length).toBe(1);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
  });
});

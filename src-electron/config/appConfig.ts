import fs from "node:fs";
import path from "node:path";

export type AppLanguage = "zh-CN" | "en-US";

export type AppSettings = {
  language: AppLanguage;
  queueId: number | null;
  autoCancelOnDisable: boolean;
  postGameDelayMinMs: number;
  postGameDelayMaxMs: number;
  queueRetryBlockMs: number;
  homeResetCooldownMs: number;
  reconnectCooldownMs: number;
  cycleReconnectTimeoutMs: number;
  pollIntervalMs: number;
};

export type AppStats = {
  totalCycleCount: number;
  sessionCycleCount: number;
};

export type PersistedAppConfig = {
  version: number;
  settings: AppSettings;
  stats: AppStats;
};

export interface AppConfigStore {
  get(): PersistedAppConfig;
  set(next: PersistedAppConfig): PersistedAppConfig;
  update(updater: (current: PersistedAppConfig) => PersistedAppConfig): PersistedAppConfig;
}

const CONFIG_VERSION = 1;

function readOptionalNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalPositive(raw: string | undefined, fallback: number): number {
  const parsed = readOptionalNumber(raw);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function cloneConfig(config: PersistedAppConfig): PersistedAppConfig {
  return {
    version: config.version,
    settings: { ...config.settings },
    stats: { ...config.stats }
  };
}

export function createDefaultAppConfig(env: NodeJS.ProcessEnv = process.env): PersistedAppConfig {
  const queueId = readOptionalNumber(env.TFT_QUEUE_ID);
  const postGameDelayMinMs = readOptionalPositive(env.POST_GAME_DELAY_MIN_MS, 1000);
  const postGameDelayMaxMs = readOptionalPositive(env.POST_GAME_DELAY_MAX_MS, 2000);

  return {
    version: CONFIG_VERSION,
    settings: {
      language: env.APP_LANGUAGE === "en-US" ? "en-US" : "zh-CN",
      queueId,
      autoCancelOnDisable: (env.AUTO_CANCEL_ON_DISABLE ?? "true").toLowerCase() === "true",
      postGameDelayMinMs: Math.min(postGameDelayMinMs, postGameDelayMaxMs),
      postGameDelayMaxMs: Math.max(postGameDelayMinMs, postGameDelayMaxMs),
      queueRetryBlockMs: readOptionalPositive(env.QUEUE_RETRY_BLOCK_MS, 3 * 60 * 1000),
      homeResetCooldownMs: readOptionalPositive(env.HOME_RESET_COOLDOWN_MS, 10 * 1000),
      reconnectCooldownMs: readOptionalPositive(env.RECONNECT_COOLDOWN_MS, 5000),
      cycleReconnectTimeoutMs: readOptionalPositive(env.CYCLE_RECONNECT_TIMEOUT_MS, 5 * 60 * 1000),
      pollIntervalMs: readOptionalPositive(env.POLL_INTERVAL_MS, 2500)
    },
    stats: {
      totalCycleCount: 0,
      sessionCycleCount: 0
    }
  };
}

export function normalizeAppConfig(
  raw: Partial<PersistedAppConfig> | undefined,
  defaults: PersistedAppConfig
): PersistedAppConfig {
  const safeRaw = raw ?? {};
  const settings: Partial<AppSettings> = safeRaw.settings ?? {};
  const stats: Partial<AppStats> = safeRaw.stats ?? {};

  const minDelay =
    typeof settings.postGameDelayMinMs === "number" ? settings.postGameDelayMinMs : defaults.settings.postGameDelayMinMs;
  const maxDelay =
    typeof settings.postGameDelayMaxMs === "number" ? settings.postGameDelayMaxMs : defaults.settings.postGameDelayMaxMs;

  return {
    version: CONFIG_VERSION,
    settings: {
      language:
        settings.language === "zh-CN" || settings.language === "en-US"
          ? settings.language
          : defaults.settings.language,
      queueId:
        settings.queueId === null
          ? null
          : typeof settings.queueId === "number" && Number.isFinite(settings.queueId)
            ? settings.queueId
            : defaults.settings.queueId,
      autoCancelOnDisable:
        typeof settings.autoCancelOnDisable === "boolean"
          ? settings.autoCancelOnDisable
          : defaults.settings.autoCancelOnDisable,
      postGameDelayMinMs: Math.min(minDelay, maxDelay),
      postGameDelayMaxMs: Math.max(minDelay, maxDelay),
      queueRetryBlockMs:
        typeof settings.queueRetryBlockMs === "number" && settings.queueRetryBlockMs > 0
          ? settings.queueRetryBlockMs
          : defaults.settings.queueRetryBlockMs,
      homeResetCooldownMs:
        typeof settings.homeResetCooldownMs === "number" && settings.homeResetCooldownMs > 0
          ? settings.homeResetCooldownMs
          : defaults.settings.homeResetCooldownMs,
      reconnectCooldownMs:
        typeof settings.reconnectCooldownMs === "number" && settings.reconnectCooldownMs > 0
          ? settings.reconnectCooldownMs
          : defaults.settings.reconnectCooldownMs,
      cycleReconnectTimeoutMs:
        typeof settings.cycleReconnectTimeoutMs === "number" && settings.cycleReconnectTimeoutMs > 0
          ? settings.cycleReconnectTimeoutMs
          : defaults.settings.cycleReconnectTimeoutMs,
      pollIntervalMs:
        typeof settings.pollIntervalMs === "number" && settings.pollIntervalMs > 0
          ? settings.pollIntervalMs
          : defaults.settings.pollIntervalMs
    },
    stats: {
      totalCycleCount:
        typeof stats.totalCycleCount === "number" && stats.totalCycleCount >= 0
          ? stats.totalCycleCount
          : defaults.stats.totalCycleCount,
      sessionCycleCount:
        typeof stats.sessionCycleCount === "number" && stats.sessionCycleCount >= 0
          ? stats.sessionCycleCount
          : defaults.stats.sessionCycleCount
    }
  };
}

export function resolveConfigFilePath(userDataDir: string): string {
  return path.join(userDataDir, "tft-auto-queue.config.json");
}

export class MemoryConfigStore implements AppConfigStore {
  private current: PersistedAppConfig;

  constructor(initialConfig: PersistedAppConfig = createDefaultAppConfig()) {
    this.current = cloneConfig(initialConfig);
  }

  get(): PersistedAppConfig {
    return cloneConfig(this.current);
  }

  set(next: PersistedAppConfig): PersistedAppConfig {
    this.current = cloneConfig(next);
    return this.get();
  }

  update(updater: (current: PersistedAppConfig) => PersistedAppConfig): PersistedAppConfig {
    this.current = cloneConfig(updater(this.get()));
    return this.get();
  }
}

export class JsonConfigStore implements AppConfigStore {
  private current: PersistedAppConfig;

  constructor(
    private readonly filePath: string,
    private readonly defaults: PersistedAppConfig = createDefaultAppConfig()
  ) {
    this.current = this.load(this.defaults);
  }

  get(): PersistedAppConfig {
    return cloneConfig(this.current);
  }

  set(next: PersistedAppConfig): PersistedAppConfig {
    this.current = normalizeAppConfig(next, this.defaults);
    this.persist();
    return this.get();
  }

  update(updater: (current: PersistedAppConfig) => PersistedAppConfig): PersistedAppConfig {
    this.current = normalizeAppConfig(updater(this.get()), this.defaults);
    this.persist();
    return this.get();
  }

  private load(defaults: PersistedAppConfig): PersistedAppConfig {
    const dirPath = path.dirname(this.filePath);
    fs.mkdirSync(dirPath, { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      const initial = normalizeAppConfig(defaults, defaults);
      this.current = initial;
      this.persist();
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedAppConfig>;
      const normalized = normalizeAppConfig(parsed, defaults);
      this.current = normalized;
      this.persist();
      return normalized;
    } catch {
      const recovered = normalizeAppConfig(defaults, defaults);
      this.current = recovered;
      this.persist();
      return recovered;
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.current, null, 2)}\n`, "utf8");
  }
}

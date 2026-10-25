import path from "node:path";
import dotenv from "dotenv";
import { app, dialog, globalShortcut } from "electron";
import { registerIpcHandlers } from "./app/registerIpc";
import { TrayController } from "./app/trayController";
import { WindowManager } from "./app/windowManager";
import type { AppSettings } from "./config/appConfig";
import type {
  AutoQueueService,
  ServiceSnapshot,
} from "./services/autoQueueService";
import { log } from "./utils/logger";

dotenv.config();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let quitting = false;
let service: AutoQueueService | null = null;
let trayController: TrayController | null = null;
let windowManager: WindowManager | null = null;
let disposeIpc: (() => void) | null = null;
let disposeStateSubscription: (() => void) | null = null;
let togglePromise: Promise<ServiceSnapshot> | null = null;
let shutdownComplete = false;

function getService(): AutoQueueService {
  if (!service) {
    throw new Error("Service not initialized yet.");
  }
  return service;
}

function syncShellState(snapshot: ServiceSnapshot): void {
  trayController?.update(snapshot);
  windowManager?.broadcastState(snapshot);
}

async function toggleService(): Promise<ServiceSnapshot> {
  if (togglePromise) return togglePromise;
  togglePromise = performToggle();
  try {
    return await togglePromise;
  } finally {
    togglePromise = null;
  }
}

async function performToggle(): Promise<ServiceSnapshot> {
  const currentService = getService();

  try {
    const enabled = await currentService.toggle();
    log(enabled ? "Service enabled by F1." : "Service disabled by F1.");
  } catch (err) {
    log(`Toggle failed: ${String(err)}`);
  }

  return currentService.getSnapshot();
}

function saveSettings(settings: Partial<AppSettings>): AppSettings {
  return getService().updateSettings(settings);
}

function registerHotkey(): void {
  const ok = globalShortcut.register("F1", () => {
    void toggleService();
  });
  log(ok ? "F1 registered." : "F1 registration failed.");
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("tft-auto-queue-next");

  const [
    { JsonConfigStore, createDefaultAppConfig, resolveConfigFilePath },
    { AutoQueueService },
  ] = await Promise.all([
    import("./config/appConfig"),
    import("./services/autoQueueService"),
  ]);

  const configStore = new JsonConfigStore(
    resolveConfigFilePath(app.getPath("userData")),
    createDefaultAppConfig(process.env),
  );

  service = new AutoQueueService({ configStore });
  windowManager = new WindowManager({
    preloadPath: path.join(__dirname, "preload.js"),
    indexPath: path.join(__dirname, "..", "dist-renderer", "index.html"),
    shouldHideOnClose: () => !quitting,
  });
  trayController = new TrayController({
    getLanguage: () => getService().getSettings().language,
    onToggle: () => {
      void toggleService();
    },
    onShow: () => {
      windowManager?.show();
    },
    onExit: () => {
      quitting = true;
      app.quit();
    },
  });

  windowManager.create();
  trayController.create();
  disposeIpc = registerIpcHandlers({
    trustedWebContentsId: () => windowManager?.getWindow()?.webContents.id,
    checkClient: async () => {
      const [{ discoverLcuCredentials }, { LcuClient }] = await Promise.all([
        import("./lcu/discovery"),
        import("./lcu/client"),
      ]);
      let client: InstanceType<typeof LcuClient> | null = null;
      try {
        client = new LcuClient(discoverLcuCredentials());
        await client.get("/lol-gameflow/v1/gameflow-phase");
        return { ok: true, message: "Client connected" };
      } catch {
        return {
          ok: false,
          message:
            "Unable to connect. Open the League client and sign in first.",
        };
      } finally {
        client?.close();
      }
    },
    onToggle: toggleService,
    getInitialData: () => ({
      state: getService().getSnapshot(),
      settings: getService().getSettings(),
      defaults: createDefaultAppConfig({}).settings,
      version: app.getVersion(),
    }),
    saveSettings,
  });
  disposeStateSubscription = service.subscribe(syncShellState);
  registerHotkey();
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  void bootstrap().catch((error) => {
    dialog.showErrorBox("TFT Auto Queue", `Unable to start: ${String(error)}`);
    quitting = true;
    app.quit();
  });
});

app.on("second-instance", () => {
  windowManager?.focusExisting();
});

app.on("before-quit", (event) => {
  quitting = true;
  if (shutdownComplete || !service) return;
  event.preventDefault();
  void service
    .stop()
    .catch((error) => log(`Stop failed: ${String(error)}`))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});

app.on("will-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  disposeIpc?.();
  disposeStateSubscription?.();
  trayController?.destroy();
});

app.on("window-all-closed", () => {
  // keep tray app alive
});

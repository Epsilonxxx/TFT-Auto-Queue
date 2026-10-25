const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const { preview } = await import("vite");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "artifacts", "ui");
  fs.mkdirSync(output, { recursive: true });
  const server = await preview({
    configFile: path.join(root, "vite.config.ts"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1180, height: 960 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const defaults = {
        language: "zh-CN",
        queueId: null,
        autoCancelOnDisable: true,
        postGameDelayMinMs: 1000,
        postGameDelayMaxMs: 2000,
        queueRetryBlockMs: 180000,
        homeResetCooldownMs: 10000,
        reconnectCooldownMs: 5000,
        cycleReconnectTimeoutMs: 300000,
        pollIntervalMs: 2500,
      };
      let settings = { ...defaults };
      let state = {
        enabled: false,
        queueId: 1220,
        queueName: "Tocker's Trials",
        phase: "Unknown",
        totalCycleCount: 8360,
        sessionCycleCount: 339,
        lastError: null,
        connection: "idle",
        startedAt: null,
        phaseStartedAt: null,
        retryAt: null,
        matchDeadlineAt: null,
        activity: [],
      };
      let listener = () => {};
      window.__setSnapshot = (patch) => {
        state = { ...state, ...patch };
        listener(state);
      };
      window.__saved = 0;
      window.tftApi = {
        getInitialData: async () => ({
          settings,
          defaults,
          state,
          version: "0.8.1",
        }),
        onState: (callback) => {
          listener = callback;
          return () => {
            listener = () => {};
          };
        },
        checkClient: async () => ({ ok: true, message: "Client connected" }),
        saveSettings: async (next) => {
          settings = { ...settings, ...next };
          window.__saved++;
          return settings;
        },
        toggle: async () => {
          const enabled = !state.enabled;
          state = {
            ...state,
            enabled,
            connection: enabled ? "connected" : "idle",
            phase: enabled ? "Matchmaking" : "Unknown",
            startedAt: enabled ? Date.now() : null,
            phaseStartedAt: enabled ? Date.now() : null,
          };
          listener(state);
          return state;
        },
      };
    });
    const url = server.resolvedUrls.local[0];
    await page.goto(url);
    await page.getByRole("button", { name: "启动自动匹配" }).waitFor();
    await page.screenshot({
      path: path.join(output, "dashboard.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "检查客户端", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "已连接 LOL 客户端" })
      .waitFor();
    await page.getByRole("button", { name: "启动自动匹配" }).click();
    await page.getByRole("button", { name: "停止自动匹配" }).waitFor();
    assert.equal(
      await page.locator(".workflow-steps .current").innerText(),
      "02\n匹配与确认",
    );
    await page.evaluate(() =>
      window.__setSnapshot({
        phase: "InProgress",
        matchDeadlineAt: Date.now() + 300000,
        activity: [
          {
            id: 1,
            at: Date.now() - 45000,
            message: "Enabled for queue: Tocker's Trials",
          },
          { id: 2, at: Date.now() - 44000, message: "Search started." },
          { id: 3, at: Date.now() - 15000, message: "Ready-check accepted." },
          { id: 4, at: Date.now(), message: "Phase: InProgress" },
        ],
      }),
    );
    await page.getByText("距离超时恢复").waitFor();
    await page.screenshot({
      path: path.join(output, "running.png"),
      fullPage: true,
    });
    await page.evaluate(() =>
      window.__setSnapshot({ retryAt: Date.now() + 120000 }),
    );
    await page.getByText("距离下次重试").waitFor();
    await page.getByRole("button", { name: "停止自动匹配" }).click();

    await page
      .getByRole("button", { name: "偏好设置", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "时序 02" }).click();
    await page.locator('input[name="pollIntervalMs"]').fill("0.001");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.getByText("状态检查间隔需在 0.25 至 86400 秒之间。").waitFor();
    assert.equal(await page.evaluate(() => window.__saved), 0);
    await page.getByRole("button", { name: "恢复默认值", exact: true }).click();
    await page.getByRole("button", { name: "恢复 03" }).click();
    await page.screenshot({
      path: path.join(output, "settings.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog").count(), 0);

    await page
      .getByRole("button", { name: "偏好设置", exact: true })
      .first()
      .click();
    await page.getByLabel("界面语言").selectOption("en-US");
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await page.getByRole("heading", { name: "Queue dashboard" }).waitFor();
    assert.equal(await page.evaluate(() => window.__saved), 1);

    for (const width of [1180, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
      await page.screenshot({
        path: path.join(output, `english-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.keyboard.press("Escape");

    const failurePage = await browser.newPage();
    failurePage.on("pageerror", (error) => errors.push(error.message));
    await failurePage.addInitScript(() => {
      window.tftApi = {
        onState: () => () => {},
        getInitialData: async () => {
          throw new Error("IPC unavailable");
        },
      };
    });
    await failurePage.goto(url);
    await failurePage.getByRole("alert").waitFor();
    assert.equal(
      await failurePage
        .getByRole("button", { name: "启动自动匹配" })
        .isDisabled(),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "UI checks passed: start/stop, client status, phase updates, countdowns, settings validation, save, reset, Escape, English, load failure, and 4 viewport widths.",
    );
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

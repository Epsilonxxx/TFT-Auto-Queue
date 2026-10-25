import { useEffect, useState } from "react";
import type { InitialData, ServiceSnapshot } from "./types";
import { copy, duration, phaseLabel, activityLabel } from "./i18n";
import { Icon, type IconName } from "./components/Icon";
import { SettingsDialog } from "./components/SettingsDialog";

const emptyState: ServiceSnapshot = {
  enabled: false,
  queueId: 1220,
  queueName: "Tocker's Trials",
  phase: "Unknown",
  totalCycleCount: 0,
  sessionCycleCount: 0,
  lastError: null,
  connection: "idle",
  startedAt: null,
  phaseStartedAt: null,
  retryAt: null,
  matchDeadlineAt: null,
  activity: [],
};

function phaseStep(phase: string): number {
  if (["Matchmaking", "ReadyCheck", "ChampSelect"].includes(phase)) return 1;
  if (["InProgress", "Reconnect", "TerminatedInError"].includes(phase))
    return 2;
  if (["WaitingForStats", "PreEndOfGame", "EndOfGame"].includes(phase))
    return 3;
  return 0;
}

export function App() {
  const [data, setData] = useState<InitialData | null>(null);
  const [state, setState] = useState(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<boolean | null>(null);
  const [settingsSection, setSettingsSection] = useState<
    "general" | "timing" | "recovery" | null
  >(null);
  const [toast, setToast] = useState(false);
  const [now, setNow] = useState(Date.now());
  const language = data?.settings.language ?? "zh-CN";
  const t = copy[language];

  useEffect(() => {
    let mounted = true;
    if (!window.tftApi) {
      setError(copy["zh-CN"].loadError);
      return;
    }
    let receivedState = false;
    const off = window.tftApi.onState((next) => {
      if (mounted) {
        receivedState = true;
        setState(next);
      }
    });
    window.tftApi
      .getInitialData()
      .then((initial) => {
        if (!mounted) return;
        setData(initial);
        if (!receivedState) setState(initial.state);
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setError(copy["zh-CN"].loadError);
      });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  useEffect(() => {
    document.title = `${t.console} · TFT Auto Queue`;
    document.documentElement.lang = language;
  }, [language, t.console]);

  useEffect(() => {
    if (!state.enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.enabled]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function toggle() {
    if (busy || !loaded) return;
    setBusy(true);
    setError("");
    setCheck(null);
    try {
      setState(await window.tftApi.toggle());
    } catch {
      setError(t.serviceError);
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }

  async function checkClient() {
    if (checking || state.enabled) return;
    setChecking(true);
    try {
      setCheck((await window.tftApi.checkClient()).ok);
    } catch {
      setCheck(false);
    } finally {
      setChecking(false);
    }
  }

  const recovering = state.connection === "reconnecting";
  const connecting = state.connection === "connecting";
  const status = recovering
    ? t.recovering
    : connecting
      ? t.connecting
      : state.enabled
        ? t.running
        : t.stopped;
  const currentStep = phaseStep(state.phase);
  const countdown = state.enabled
    ? (state.retryAt ?? state.matchDeadlineAt)
    : null;
  const retrying = state.retryAt !== null;
  const steps: Array<{ label: string; icon: IconName }> = [
    { label: t.stepLobby, icon: "grid" },
    { label: t.stepQueue, icon: "check" },
    { label: t.stepGame, icon: "game" },
    { label: t.stepEnd, icon: "refresh" },
  ];
  const recent = [...state.activity].reverse().slice(0, 30);
  const timeoutMinutes =
    (data?.settings.cycleReconnectTimeoutMs ?? 300000) / 60000;
  const clientLabel = recovering
    ? t.reconnecting
    : connecting
      ? t.connecting
      : state.connection === "connected" || check === true
        ? t.connected
        : t.idleClient;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            a<span>q</span>
            <i />
          </div>
          <div>
            <strong>TFT AUTO QUEUE</strong>
            <small>{t.brand}</small>
          </div>
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="main-nav" aria-label={t.console}>
          <button className="nav-item selected" aria-current="page">
            <Icon name="grid" />
            {t.overview}
            <span className="nav-dot" />
          </button>
          <button
            className="nav-item"
            disabled={!data}
            onClick={() => setSettingsSection("general")}
          >
            <Icon name="settings" />
            {t.preferences}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="shortcut-card">
            <kbd>F1</kbd>
            <span>{t.shortcut}</span>
          </div>
          <div className="sidebar-meta">
            <span className="status-dot" />
            {t.local}
            <span className="version">v{data?.version ?? "0.8.1"}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <div className="eyebrow">YOUR NEXT GAME STARTS HERE</div>
            <h1>
              {t.console}
              <span className="title-dot">.</span>
            </h1>
            <p>{t.subtitle}</p>
          </div>
          <button
            className="button header-settings"
            onClick={() => setSettingsSection("general")}
            disabled={!data}
          >
            <Icon name="settings" />
            {t.preferences}
          </button>
        </header>

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {state.lastError && (
          <div className="notice error" role="alert">
            <Icon name="activity" />
            <div>
              <strong>{t.serviceProblem}</strong>
              <details>
                <summary>{t.details}</summary>
                <p>{state.lastError}</p>
              </details>
            </div>
          </div>
        )}
        {check !== null && (
          <div
            className={`notice ${check ? "success" : "warning"}`}
            role="status"
          >
            <Icon name={check ? "check" : "activity"} />
            {check ? t.checkOk : t.checkFailed}
          </div>
        )}

        <div className="dashboard-grid">
          <section
            className={`hero-panel ${state.enabled ? "is-running" : ""}`}
            aria-label={t.mode}
          >
            <div className="hero-top">
              <span className={`status-pill ${state.enabled ? "active" : ""}`}>
                <span className="status-dot" />
                {status}
              </span>
              <span className="hero-edition">AUTO QUEUE / 01</span>
            </div>
            <div className="hero-main">
              <div className="hero-copy">
                <h2>
                  {recovering
                    ? t.heroRecovering
                    : state.enabled
                      ? t.heroRunning
                      : t.heroTitle}
                </h2>
                <p>{state.enabled ? t.heroActive : t.heroDescription}</p>
                <div className="mode-label">
                  <Icon name="game" />
                  <span>
                    {state.queueId === 1220
                      ? t.tockers
                      : state.queueName === "Manual Queue"
                        ? t.manualQueue
                        : state.queueName}
                  </span>
                  <span className="queue-number">#{state.queueId}</span>
                </div>
              </div>
              <div className="queue-art" aria-hidden="true">
                <div className="orbit orbit-outer" />
                <div className="orbit orbit-middle" />
                <div className="orbit orbit-inner" />
                <span className="orbit-node" />
                <div className="queue-core">
                  <Icon name={state.enabled ? "refresh" : "spark"} />
                </div>
                <span className="art-cross cross-one">+</span>
                <span className="art-cross cross-two">+</span>
              </div>
            </div>
            <div className="hero-actions">
              <button
                className={`button ${state.enabled ? "stop-button" : "primary"}`}
                onClick={toggle}
                disabled={busy || !loaded}
                aria-busy={busy}
              >
                <Icon
                  name={busy ? "refresh" : state.enabled ? "stop" : "play"}
                  className={busy ? "spin" : ""}
                />
                {busy ? t.applying : state.enabled ? t.stop : t.start}
                <kbd>F1</kbd>
              </button>
              <button
                className="text-button"
                onClick={checkClient}
                disabled={checking || state.enabled || !loaded}
              >
                <Icon name="refresh" className={checking ? "spin" : ""} />
                {checking ? t.checking : t.check}
              </button>
            </div>
            <div className="client-strip">
              <span>
                <span
                  className={`status-dot ${state.connection === "connected" || check === true ? "green" : "muted"}`}
                />
                {t.client}
              </span>
              <strong>{clientLabel}</strong>
            </div>
          </section>

          <section className="stats-panel panel" aria-label={t.session}>
            <div className="stat-block">
              <span className="label">
                {t.session}
                <Icon name="refresh" />
              </span>
              <div className="stat-value">
                {String(state.sessionCycleCount).padStart(2, "0")}
                <span>{t.games}</span>
              </div>
              <p>{t.sessionNote}</p>
            </div>
            <div className="stat-block total-block">
              <span className="label">
                {t.total}
                <Icon name="activity" />
              </span>
              <div className="stat-value">
                {String(state.totalCycleCount).padStart(2, "0")}
                <span>{t.games}</span>
              </div>
              <p>{t.totalNote}</p>
            </div>
            <div className="uptime">
              <span>
                <Icon name="clock" />
                {t.uptime}
              </span>
              <strong>
                {duration(state.startedAt === null ? 0 : now - state.startedAt)}
              </strong>
            </div>
          </section>

          <section className="workflow-panel panel" aria-label={t.workflow}>
            <div className="section-heading">
              <h3>{t.workflow}</h3>
              <span>{t.workflowNote}</span>
            </div>
            <ol className="workflow-steps">
              {steps.map((step, index) => (
                <li
                  key={step.label}
                  className={
                    state.enabled && currentStep === index
                      ? "current"
                      : state.enabled && index < currentStep
                        ? "complete"
                        : ""
                  }
                  aria-current={
                    state.enabled && currentStep === index ? "step" : undefined
                  }
                >
                  <div className="step-icon">
                    <Icon
                      name={
                        state.enabled && index < currentStep
                          ? "check"
                          : step.icon
                      }
                    />
                  </div>
                  <span>
                    <small>0{index + 1}</small>
                    {step.label}
                  </span>
                  {index < 3 && <i />}
                </li>
              ))}
            </ol>
            <div className="phase-strip" aria-live="polite">
              <span>
                {t.phase}
                <strong>
                  {state.enabled ? phaseLabel(t, state.phase) : t.unknown}
                </strong>
              </span>
              <span>
                {countdown !== null
                  ? retrying
                    ? t.retry
                    : t.deadline
                  : t.phaseTime}
                <strong className="mono">
                  {duration(
                    countdown !== null
                      ? countdown - now
                      : state.phaseStartedAt === null
                        ? 0
                        : now - state.phaseStartedAt,
                  )}
                </strong>
              </span>
            </div>
          </section>

          <section className="activity-panel panel" aria-label={t.activity}>
            <div className="section-heading">
              <div>
                <h3>{t.activity}</h3>
                <p>{t.activityNote}</p>
              </div>
              <span className="live-label">
                <span
                  className={`status-dot ${state.enabled ? "green" : "muted"}`}
                />
                {state.enabled ? t.live : t.awaiting}
              </span>
            </div>
            <div className="activity-list">
              {recent.length ? (
                <ol>
                  {recent.map((entry) => (
                    <li key={entry.id}>
                      <span
                        className={`event-dot ${/failed|error/i.test(entry.message) ? "warn" : ""}`}
                      />
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {new Date(entry.at).toLocaleTimeString(language, {
                          hour12: false,
                        })}
                      </time>
                      <span>{activityLabel(entry.message, language)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="empty-activity">
                  <div>
                    <Icon name="activity" />
                  </div>
                  <strong>{t.noActivity}</strong>
                  <p>{t.noActivityNote}</p>
                  <span className="empty-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
            </div>
            <div className="activity-footer">
              <span>
                {state.activity.length} {t.events}
              </span>
              <span>TFT AUTO QUEUE</span>
            </div>
          </section>

          <section className="protection-panel panel" aria-label={t.protection}>
            <div className="section-heading">
              <div>
                <h3>
                  <Icon name="shield" />
                  {t.protection}
                </h3>
                <p>{t.protectionNote}</p>
              </div>
              <span className="small-tag">{t.enabled}</span>
            </div>
            <div className="protection-items">
              <div>
                <span className="check-circle">
                  <Icon name="check" />
                </span>
                <span>
                  <strong>{t.crash}</strong>
                  <small>{t.crashNote}</small>
                </span>
              </div>
              <div>
                <span className="check-circle">
                  <Icon name="check" />
                </span>
                <span>
                  <strong>{t.retryProtection}</strong>
                  <small>{t.retryProtectionNote}</small>
                </span>
              </div>
              <div>
                <span className="check-circle">
                  <Icon name="clock" />
                </span>
                <span>
                  <strong>
                    {t.timeoutProtection}
                    <em>
                      {Number(timeoutMinutes.toFixed(2))} {t.minutes}
                    </em>
                  </strong>
                  <small>{t.timeoutNote}</small>
                </span>
              </div>
            </div>
            <button
              className="protection-link"
              disabled={!data}
              onClick={() => setSettingsSection("recovery")}
            >
              {t.adjust}
              <Icon name="arrow" />
            </button>
          </section>
        </div>
        <footer className="page-footer">
          <span>
            <span className="status-dot muted" />
            {t.tray}
          </span>
          <span>LESS REPETITION. MORE PLAY.</span>
        </footer>
      </main>
      {data && settingsSection && (
        <SettingsDialog
          settings={data.settings}
          defaults={data.defaults}
          section={settingsSection}
          onClose={() => setSettingsSection(null)}
          onSave={async (settings) => {
            const next = await window.tftApi.saveSettings(settings);
            setData({ ...data, settings: next });
            setToast(true);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {t.saved}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppSettings } from "../types";
import { copy } from "../i18n";
import {
  toForm,
  validateForm,
  type DurationField,
  type SettingsErrors,
} from "../settingsModel";
import { Icon } from "./Icon";

type Section = "general" | "timing" | "recovery";
type Props = {
  settings: AppSettings;
  defaults: AppSettings;
  section: Section;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
};

export function SettingsDialog({
  settings,
  defaults,
  section: initialSection,
  onClose,
  onSave,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState(initialSection);
  const [form, setForm] = useState(() => toForm(settings));
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const t = copy[form.language];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function field(key: DurationField, label: string) {
    return (
      <label className={`field ${errors[key] ? "invalid" : ""}`} key={key}>
        <span>{label}</span>
        <div className="input-unit">
          <input
            name={key}
            value={form[key]}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={!!errors[key]}
            aria-describedby={errors[key] ? `${key}-error` : undefined}
            onChange={(event) => {
              setForm({ ...form, [key]: event.target.value });
              setErrors({ ...errors, [key]: undefined });
            }}
          />
          <span>{t.seconds}</span>
        </div>
        {errors[key] && <small id={`${key}-error`}>{t[errors[key]!]}</small>}
      </label>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = validateForm(form);
    setErrors(result.errors);
    if (!result.settings) {
      const first = Object.keys(result.errors)[0];
      setSection(
        first === "queueId"
          ? "general"
          : [
                "pollIntervalMs",
                "postGameDelayMinMs",
                "postGameDelayMaxMs",
              ].includes(first)
            ? "timing"
            : "recovery",
      );
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await onSave(result.settings);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t.serviceError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <header className="dialog-header">
          <div>
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2 id="settings-title">{t.settingsTitle}</h2>
            <p>{t.settingsDescription}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t.close}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label={t.settingsTitle}>
            {(["general", "timing", "recovery"] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={section === item ? "selected" : ""}
                aria-pressed={section === item}
                onClick={() => setSection(item)}
              >
                <Icon
                  name={
                    item === "general"
                      ? "settings"
                      : item === "timing"
                        ? "clock"
                        : "shield"
                  }
                />
                {t[item]}
                <span>
                  0{item === "general" ? 1 : item === "timing" ? 2 : 3}
                </span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {saveError && (
              <div className="notice error" role="alert">
                {saveError}
              </div>
            )}
            {section === "general" && (
              <>
                <h3>{t.general}</h3>
                <div className="form-grid">
                  <label className="field">
                    <span>{t.language}</span>
                    <select
                      value={form.language}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          language: event.target
                            .value as AppSettings["language"],
                        })
                      }
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="en-US">English</option>
                    </select>
                  </label>
                  <label className={`field ${errors.queueId ? "invalid" : ""}`}>
                    <span>{t.queue}</span>
                    <input
                      name="queueId"
                      value={form.queueId}
                      inputMode="numeric"
                      aria-invalid={!!errors.queueId}
                      aria-describedby="queue-help"
                      placeholder="1220"
                      onChange={(event) => {
                        setForm({ ...form, queueId: event.target.value });
                        setErrors({ ...errors, queueId: undefined });
                      }}
                    />
                    <small id="queue-help">
                      {errors.queueId ? t.queueError : t.queueHelp}
                    </small>
                  </label>
                </div>
                <label className="switch-row">
                  <span>
                    <strong>{t.autoCancel}</strong>
                    <small>{t.autoCancelHelp}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={form.autoCancelOnDisable}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        autoCancelOnDisable: event.target.checked,
                      })
                    }
                  />
                  <span className="switch-track" aria-hidden="true" />
                </label>
              </>
            )}
            {section === "timing" && (
              <>
                <h3>{t.timing}</h3>
                <p className="section-help">{t.timingHelp}</p>
                <div className="form-grid">
                  {field("pollIntervalMs", t.poll)}
                  {field("postGameDelayMinMs", t.minDelay)}
                  {field("postGameDelayMaxMs", t.maxDelay)}
                </div>
              </>
            )}
            {section === "recovery" && (
              <>
                <h3>{t.recovery}</h3>
                <p className="section-help">{t.recoveryHelp}</p>
                <div className="form-grid">
                  {field("queueRetryBlockMs", t.retryBlock)}
                  {field("homeResetCooldownMs", t.homeCooldown)}
                  {field("reconnectCooldownMs", t.reconnectCooldown)}
                  {field("cycleReconnectTimeoutMs", t.matchTimeout)}
                </div>
              </>
            )}
            <p className="settings-footnote">
              <Icon name="refresh" />
              {t.nextRun}
            </p>
          </div>
        </div>
        <footer className="dialog-footer">
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => {
              setForm(toForm(defaults));
              setErrors({});
              setSaveError("");
            }}
          >
            {t.reset}
          </button>
          <div>
            <button
              className="button secondary"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              {t.cancel}
            </button>
            <button className="button primary" type="submit" disabled={saving}>
              {saving ? t.saving : t.save}
              <Icon name="check" />
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

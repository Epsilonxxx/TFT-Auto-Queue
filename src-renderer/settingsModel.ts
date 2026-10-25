import type { AppSettings } from "./types";

export const durationFields = [
  "pollIntervalMs",
  "postGameDelayMinMs",
  "postGameDelayMaxMs",
  "queueRetryBlockMs",
  "homeResetCooldownMs",
  "reconnectCooldownMs",
  "cycleReconnectTimeoutMs",
] as const;
export type DurationField = (typeof durationFields)[number];
export type SettingsForm = {
  language: AppSettings["language"];
  queueId: string;
  autoCancelOnDisable: boolean;
} & Record<DurationField, string>;
export type SettingsErrors = Partial<
  Record<
    DurationField | "queueId",
    "queueError" | "positive" | "pollError" | "delayError"
  >
>;

export function toForm(settings: AppSettings): SettingsForm {
  return {
    language: settings.language,
    queueId: settings.queueId === null ? "" : String(settings.queueId),
    autoCancelOnDisable: settings.autoCancelOnDisable,
    ...Object.fromEntries(
      durationFields.map((key) => [key, String(settings[key] / 1000)]),
    ),
  } as SettingsForm;
}

export function validateForm(form: SettingsForm): {
  errors: SettingsErrors;
  settings: AppSettings | null;
} {
  const errors: SettingsErrors = {};
  const queue = form.queueId.trim();
  const queueId = queue === "" ? null : Number(queue);
  if (
    queue !== "" &&
    (!/^\d+$/.test(queue) || !Number.isSafeInteger(queueId) || queueId! <= 0)
  )
    errors.queueId = "queueError";
  const values = {} as Record<DurationField, number>;
  for (const key of durationFields) {
    const raw = form[key].trim();
    const value = Number(raw) * 1000;
    const minimum = key === "pollIntervalMs" ? 250 : 1;
    if (
      !/^\d+(\.\d+)?$/.test(raw) ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > 86400000
    ) {
      errors[key] = key === "pollIntervalMs" ? "pollError" : "positive";
    }
    values[key] = Math.round(value);
  }
  if (
    !errors.postGameDelayMinMs &&
    !errors.postGameDelayMaxMs &&
    values.postGameDelayMaxMs < values.postGameDelayMinMs
  )
    errors.postGameDelayMaxMs = "delayError";
  return {
    errors,
    settings: Object.keys(errors).length
      ? null
      : {
          language: form.language,
          queueId,
          autoCancelOnDisable: form.autoCancelOnDisable,
          ...values,
        },
  };
}

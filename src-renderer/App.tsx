import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ThemeProvider,
  Typography,
  createTheme
} from "@mui/material";
import SportsEsportsRoundedIcon from "@mui/icons-material/SportsEsportsRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import RepeatRoundedIcon from "@mui/icons-material/RepeatRounded";
import FunctionsRoundedIcon from "@mui/icons-material/FunctionsRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import styled from "styled-components";
import type { AppLanguage, AppSettings, ServiceSnapshot } from "./types";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#2563eb" },
    background: { default: "#f3f6fb", paper: "#ffffff" },
    text: { primary: "#0f172a", secondary: "#64748b" }
  },
  shape: { borderRadius: 16 },
  spacing: 8,
  typography: {
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
    h5: { fontWeight: 700, letterSpacing: "-0.01em" },
    subtitle2: { fontWeight: 600 }
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
          border: "1px solid #e2e8f0"
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 12,
          fontWeight: 600,
          minHeight: 44
        }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 20
        }
      }
    }
  }
});

const PageWrap = styled.div`
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 16px 0;
`;

const StatIconBox = styled(Box)`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #eff6ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #2563eb;
`;

const emptyState: ServiceSnapshot = {
  enabled: false,
  queueId: 0,
  queueName: "-",
  phase: "-",
  totalCycleCount: 0,
  sessionCycleCount: 0
};

const emptySettings: AppSettings = {
  language: "zh-CN",
  queueId: null,
  autoCancelOnDisable: true,
  scheduledRestartHours: 0,
  postGameDelayMinMs: 1000,
  postGameDelayMaxMs: 2000,
  queueRetryBlockMs: 180000,
  homeResetCooldownMs: 10000,
  reconnectCooldownMs: 5000,
  cycleReconnectTimeoutMs: 300000,
  pollIntervalMs: 2500
};

type SettingsFormState = {
  language: AppLanguage;
  queueId: string;
  autoCancelOnDisable: boolean;
  scheduledRestartHours: string;
  postGameDelayMinMs: string;
  postGameDelayMaxMs: string;
  queueRetryBlockSeconds: string;
  homeResetCooldownSeconds: string;
  reconnectCooldownSeconds: string;
  cycleReconnectTimeoutSeconds: string;
  pollIntervalMs: string;
};

type SettingsFormErrors = Partial<Record<keyof SettingsFormState, string>>;

const translations = {
  "zh-CN": {
    appTitle: "TFT 自动匹配",
    statusRunning: "运行中",
    statusStopped: "已停止",
    settings: "设置",
    start: "启动自动匹配 (F1)",
    stop: "关闭自动匹配 (F1)",
    applying: "应用中...",
    save: "保存设置",
    saving: "保存中...",
    cancel: "取消",
    dialogTitle: "设置",
    statsQueue: "队列",
    statsPhase: "阶段",
    statsSession: "本次运行",
    statsTotal: "总次数",
    manualQueue: "自定义队列",
    queueTockers: "发条鸟的试炼",
    fieldsLanguage: "界面语言",
    fieldsQueueId: "队列 ID",
    fieldsPollInterval: "轮询间隔",
    fieldsPostGameDelayMin: "结算后最小延迟",
    fieldsPostGameDelayMax: "结算后最大延迟",
    fieldsQueueRetryBlock: "限制后等待",
    fieldsHomeResetCooldown: "回首页冷却",
    fieldsReconnectCooldown: "重连冷却",
    fieldsCycleReconnectTimeout: "单局超时重连",
    fieldsAutoCancelOnDisable: "关闭自动匹配时取消当前搜索",
    queueIdError: "队列 ID 必须是正整数，或留空。",
    positiveIntegerError: "请输入正整数。",
    maxDelayError: "最大延迟必须大于或等于最小延迟。",
    languageChinese: "简体中文",
    languageEnglish: "English",
    phaseUnknown: "未知",
    unitMilliseconds: "毫秒",
    unitSeconds: "秒",
    phases: {
      None: "无",
      Lobby: "房间中",
      Matchmaking: "匹配中",
      ReadyCheck: "确认对局",
      ChampSelect: "选人中",
      InProgress: "对局中",
      WaitingForStats: "等待结算",
      PreEndOfGame: "结算前",
      EndOfGame: "结算中",
      Reconnect: "重新连接",
      TerminatedInError: "错误中断",
      Unknown: "未知"
    }
  },
  "en-US": {
    appTitle: "TFT Auto Queue",
    statusRunning: "Running",
    statusStopped: "Stopped",
    settings: "Settings",
    start: "Start Auto Queue (F1)",
    stop: "Stop Auto Queue (F1)",
    applying: "Applying...",
    save: "Save Settings",
    saving: "Saving...",
    cancel: "Cancel",
    dialogTitle: "Settings",
    statsQueue: "Queue",
    statsPhase: "Phase",
    statsSession: "Current Session",
    statsTotal: "Total Runs",
    manualQueue: "Manual Queue",
    queueTockers: "Tocker's Trials",
    fieldsLanguage: "Language",
    fieldsQueueId: "Queue ID",
    fieldsPollInterval: "Poll Interval",
    fieldsPostGameDelayMin: "Post-game Delay Min",
    fieldsPostGameDelayMax: "Post-game Delay Max",
    fieldsQueueRetryBlock: "Queue Retry Block",
    fieldsHomeResetCooldown: "Home Reset Cooldown",
    fieldsReconnectCooldown: "Reconnect Cooldown",
    fieldsCycleReconnectTimeout: "Cycle Reconnect Timeout",
    fieldsAutoCancelOnDisable: "Cancel matchmaking search when disabling auto queue",
    queueIdError: "Queue ID must be a positive integer or left blank.",
    positiveIntegerError: "Enter a positive integer.",
    maxDelayError: "Max delay must be greater than or equal to min delay.",
    languageChinese: "简体中文",
    languageEnglish: "English",
    phaseUnknown: "Unknown",
    unitMilliseconds: "ms",
    unitSeconds: "sec",
    phases: {
      None: "None",
      Lobby: "Lobby",
      Matchmaking: "Matchmaking",
      ReadyCheck: "Ready Check",
      ChampSelect: "Champ Select",
      InProgress: "In Progress",
      WaitingForStats: "Waiting For Stats",
      PreEndOfGame: "Pre End Of Game",
      EndOfGame: "End Of Game",
      Reconnect: "Reconnect",
      TerminatedInError: "Terminated In Error",
      Unknown: "Unknown"
    }
  }
} as const;

function getTranslations(language: AppLanguage) {
  return translations[language];
}

function settingsToForm(settings: AppSettings): SettingsFormState {
  return {
    language: settings.language,
    queueId: settings.queueId === null ? "" : String(settings.queueId),
    autoCancelOnDisable: settings.autoCancelOnDisable,
    scheduledRestartHours: String(settings.scheduledRestartHours),
    postGameDelayMinMs: String(settings.postGameDelayMinMs),
    postGameDelayMaxMs: String(settings.postGameDelayMaxMs),
    queueRetryBlockSeconds: String(Math.round(settings.queueRetryBlockMs / 1000)),
    homeResetCooldownSeconds: String(Math.round(settings.homeResetCooldownMs / 1000)),
    reconnectCooldownSeconds: String(Math.round(settings.reconnectCooldownMs / 1000)),
    cycleReconnectTimeoutSeconds: String(Math.round(settings.cycleReconnectTimeoutMs / 1000)),
    pollIntervalMs: String(settings.pollIntervalMs)
  };
}

function parsePositiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }

  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }

  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validateSettingsForm(
  form: SettingsFormState,
  language: AppLanguage
): {
  errors: SettingsFormErrors;
  payload: Partial<AppSettings> | null;
} {
  const t = getTranslations(language);
  const errors: SettingsFormErrors = {};

  const queueId = form.queueId.trim() === "" ? null : parsePositiveInteger(form.queueId);
  if (form.queueId.trim() !== "" && queueId === null) {
    errors.queueId = t.queueIdError;
  }

  const scheduledRestartHours = parseNonNegativeInteger(form.scheduledRestartHours);
  if (scheduledRestartHours === null) {
    errors.scheduledRestartHours = t.positiveIntegerError;
  }

  const postGameDelayMinMs = parsePositiveInteger(form.postGameDelayMinMs);
  if (postGameDelayMinMs === null) {
    errors.postGameDelayMinMs = t.positiveIntegerError;
  }

  const postGameDelayMaxMs = parsePositiveInteger(form.postGameDelayMaxMs);
  if (postGameDelayMaxMs === null) {
    errors.postGameDelayMaxMs = t.positiveIntegerError;
  }

  if (
    postGameDelayMinMs !== null &&
    postGameDelayMaxMs !== null &&
    postGameDelayMinMs > postGameDelayMaxMs
  ) {
    errors.postGameDelayMaxMs = t.maxDelayError;
  }

  const queueRetryBlockSeconds = parsePositiveInteger(form.queueRetryBlockSeconds);
  if (queueRetryBlockSeconds === null) {
    errors.queueRetryBlockSeconds = t.positiveIntegerError;
  }

  const homeResetCooldownSeconds = parsePositiveInteger(form.homeResetCooldownSeconds);
  if (homeResetCooldownSeconds === null) {
    errors.homeResetCooldownSeconds = t.positiveIntegerError;
  }

  const reconnectCooldownSeconds = parsePositiveInteger(form.reconnectCooldownSeconds);
  if (reconnectCooldownSeconds === null) {
    errors.reconnectCooldownSeconds = t.positiveIntegerError;
  }

  const cycleReconnectTimeoutSeconds = parsePositiveInteger(form.cycleReconnectTimeoutSeconds);
  if (cycleReconnectTimeoutSeconds === null) {
    errors.cycleReconnectTimeoutSeconds = t.positiveIntegerError;
  }

  const pollIntervalMs = parsePositiveInteger(form.pollIntervalMs);
  if (pollIntervalMs === null) {
    errors.pollIntervalMs = t.positiveIntegerError;
  }

  if (Object.keys(errors).length > 0) {
    return { errors, payload: null };
  }

  return {
    errors: {},
    payload: {
      language: form.language,
      queueId,
      autoCancelOnDisable: form.autoCancelOnDisable,
      scheduledRestartHours: scheduledRestartHours ?? undefined,
      postGameDelayMinMs: postGameDelayMinMs ?? undefined,
      postGameDelayMaxMs: postGameDelayMaxMs ?? undefined,
      queueRetryBlockMs: (queueRetryBlockSeconds ?? 0) * 1000,
      homeResetCooldownMs: (homeResetCooldownSeconds ?? 0) * 1000,
      reconnectCooldownMs: (reconnectCooldownSeconds ?? 0) * 1000,
      cycleReconnectTimeoutMs: (cycleReconnectTimeoutSeconds ?? 0) * 1000,
      pollIntervalMs: pollIntervalMs ?? undefined
    }
  };
}

function displayPhase(language: AppLanguage, phase: string): string {
  const t = getTranslations(language);
  if (!phase || phase === "-") {
    return t.phaseUnknown;
  }

  return t.phases[phase as keyof typeof t.phases] ?? phase;
}

function displayQueueName(language: AppLanguage, queueId: number, queueName: string): string {
  const t = getTranslations(language);

  if (queueId === 1220) {
    return t.queueTockers;
  }

  if (queueName === "Manual Queue") {
    return t.manualQueue;
  }

  return queueName || "-";
}

function StatCard({
  title,
  value,
  icon
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
          <StatIconBox>{icon}</StatIconBox>
        </Stack>
        <Typography
          variant="h5"
          sx={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={value}
        >
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function renderHelperText(message?: string) {
  return message ?? " ";
}

export function App() {
  const [state, setState] = useState<ServiceSnapshot>(emptyState);
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(settingsToForm(emptySettings));
  const [settingsErrors, setSettingsErrors] = useState<SettingsFormErrors>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let mounted = true;

    window.tftApi.getInitialData().then((data) => {
      if (!mounted) {
        return;
      }

      setState(data.state);
      setSettings(data.settings);
      setSettingsForm(settingsToForm(data.settings));
    });

    const offState = window.tftApi.onState((next) => setState(next));
    return () => {
      mounted = false;
      offState();
    };
  }, []);

  const uiLanguage = settingsOpen ? settingsForm.language : settings.language;
  const t = useMemo(() => getTranslations(uiLanguage), [uiLanguage]);
  const scheduledRestartLabel =
    uiLanguage === "zh-CN" ? "\u5b9a\u65f6\u91cd\u542f\u6e38\u620f" : "Scheduled Game Restart";
  const sectionTitles = {
    general: uiLanguage === "zh-CN" ? "\u57fa\u7840\u8bbe\u7f6e" : "General",
    timing: uiLanguage === "zh-CN" ? "\u65f6\u5e8f\u8bbe\u7f6e" : "Timing",
    recovery: uiLanguage === "zh-CN" ? "\u5f02\u5e38\u6062\u590d" : "Recovery",
    maintenance: uiLanguage === "zh-CN" ? "\u7ef4\u62a4" : "Maintenance"
  };
  const scheduledRestartOptions = Array.from({ length: 25 }, (_, index) => index);

  const formatScheduledRestartOption = (hours: number) => {
    if (hours === 0) {
      return uiLanguage === "zh-CN" ? "\u5173\u95ed" : "Disabled";
    }

    return uiLanguage === "zh-CN"
      ? `\u6bcf ${hours} \u5c0f\u65f6`
      : `Every ${hours} hour${hours === 1 ? "" : "s"}`;
  };

  useEffect(() => {
    document.title = t.appTitle;
  }, [t.appTitle]);

  const statusLabel = state.enabled ? t.statusRunning : t.statusStopped;
  const stats = [
    {
      title: t.statsQueue,
      value: displayQueueName(uiLanguage, state.queueId, state.queueName),
      icon: <SportsEsportsRoundedIcon fontSize="small" />
    },
    {
      title: t.statsPhase,
      value: displayPhase(uiLanguage, state.phase),
      icon: <TimelineRoundedIcon fontSize="small" />
    },
    {
      title: t.statsSession,
      value: String(state.sessionCycleCount),
      icon: <RepeatRoundedIcon fontSize="small" />
    },
    {
      title: t.statsTotal,
      value: String(state.totalCycleCount),
      icon: <FunctionsRoundedIcon fontSize="small" />
    }
  ];

  const openSettings = () => {
    setSettingsForm(settingsToForm(settings));
    setSettingsErrors({});
    setSettingsError("");
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    if (settingsSaving) {
      return;
    }

    setSettingsOpen(false);
  };

  const updateFormField = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) => {
    setSettingsForm((current) => ({
      ...current,
      [key]: value
    }));

    setSettingsErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const onToggle = async () => {
    if (toggling) {
      return;
    }

    setToggling(true);
    try {
      await window.tftApi.toggle();
    } finally {
      setToggling(false);
    }
  };

  const onSaveSettings = async () => {
    if (settingsSaving) {
      return;
    }

    const validation = validateSettingsForm(settingsForm, settingsForm.language);
    setSettingsErrors(validation.errors);
    if (!validation.payload) {
      return;
    }

    setSettingsSaving(true);
    setSettingsError("");
    try {
      const nextSettings = await window.tftApi.saveSettings(validation.payload);
      setSettings(nextSettings);
      setSettingsForm(settingsToForm(nextSettings));
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(String(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PageWrap className="app-scroll">
        <Container
          maxWidth="lg"
          sx={{
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            py: 1
          }}
        >
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
              >
                <Box>
                  <Typography variant="h5">{t.appTitle}</Typography>
                </Box>

                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  alignItems={{ xs: "stretch", sm: "center" }}
                  sx={{ width: { xs: "100%", md: "auto" } }}
                >
                  <Chip
                    label={statusLabel}
                    color={state.enabled ? "success" : "default"}
                    variant={state.enabled ? "filled" : "outlined"}
                    sx={{ fontWeight: 600, alignSelf: { xs: "flex-start", sm: "center" } }}
                  />
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={openSettings}
                    startIcon={<SettingsRoundedIcon />}
                    sx={{ minWidth: { xs: "100%", sm: 150 } }}
                  >
                    {t.settings}
                  </Button>
                  <Button
                    variant="contained"
                    color={state.enabled ? "error" : "primary"}
                    onClick={onToggle}
                    disabled={toggling}
                    startIcon={
                      toggling ? (
                        <AutorenewRoundedIcon className="spin" />
                      ) : state.enabled ? (
                        <StopCircleRoundedIcon />
                      ) : (
                        <PlayArrowRoundedIcon />
                      )
                    }
                    sx={{ minWidth: { xs: "100%", sm: 220 } }}
                  >
                    {toggling ? t.applying : state.enabled ? t.stop : t.start}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "1fr 1fr",
                lg: "1fr 1fr 1fr 1fr"
              }
            }}
          >
            {stats.map((item) => (
              <Box key={item.title}>
                <StatCard title={item.title} value={item.value} icon={item.icon} />
              </Box>
            ))}
          </Box>
        </Container>

        <Dialog open={settingsOpen} onClose={closeSettings} maxWidth="md" fullWidth>
          <DialogTitle sx={{ pb: 1 }}>{t.dialogTitle}</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Stack spacing={2.5}>
              {settingsError ? <Alert severity="error">{settingsError}</Alert> : null}

              <Stack spacing={2}>
                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {sectionTitles.general}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 2
                    }}
                  >
                    <TextField
                      select
                      label={t.fieldsLanguage}
                      value={settingsForm.language}
                      onChange={(event) => updateFormField("language", event.target.value as AppLanguage)}
                      fullWidth
                    >
                      <MenuItem value="zh-CN">{t.languageChinese}</MenuItem>
                      <MenuItem value="en-US">{t.languageEnglish}</MenuItem>
                    </TextField>

                    <TextField
                      label={t.fieldsQueueId}
                      value={settingsForm.queueId}
                      onChange={(event) => updateFormField("queueId", event.target.value)}
                      error={Boolean(settingsErrors.queueId)}
                      helperText={renderHelperText(settingsErrors.queueId)}
                      fullWidth
                    />
                  </Box>
                </Box>

                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {sectionTitles.timing}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 2
                    }}
                  >
                    <TextField
                      label={t.fieldsPollInterval}
                      value={settingsForm.pollIntervalMs}
                      onChange={(event) => updateFormField("pollIntervalMs", event.target.value)}
                      error={Boolean(settingsErrors.pollIntervalMs)}
                      helperText={renderHelperText(settingsErrors.pollIntervalMs)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitMilliseconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsPostGameDelayMin}
                      value={settingsForm.postGameDelayMinMs}
                      onChange={(event) => updateFormField("postGameDelayMinMs", event.target.value)}
                      error={Boolean(settingsErrors.postGameDelayMinMs)}
                      helperText={renderHelperText(settingsErrors.postGameDelayMinMs)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitMilliseconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsPostGameDelayMax}
                      value={settingsForm.postGameDelayMaxMs}
                      onChange={(event) => updateFormField("postGameDelayMaxMs", event.target.value)}
                      error={Boolean(settingsErrors.postGameDelayMaxMs)}
                      helperText={renderHelperText(settingsErrors.postGameDelayMaxMs)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitMilliseconds}</InputAdornment>
                      }}
                    />
                  </Box>
                </Box>

                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {sectionTitles.recovery}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 2
                    }}
                  >
                    <TextField
                      label={t.fieldsQueueRetryBlock}
                      value={settingsForm.queueRetryBlockSeconds}
                      onChange={(event) => updateFormField("queueRetryBlockSeconds", event.target.value)}
                      error={Boolean(settingsErrors.queueRetryBlockSeconds)}
                      helperText={renderHelperText(settingsErrors.queueRetryBlockSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsHomeResetCooldown}
                      value={settingsForm.homeResetCooldownSeconds}
                      onChange={(event) => updateFormField("homeResetCooldownSeconds", event.target.value)}
                      error={Boolean(settingsErrors.homeResetCooldownSeconds)}
                      helperText={renderHelperText(settingsErrors.homeResetCooldownSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsReconnectCooldown}
                      value={settingsForm.reconnectCooldownSeconds}
                      onChange={(event) => updateFormField("reconnectCooldownSeconds", event.target.value)}
                      error={Boolean(settingsErrors.reconnectCooldownSeconds)}
                      helperText={renderHelperText(settingsErrors.reconnectCooldownSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsCycleReconnectTimeout}
                      value={settingsForm.cycleReconnectTimeoutSeconds}
                      onChange={(event) => updateFormField("cycleReconnectTimeoutSeconds", event.target.value)}
                      error={Boolean(settingsErrors.cycleReconnectTimeoutSeconds)}
                      helperText={renderHelperText(settingsErrors.cycleReconnectTimeoutSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />
                  </Box>
                </Box>

                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {sectionTitles.maintenance}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 2
                    }}
                  >
                    <TextField
                      select
                      label={scheduledRestartLabel}
                      value={settingsForm.scheduledRestartHours}
                      onChange={(event) => updateFormField("scheduledRestartHours", event.target.value)}
                      error={Boolean(settingsErrors.scheduledRestartHours)}
                      helperText={renderHelperText(settingsErrors.scheduledRestartHours)}
                      fullWidth
                    >
                      {scheduledRestartOptions.map((hours) => (
                        <MenuItem key={hours} value={String(hours)}>
                          {formatScheduledRestartOption(hours)}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>

                  <Box sx={{ mt: 2 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={settingsForm.autoCancelOnDisable}
                          onChange={(event) => updateFormField("autoCancelOnDisable", event.target.checked)}
                        />
                      }
                      label={t.fieldsAutoCancelOnDisable}
                    />
                  </Box>
                </Box>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={closeSettings} color="inherit" disabled={settingsSaving}>
              {t.cancel}
            </Button>
            <Button
              variant="contained"
              onClick={onSaveSettings}
              disabled={settingsSaving}
              startIcon={settingsSaving ? <AutorenewRoundedIcon className="spin" /> : <SaveRoundedIcon />}
            >
              {settingsSaving ? t.saving : t.save}
            </Button>
          </DialogActions>
        </Dialog>
      </PageWrap>
    </ThemeProvider>
  );
}

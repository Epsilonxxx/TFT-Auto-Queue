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
  sessionCycleCount: 0,
  lastError: null
};

const emptySettings: AppSettings = {
  language: "zh-CN",
  queueId: null,
  leagueInstallPath: null,
  autoCancelOnDisable: true,
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
  leagueInstallPath: string;
  autoCancelOnDisable: boolean;
  pollIntervalSeconds: string;
  postGameDelayMinSeconds: string;
  postGameDelayMaxSeconds: string;
  queueRetryBlockSeconds: string;
  homeResetCooldownSeconds: string;
  reconnectCooldownSeconds: string;
  cycleReconnectTimeoutSeconds: string;
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
     fieldsLeagueInstallPath: "League 安装目录",
     fieldsPollInterval: "轮询间隔",
     fieldsPostGameDelayMin: "结算后最小延迟",
     fieldsPostGameDelayMax: "结算后最大延迟",
     fieldsQueueRetryBlock: "匹配失败等待",
     fieldsHomeResetCooldown: "回主页冷却",
     fieldsReconnectCooldown: "重连冷却",
     fieldsCycleReconnectTimeout: "单局卡死超时",
     fieldsAutoCancelOnDisable: "关闭自动匹配时取消当前搜索",
     generalSection: "基础设置",
     timingSection: "时序设置",
     recoverySection: "恢复设置",
     leagueInstallPathPlaceholder: "留空时自动探测，例如 E:\\Riot Games\\League of Legends",
     queueIdError: "队列 ID 必须是正整数，或留空。",
     positiveNumberError: "请输入大于 0 的数字。",
    maxDelayError: "最大延迟必须大于或等于最小延迟。",
    languageChinese: "简体中文",
    languageEnglish: "English",
    phaseUnknown: "未知",
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
     fieldsLeagueInstallPath: "League Install Path",
     fieldsPollInterval: "Poll Interval",
     fieldsPostGameDelayMin: "Post-game Delay Min",
     fieldsPostGameDelayMax: "Post-game Delay Max",
     fieldsQueueRetryBlock: "Queue Retry Wait",
     fieldsHomeResetCooldown: "Home Reset Cooldown",
     fieldsReconnectCooldown: "Reconnect Cooldown",
     fieldsCycleReconnectTimeout: "Stuck Match Timeout",
     fieldsAutoCancelOnDisable: "Cancel current search when disabling auto queue",
     generalSection: "General",
     timingSection: "Timing",
     recoverySection: "Recovery",
     leagueInstallPathPlaceholder: "Leave blank to auto-detect, for example E:\\Riot Games\\League of Legends",
     queueIdError: "Queue ID must be a positive integer or left blank.",
     positiveNumberError: "Enter a number greater than 0.",
    maxDelayError: "Max delay must be greater than or equal to min delay.",
    languageChinese: "简体中文",
    languageEnglish: "English",
    phaseUnknown: "Unknown",
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

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(1)));
}

function settingsToForm(settings: AppSettings): SettingsFormState {
  return {
    language: settings.language,
    queueId: settings.queueId === null ? "" : String(settings.queueId),
    leagueInstallPath: settings.leagueInstallPath ?? "",
    autoCancelOnDisable: settings.autoCancelOnDisable,
    pollIntervalSeconds: formatSeconds(settings.pollIntervalMs),
    postGameDelayMinSeconds: formatSeconds(settings.postGameDelayMinMs),
    postGameDelayMaxSeconds: formatSeconds(settings.postGameDelayMaxMs),
    queueRetryBlockSeconds: formatSeconds(settings.queueRetryBlockMs),
    homeResetCooldownSeconds: formatSeconds(settings.homeResetCooldownMs),
    reconnectCooldownSeconds: formatSeconds(settings.reconnectCooldownMs),
    cycleReconnectTimeoutSeconds: formatSeconds(settings.cycleReconnectTimeoutMs)
  };
}

function parsePositiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }

  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveMillisecondsFromSeconds(raw: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) {
    return null;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 1000);
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

  const pollIntervalMs = parsePositiveMillisecondsFromSeconds(form.pollIntervalSeconds);
  if (pollIntervalMs === null) {
    errors.pollIntervalSeconds = t.positiveNumberError;
  }

  const postGameDelayMinMs = parsePositiveMillisecondsFromSeconds(form.postGameDelayMinSeconds);
  if (postGameDelayMinMs === null) {
    errors.postGameDelayMinSeconds = t.positiveNumberError;
  }

  const postGameDelayMaxMs = parsePositiveMillisecondsFromSeconds(form.postGameDelayMaxSeconds);
  if (postGameDelayMaxMs === null) {
    errors.postGameDelayMaxSeconds = t.positiveNumberError;
  }

  if (
    postGameDelayMinMs !== null &&
    postGameDelayMaxMs !== null &&
    postGameDelayMinMs > postGameDelayMaxMs
  ) {
    errors.postGameDelayMaxSeconds = t.maxDelayError;
  }

  const queueRetryBlockMs = parsePositiveMillisecondsFromSeconds(form.queueRetryBlockSeconds);
  if (queueRetryBlockMs === null) {
    errors.queueRetryBlockSeconds = t.positiveNumberError;
  }

  const homeResetCooldownMs = parsePositiveMillisecondsFromSeconds(form.homeResetCooldownSeconds);
  if (homeResetCooldownMs === null) {
    errors.homeResetCooldownSeconds = t.positiveNumberError;
  }

  const reconnectCooldownMs = parsePositiveMillisecondsFromSeconds(form.reconnectCooldownSeconds);
  if (reconnectCooldownMs === null) {
    errors.reconnectCooldownSeconds = t.positiveNumberError;
  }

  const cycleReconnectTimeoutMs = parsePositiveMillisecondsFromSeconds(form.cycleReconnectTimeoutSeconds);
  if (cycleReconnectTimeoutMs === null) {
    errors.cycleReconnectTimeoutSeconds = t.positiveNumberError;
  }

  if (Object.keys(errors).length > 0) {
    return { errors, payload: null };
  }

  return {
    errors: {},
    payload: {
      language: form.language,
      queueId,
      leagueInstallPath: form.leagueInstallPath.trim() === "" ? null : form.leagueInstallPath.trim(),
      autoCancelOnDisable: form.autoCancelOnDisable,
      pollIntervalMs: pollIntervalMs ?? undefined,
      postGameDelayMinMs: postGameDelayMinMs ?? undefined,
      postGameDelayMaxMs: postGameDelayMaxMs ?? undefined,
      queueRetryBlockMs: queueRetryBlockMs ?? undefined,
      homeResetCooldownMs: homeResetCooldownMs ?? undefined,
      reconnectCooldownMs: reconnectCooldownMs ?? undefined,
      cycleReconnectTimeoutMs: cycleReconnectTimeoutMs ?? undefined
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

function SettingsSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
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
                <Typography variant="h5">{t.appTitle}</Typography>

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

          {state.lastError ? <Alert severity="error">{state.lastError}</Alert> : null}

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
                <SettingsSection title={t.generalSection}>
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

                    <TextField
                      label={t.fieldsLeagueInstallPath}
                      value={settingsForm.leagueInstallPath}
                      onChange={(event) => updateFormField("leagueInstallPath", event.target.value)}
                      placeholder={t.leagueInstallPathPlaceholder}
                      fullWidth
                    />
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
                </SettingsSection>

                <SettingsSection title={t.timingSection}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 2
                    }}
                  >
                    <TextField
                      label={t.fieldsPollInterval}
                      value={settingsForm.pollIntervalSeconds}
                      onChange={(event) => updateFormField("pollIntervalSeconds", event.target.value)}
                      error={Boolean(settingsErrors.pollIntervalSeconds)}
                      helperText={renderHelperText(settingsErrors.pollIntervalSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsPostGameDelayMin}
                      value={settingsForm.postGameDelayMinSeconds}
                      onChange={(event) => updateFormField("postGameDelayMinSeconds", event.target.value)}
                      error={Boolean(settingsErrors.postGameDelayMinSeconds)}
                      helperText={renderHelperText(settingsErrors.postGameDelayMinSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />

                    <TextField
                      label={t.fieldsPostGameDelayMax}
                      value={settingsForm.postGameDelayMaxSeconds}
                      onChange={(event) => updateFormField("postGameDelayMaxSeconds", event.target.value)}
                      error={Boolean(settingsErrors.postGameDelayMaxSeconds)}
                      helperText={renderHelperText(settingsErrors.postGameDelayMaxSeconds)}
                      fullWidth
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{t.unitSeconds}</InputAdornment>
                      }}
                    />
                  </Box>
                </SettingsSection>

                <SettingsSection title={t.recoverySection}>
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
                </SettingsSection>
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

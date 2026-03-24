import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  CssBaseline,
  Stack,
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
import styled from "styled-components";
import type { ServiceSnapshot } from "./types";

const LOG_LIMIT = 50;

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
    }
  }
});

const PageWrap = styled.div`
  height: 100vh;
  overflow: hidden;
  padding: 16px 0;
`;

const HeaderCard = styled(Card)`
  margin-bottom: 24px;
`;

const LogsPanel = styled(Box)`
  height: 288px;
  border-radius: 14px;
  border: 1px solid #d8e1ef;
  background: linear-gradient(180deg, #0f172a 0%, #111c34 100%);
  color: #dbe7ff;
  padding: 16px 18px;
  font-size: 12px;
  line-height: 1.65;
  overflow: hidden;
  white-space: pre-wrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(15, 23, 42, 0.25);
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

function StatCard({
  title,
  value,
  icon
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
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
        <Typography variant="h5">{value}</Typography>
      </CardContent>
    </Card>
  );
}

export function App() {
  const [state, setState] = useState<ServiceSnapshot>(emptyState);
  const [logs, setLogs] = useState<string[]>([]);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.tftApi.getInitialData().then((data) => {
      if (!mounted) {
        return;
      }
      setState(data.state);
      setLogs(data.logs.slice(-LOG_LIMIT));
    });

    const offState = window.tftApi.onState((next) => setState(next));
    const offLog = window.tftApi.onLog((line) => {
      setLogs((prev) => {
        const next = [...prev, line];
        if (next.length > LOG_LIMIT) {
          next.splice(0, next.length - LOG_LIMIT);
        }
        return next;
      });
    });

    return () => {
      mounted = false;
      offState();
      offLog();
    };
  }, []);

  const statusLabel = state.enabled ? "Running" : "Stopped";
  const logContent = useMemo(() => logs.slice(-12).join("\n"), [logs]);

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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PageWrap>
        <Container
          maxWidth="lg"
          sx={{ height: "100%", display: "flex", flexDirection: "column", gap: 2 }}
        >
          <HeaderCard>
            <CardContent sx={{ p: 3 }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
              >
                <Box>
                  <Typography variant="h5">TFT Auto Queue</Typography>
                </Box>

                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Chip
                    label={statusLabel}
                    color={state.enabled ? "success" : "default"}
                    variant={state.enabled ? "filled" : "outlined"}
                    sx={{ fontWeight: 600 }}
                  />
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
                    sx={{ minWidth: 220 }}
                  >
                    {toggling ? "Applying..." : state.enabled ? "Stop Auto Queue (F1)" : "Start Auto Queue (F1)"}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </HeaderCard>

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
            <Box>
              <StatCard title="Queue" value={state.queueName} icon={<SportsEsportsRoundedIcon fontSize="small" />} />
            </Box>
            <Box>
              <StatCard title="Phase" value={state.phase || "-"} icon={<TimelineRoundedIcon fontSize="small" />} />
            </Box>
            <Box>
              <StatCard
                title="Current Session"
                value={String(state.sessionCycleCount)}
                icon={<RepeatRoundedIcon fontSize="small" />}
              />
            </Box>
            <Box>
              <StatCard
                title="Total Runs"
                value={String(state.totalCycleCount)}
                icon={<FunctionsRoundedIcon fontSize="small" />}
              />
            </Box>
          </Box>

          <Card sx={{ flex: 1, minHeight: 0 }}>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <LogsPanel>{logContent || "No logs yet."}</LogsPanel>
            </CardContent>
          </Card>
        </Container>
      </PageWrap>
    </ThemeProvider>
  );
}

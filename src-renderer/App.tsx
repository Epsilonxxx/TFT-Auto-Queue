import { useEffect, useState } from "react";
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

export function App() {
  const [state, setState] = useState<ServiceSnapshot>(emptyState);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.tftApi.getInitialData().then((data) => {
      if (!mounted) {
        return;
      }
      setState(data.state);
    });

    const offState = window.tftApi.onState((next) => setState(next));
    return () => {
      mounted = false;
      offState();
    };
  }, []);

  const statusLabel = state.enabled ? "Running" : "Stopped";
  const stats = [
    {
      title: "Queue",
      value: state.queueName,
      icon: <SportsEsportsRoundedIcon fontSize="small" />
    },
    {
      title: "Phase",
      value: state.phase || "-",
      icon: <TimelineRoundedIcon fontSize="small" />
    },
    {
      title: "Current Session",
      value: String(state.sessionCycleCount),
      icon: <RepeatRoundedIcon fontSize="small" />
    },
    {
      title: "Total Runs",
      value: String(state.totalCycleCount),
      icon: <FunctionsRoundedIcon fontSize="small" />
    }
  ];

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
                <Typography variant="h5">TFT Auto Queue</Typography>

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
                    {toggling ? "Applying..." : state.enabled ? "Stop Auto Queue (F1)" : "Start Auto Queue (F1)"}
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
      </PageWrap>
    </ThemeProvider>
  );
}

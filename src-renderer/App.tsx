import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Clock3, Gamepad2, ListChecks, Loader2, Power, Waves } from "lucide-react";
import type { ServiceSnapshot } from "./types";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

const LOG_LIMIT = 50;

function StatCard({
  title,
  value,
  hint,
  icon
}: {
  title: string;
  value: string;
  hint?: string;
  icon: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
        <div className="text-slate-400">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        <p className="mt-2 text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

const emptyState: ServiceSnapshot = {
  enabled: false,
  queueId: 0,
  queueName: "-",
  phase: "-",
  cycleCount: 0
};

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

    window.tftApi.onState((next) => {
      setState(next);
    });
    window.tftApi.onLog((line) => {
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
    };
  }, []);

  const statusLabel = state.enabled ? "Running" : "Stopped";
  const statusClass = state.enabled
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-600 border-slate-200";

  const toggleButtonLabel = toggling
    ? "Applying..."
    : state.enabled
      ? "Disable Auto Queue (F1)"
      : "Enable Auto Queue (F1)";

  const logContent = useMemo(() => logs.join("\n"), [logs]);

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
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="surface p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">TFT Auto Queue</h1>
              <p className="mt-2 text-sm text-slate-500">
                Modern queue automation dashboard for Tocker&apos;s Trials.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${statusClass}`}>{statusLabel}</span>
              <Button size="lg" disabled={toggling} onClick={onToggle} className="min-w-52">
                {toggling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                {toggleButtonLabel}
              </Button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Queue" value={state.queueName} hint={`ID: ${state.queueId || "-"}`} icon={<Gamepad2 size={18} />} />
          <StatCard title="Phase" value={state.phase || "-"} hint="Real-time gameflow phase" icon={<Activity size={18} />} />
          <StatCard title="Cycles" value={String(state.cycleCount)} hint="Completed matches in this session" icon={<ListChecks size={18} />} />
          <StatCard title="Delay Range" value="1-2s" hint="Randomized per matchmaking action" icon={<Clock3 size={18} />} />
        </section>

        <Card className="flex min-h-[320px] flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <Waves size={16} className="text-primary" />
              Live Logs (last 50 lines)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[280px] rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              <pre className="h-full overflow-auto whitespace-pre-wrap">{logContent || "No logs yet."}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

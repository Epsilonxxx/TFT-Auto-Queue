import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LcuCredentials = {
  port: number;
  token: string;
};

export type DiscoverLcuCredentialsOptions = {
  leagueInstallPath?: string | null;
};

type ProcessProbe = {
  name?: string;
  commandLine?: string | null;
  executablePath?: string | null;
};

type DiscoveryDependencies = {
  execFileSyncImpl?: typeof execFileSync;
  existsSyncImpl?: typeof fs.existsSync;
  readFileSyncImpl?: typeof fs.readFileSync;
  cwd?: () => string;
  env?: NodeJS.ProcessEnv;
};

function normalizePathValue(filePath: string): string {
  return path.normalize(filePath.replace(/\//g, "\\").trim());
}

function pushCandidate(candidates: string[], seen: Set<string>, filePath: string | null | undefined): void {
  if (!filePath) {
    return;
  }

  const normalized = normalizePathValue(filePath);
  const dedupeKey = normalized.toLowerCase();
  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  candidates.push(normalized);
}

function parseArgument(commandLine: string, key: string): string | null {
  const regex = new RegExp(`--${key}=([^\\s"]+|"[^"]+")`, "i");
  const match = commandLine.match(regex);
  if (!match) {
    return null;
  }
  return match[1].replace(/^"|"$/g, "");
}

function parseFromCommandLine(commandLine: string): LcuCredentials | null {
  const portRaw = parseArgument(commandLine, "app-port");
  const token = parseArgument(commandLine, "remoting-auth-token");
  if (!portRaw || !token) {
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    return null;
  }

  return { port, token };
}

function parseFromLockfile(lockfilePath: string, readFileSyncImpl: typeof fs.readFileSync): LcuCredentials | null {
  const content = readFileSyncImpl(lockfilePath, "utf8").trim();
  const parts = content.split(":");
  if (parts.length < 5) {
    return null;
  }

  const port = Number(parts[2]);
  const token = parts[3];
  if (!Number.isFinite(port) || !token) {
    return null;
  }

  return { port, token };
}

function parseProcessProbeOutput(output: string): ProcessProbe[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as ProcessProbe | ProcessProbe[];
    const probes = Array.isArray(parsed) ? parsed : [parsed];
    return probes.map((probe) => ({
      name: probe.name ?? (probe as { Name?: string }).Name,
      commandLine: probe.commandLine ?? (probe as { CommandLine?: string | null }).CommandLine ?? null,
      executablePath: probe.executablePath ?? (probe as { ExecutablePath?: string | null }).ExecutablePath ?? null
    }));
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((commandLine) => ({ commandLine: commandLine.trim() }))
      .filter((probe) => Boolean(probe.commandLine));
  }
}

function readProcessProbes(execFileSyncImpl: typeof execFileSync): ProcessProbe[] {
  const psCommand = [
    "$procs = Get-CimInstance Win32_Process |",
    "  Where-Object { $_.Name -eq 'LeagueClientUx.exe' -or $_.Name -eq 'LeagueClient.exe' } |",
    "  Select-Object Name, CommandLine, ExecutablePath",
    "if ($null -eq $procs) {",
    "  Write-Output '[]'",
    "} else {",
    "  $procs | ConvertTo-Json -Compress",
    "}"
  ].join(" ");

  const output = execFileSyncImpl("powershell.exe", ["-NoProfile", "-Command", psCommand], {
    encoding: "utf8"
  });

  return parseProcessProbeOutput(output);
}

function resolveLockfileCandidatesFromInstallPath(installPath: string): string[] {
  const resolved = path.resolve(normalizePathValue(installPath));
  const candidates = [path.join(resolved, "lockfile")];
  const baseName = path.basename(resolved).toLowerCase();

  if (baseName === "leagueclient" || baseName === "game") {
    candidates.push(path.join(resolved, "..", "lockfile"));
  }

  return candidates;
}

function readRiotInstallPathsFromProgramData(
  env: NodeJS.ProcessEnv,
  existsSyncImpl: typeof fs.existsSync,
  readFileSyncImpl: typeof fs.readFileSync
): string[] {
  const programDataDir = env.ProgramData ? normalizePathValue(env.ProgramData) : "C:\\ProgramData";
  const riotDataDir = path.join(programDataDir, "Riot Games");
  const installPaths: string[] = [];
  const seen = new Set<string>();

  const installsJsonPath = path.join(riotDataDir, "RiotClientInstalls.json");
  if (existsSyncImpl(installsJsonPath)) {
    try {
      const raw = readFileSyncImpl(installsJsonPath, "utf8");
      const parsed = JSON.parse(raw) as {
        associated_client?: Record<string, string>;
      };

      for (const installPath of Object.keys(parsed.associated_client ?? {})) {
        pushCandidate(installPaths, seen, installPath);
      }
    } catch {
      // ignore malformed metadata
    }
  }

  const productSettingsPath = path.join(
    riotDataDir,
    "Metadata",
    "league_of_legends.live",
    "league_of_legends.live.product_settings.yaml"
  );

  if (existsSyncImpl(productSettingsPath)) {
    try {
      const raw = readFileSyncImpl(productSettingsPath, "utf8");
      const match = raw.match(/^\s*product_install_full_path:\s*"?(.*?)"?\s*$/m);
      if (match?.[1]) {
        pushCandidate(installPaths, seen, match[1]);
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return installPaths;
}

function collectLockfileCandidates(
  options: DiscoverLcuCredentialsOptions,
  processProbes: ProcessProbe[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  existsSyncImpl: typeof fs.existsSync,
  readFileSyncImpl: typeof fs.readFileSync
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const installPathSources = [
    options.leagueInstallPath ?? null,
    ...processProbes
      .map((probe) => probe.executablePath)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((executablePath) => path.dirname(normalizePathValue(executablePath))),
    ...readRiotInstallPathsFromProgramData(env, existsSyncImpl, readFileSyncImpl),
    "C:\\Riot Games\\League of Legends",
    "D:\\Riot Games\\League of Legends"
  ];

  for (const installPath of installPathSources) {
    if (!installPath) {
      continue;
    }

    for (const lockfilePath of resolveLockfileCandidatesFromInstallPath(installPath)) {
      pushCandidate(candidates, seen, lockfilePath);
    }
  }

  pushCandidate(candidates, seen, path.join(cwd, "lockfile"));
  return candidates;
}

export function discoverLcuCredentials(
  options: DiscoverLcuCredentialsOptions = {},
  dependencies: DiscoveryDependencies = {}
): LcuCredentials {
  const execFileSyncImpl = dependencies.execFileSyncImpl ?? execFileSync;
  const existsSyncImpl = dependencies.existsSyncImpl ?? fs.existsSync;
  const readFileSyncImpl = dependencies.readFileSyncImpl ?? fs.readFileSync;
  const cwd = dependencies.cwd ?? (() => process.cwd());
  const env = dependencies.env ?? process.env;

  const processProbes = readProcessProbes(execFileSyncImpl);

  for (const probe of processProbes) {
    if (!probe.commandLine) {
      continue;
    }

    const credentials = parseFromCommandLine(probe.commandLine);
    if (credentials) {
      return credentials;
    }
  }

  const lockfileCandidates = collectLockfileCandidates(
    options,
    processProbes,
    cwd(),
    env,
    existsSyncImpl,
    readFileSyncImpl
  );

  for (const candidate of lockfileCandidates) {
    if (!existsSyncImpl(candidate)) {
      continue;
    }

    const credentials = parseFromLockfile(candidate, readFileSyncImpl);
    if (credentials) {
      return credentials;
    }
  }

  throw new Error("Unable to discover LCU credentials. Start League client first or set the League install path.");
}

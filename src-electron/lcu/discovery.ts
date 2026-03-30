import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LcuCredentials = {
  port: number;
  token: string;
};

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

function parseFromLockfile(lockfilePath: string): LcuCredentials | null {
  if (!fs.existsSync(lockfilePath)) {
    return null;
  }
  const content = fs.readFileSync(lockfilePath, "utf8").trim();
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

function lockfileCandidates(): string[] {
  const candidates = [path.join(process.cwd(), "lockfile")];

  for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
    const drive = String.fromCharCode(code);
    candidates.push(`${drive}:\\Riot Games\\League of Legends\\lockfile`);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\//g, "\\");
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

export function discoverLcuCredentials(): LcuCredentials {
  const psCommand =
    "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine";

  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", psCommand], {
    encoding: "utf8"
  }).trim();

  if (output) {
    for (const line of output.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const creds = parseFromCommandLine(line);
      if (creds) {
        return creds;
      }
    }
  }

  for (const candidate of lockfileCandidates()) {
    const creds = parseFromLockfile(candidate);
    if (creds) {
      return creds;
    }
  }

  throw new Error("Unable to discover LCU credentials. Start League client first.");
}

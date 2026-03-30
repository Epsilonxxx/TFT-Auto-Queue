import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POWER_SHELL_FORCE_QUIT_GAME_SCRIPT = `
$InstallPath = $env:TFT_LEAGUE_INSTALL_PATH

$targetPaths = New-Object System.Collections.Generic.List[string]

function Add-TargetPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return
  }

  try {
    $resolved = [System.IO.Path]::GetFullPath($value).ToLowerInvariant()
    if (-not $targetPaths.Contains($resolved)) {
      [void]$targetPaths.Add($resolved)
    }
  } catch {
    # ignore invalid candidate paths
  }
}

if (-not [string]::IsNullOrWhiteSpace($InstallPath)) {
  Add-TargetPath (Join-Path $InstallPath 'Game\\League of Legends.exe')
  Add-TargetPath (Join-Path $InstallPath 'League of Legends.exe')
}

$candidates = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'League of Legends.exe' -or
    ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().EndsWith('\\game\\league of legends.exe'))
  }

$matched = @(
  $candidates | Where-Object {
    if ($targetPaths.Count -eq 0) {
      return $true
    }

    if ([string]::IsNullOrWhiteSpace($_.ExecutablePath)) {
      return $true
    }

    try {
      $resolved = [System.IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant()
      return $targetPaths.Contains($resolved)
    } catch {
      return $false
    }
  }
)

if ($matched.Count -eq 0) {
  Write-Output 'not_found'
  exit 0
}

foreach ($process in $matched) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 400
Write-Output 'terminated'
`.trim();

export type TerminateGameProcessResult = "terminated" | "not_found" | "error";

export type LeagueGameRecoveryDependencies = {
  execFileImpl?: typeof execFileAsync;
  platform?: NodeJS.Platform;
};

export class LeagueGameRecovery {
  private readonly execFileImpl: typeof execFileAsync;
  private readonly platform: NodeJS.Platform;

  constructor(dependencies: LeagueGameRecoveryDependencies = {}) {
    this.execFileImpl = dependencies.execFileImpl ?? execFileAsync;
    this.platform = dependencies.platform ?? process.platform;
  }

  async terminateLeagueGameProcess(leagueInstallPath?: string | null): Promise<TerminateGameProcessResult> {
    if (this.platform !== "win32") {
      return "not_found";
    }

    try {
      const { stdout } = await this.execFileImpl(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          POWER_SHELL_FORCE_QUIT_GAME_SCRIPT
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            TFT_LEAGUE_INSTALL_PATH: leagueInstallPath?.trim() ?? ""
          }
        }
      );

      const result = stdout.trim().toLowerCase();
      if (result === "terminated" || result === "not_found") {
        return result;
      }

      return "error";
    } catch {
      return "error";
    }
  }
}

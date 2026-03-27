import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class LeagueClientController {
  async restartLeagueClient(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    const script = `
$ErrorActionPreference = 'Stop'
$installRoot = $null
$ux = Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'" | Select-Object -First 1 ExecutablePath
if($ux -and $ux.ExecutablePath){
  $installRoot = Split-Path $ux.ExecutablePath -Parent
}
if(-not $installRoot){
  $candidates = @(
    'C:\\Riot Games\\League of Legends',
    'D:\\Riot Games\\League of Legends'
  )
  foreach($candidate in $candidates){
    if(Test-Path (Join-Path $candidate 'LeagueClient.exe')){
      $installRoot = $candidate
      break
    }
  }
}
if(-not $installRoot){
  Write-Output 'install_missing'
  exit 0
}
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('LeagueClientUx.exe', 'LeagueClientUxRender.exe', 'LeagueClient.exe')
}
foreach($process in $processes){
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 5
$clientExe = Join-Path $installRoot 'LeagueClient.exe'
if(-not (Test-Path $clientExe)){
  Write-Output 'client_missing'
  exit 0
}
Start-Process -FilePath $clientExe | Out-Null
Write-Output 'restarted'
`;

    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], {
        encoding: "utf8"
      });
      return stdout.trim().toLowerCase().includes("restarted");
    } catch {
      return false;
    }
  }
}

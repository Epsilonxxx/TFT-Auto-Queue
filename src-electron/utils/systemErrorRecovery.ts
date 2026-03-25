import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POWER_SHELL_DISMISS_SCRIPT = `
$title = 'System Error'
$titlePattern = 'critical error|process must be terminated|crash dump|troubleshooting this issue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win32Recovery {
  public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, UInt32 Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, UInt32 Msg, IntPtr wParam, IntPtr lParam);
}
"@

$window = [Win32Recovery]::FindWindow($null, $title)
if ($window -eq [IntPtr]::Zero) {
  Write-Output 'not_found'
  exit 0
}

$allTexts = New-Object System.Collections.Generic.List[string]
$buttons = New-Object System.Collections.Generic.List[object]

[Win32Recovery]::EnumChildWindows($window, {
  param($child, $lParam)

  $className = New-Object System.Text.StringBuilder 256
  [void][Win32Recovery]::GetClassName($child, $className, $className.Capacity)
  $classText = $className.ToString()

  $textBuilder = New-Object System.Text.StringBuilder 512
  [void][Win32Recovery]::GetWindowText($child, $textBuilder, $textBuilder.Capacity)
  $text = $textBuilder.ToString()

  if (-not [string]::IsNullOrWhiteSpace($text)) {
    [void]$allTexts.Add($text)
  }

  if ($classText -eq 'Button') {
    $rect = New-Object Win32Recovery+RECT
    if ([Win32Recovery]::GetWindowRect($child, [ref]$rect)) {
      [void]$buttons.Add([pscustomobject]@{
        Handle = $child
        Left = $rect.Left
        Text = $text
      })
    }
  }

  return $true
}, [IntPtr]::Zero) | Out-Null

$joinedText = ($allTexts -join ' ')
if ($joinedText -notmatch $titlePattern) {
  Write-Output 'not_match'
  exit 0
}

[Win32Recovery]::ShowWindow($window, 5) | Out-Null
[Win32Recovery]::SetForegroundWindow($window) | Out-Null
Start-Sleep -Milliseconds 120

if ($buttons.Count -gt 0) {
  $targetButton = $buttons | Sort-Object Left | Select-Object -First 1
  [Win32Recovery]::SendMessage($targetButton.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Write-Output 'dismissed'
  exit 0
}

[Win32Recovery]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output 'closed'
`.trim();

export type SystemErrorRecoveryDependencies = {
  execFileImpl?: typeof execFileAsync;
  platform?: NodeJS.Platform;
};

export type DismissCrashDialogResult = "dismissed" | "closed" | "not_found" | "not_match" | "error";

export class SystemErrorRecovery {
  private readonly execFileImpl: typeof execFileAsync;
  private readonly platform: NodeJS.Platform;

  constructor(dependencies: SystemErrorRecoveryDependencies = {}) {
    this.execFileImpl = dependencies.execFileImpl ?? execFileAsync;
    this.platform = dependencies.platform ?? process.platform;
  }

  async dismissLeagueCrashDialog(): Promise<DismissCrashDialogResult> {
    if (this.platform !== "win32") {
      return "not_found";
    }

    try {
      const { stdout } = await this.execFileImpl(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWER_SHELL_DISMISS_SCRIPT],
        {
          encoding: "utf8",
          windowsHide: true
        }
      );

      const result = stdout.trim().toLowerCase();
      if (
        result === "dismissed" ||
        result === "closed" ||
        result === "not_found" ||
        result === "not_match"
      ) {
        return result;
      }

      return "error";
    } catch {
      return "error";
    }
  }
}

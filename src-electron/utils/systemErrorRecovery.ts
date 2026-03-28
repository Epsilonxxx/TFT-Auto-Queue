import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POWER_SHELL_DISMISS_SCRIPT = `
$windowPatterns = @(
  'system error',
  'critical error',
  'league of legends',
  'riot client',
  'bugsplat',
  '系统错误',
  '严重错误',
  '崩溃'
)
$textPatterns = @(
  'critical error has occurred',
  'process must be terminated',
  'create a crash dump',
  'troubleshooting this issue',
  'memory dump',
  'unexpected exception',
  'serious problem',
  '崩溃转储',
  '内存转储',
  '进程必须终止',
  '无法连接服务器',
  '客户端已崩溃'
)
$preferredButtons = @('No', '否', 'Cancel', '取消', 'Close', '关闭', 'OK', '确定')

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win32Recovery {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

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

function Get-WindowTextValue([IntPtr]$handle, [int]$capacity = 1024) {
  $buffer = New-Object System.Text.StringBuilder $capacity
  [void][Win32Recovery]::GetWindowText($handle, $buffer, $buffer.Capacity)
  return $buffer.ToString()
}

function Get-ClassNameValue([IntPtr]$handle, [int]$capacity = 256) {
  $buffer = New-Object System.Text.StringBuilder $capacity
  [void][Win32Recovery]::GetClassName($handle, $buffer, $buffer.Capacity)
  return $buffer.ToString()
}

function Contains-Pattern([string]$value, [string[]]$patterns) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $false
  }

  $lower = $value.ToLowerInvariant()
  foreach ($pattern in $patterns) {
    if ($lower.Contains($pattern.ToLowerInvariant())) {
      return $true
    }
  }

  return $false
}

$matchedWindow = $null

[Win32Recovery]::EnumWindows({
  param($hWnd, $lParam)

  if (-not [Win32Recovery]::IsWindowVisible($hWnd)) {
    return $true
  }

  $title = Get-WindowTextValue $hWnd 512
  if ([string]::IsNullOrWhiteSpace($title)) {
    return $true
  }

  $texts = New-Object System.Collections.Generic.List[string]
  $buttons = New-Object System.Collections.Generic.List[object]
  [void]$texts.Add($title)

  [Win32Recovery]::EnumChildWindows($hWnd, {
    param($child, $ignored)

    $className = Get-ClassNameValue $child
    $text = Get-WindowTextValue $child

    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$texts.Add($text)
    }

    if ($className -eq 'Button') {
      $rect = New-Object Win32Recovery+RECT
      if ([Win32Recovery]::GetWindowRect($child, [ref]$rect)) {
        [void]$buttons.Add([pscustomobject]@{
          Handle = $child
          Left = $rect.Left
          Text = ($text ?? '').Trim()
        })
      }
    }

    return $true
  }, [IntPtr]::Zero) | Out-Null

  $joinedText = ($texts -join ' ')
  $likelyCrashDialog =
    (Contains-Pattern $title $windowPatterns) -or
    (Contains-Pattern $joinedText $textPatterns)

  if (-not $likelyCrashDialog) {
    return $true
  }

  $script:matchedWindow = [pscustomobject]@{
    Handle = $hWnd
    Title = $title
    Text = $joinedText
    Buttons = $buttons
  }

  return $false
}, [IntPtr]::Zero) | Out-Null

if ($null -eq $matchedWindow) {
  Write-Output 'not_found'
  exit 0
}

[Win32Recovery]::ShowWindow($matchedWindow.Handle, 5) | Out-Null
[Win32Recovery]::SetForegroundWindow($matchedWindow.Handle) | Out-Null
Start-Sleep -Milliseconds 120

$targetButton = $null
foreach ($buttonText in $preferredButtons) {
  $candidate = $matchedWindow.Buttons |
    Where-Object { $_.Text -and $_.Text.Equals($buttonText, [System.StringComparison]::OrdinalIgnoreCase) } |
    Sort-Object Left |
    Select-Object -First 1

  if ($null -ne $candidate) {
    $targetButton = $candidate
    break
  }
}

if ($null -eq $targetButton -and $matchedWindow.Buttons.Count -gt 0) {
  $targetButton = $matchedWindow.Buttons | Sort-Object Left | Select-Object -First 1
}

if ($null -ne $targetButton) {
  [Win32Recovery]::SendMessage($targetButton.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Write-Output 'dismissed'
  exit 0
}

[Win32Recovery]::PostMessage($matchedWindow.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
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

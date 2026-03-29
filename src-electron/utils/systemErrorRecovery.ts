import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POWER_SHELL_CRASH_DIALOG_SCRIPT = `
$windowPatterns = @(
  'system error',
  'critical error',
  'league of legends',
  'riot client',
  'bugsplat',
  'crash dump',
  '系统错误',
  '严重错误',
  '崩溃',
  '崩溃转储'
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
$reportStartPatterns = @(
  'create a crash dump',
  'aid the developers',
  'troubleshooting this issue',
  'take a full memory dump',
  'full memory dump',
  'generate a full memory dump',
  'create a memory dump',
  '创建崩溃转储',
  '生成崩溃转储',
  '完整内存转储',
  '完整内存 dump',
  '创建内存转储'
)
$reportCompletePatterns = @(
  'crash dump was created',
  'copy this path into your clipboard',
  'copy this path to your clipboard',
  'share this file with the development team',
  'please share this file',
  'thank you. a crash dump was created',
  '崩溃转储已创建',
  '已创建崩溃转储',
  '复制此路径',
  '复制到剪贴板',
  '请将此文件提供给开发团队'
)
$preferredButtons = @('Yes', '是', 'OK', '确定', 'Close', '关闭', 'No', '否', 'Cancel', '取消')
$initialWaitMs = 4000
$pollIntervalMs = 1200
$idleExitMs = 2500
$watchAfterReportStartMs = 6 * 60 * 1000

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

function Normalize-UiText([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return ''
  }

  $normalized = $value.ToLowerInvariant().Trim()
  $normalized = $normalized.Replace('&', '')
  $normalized = $normalized.Replace('（', '(').Replace('）', ')')
  $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '[\s\(\)\[\]\{\}]', '')
  return $normalized
}

function Matches-ButtonPreference([string]$buttonText, [string]$preference) {
  $normalizedButton = Normalize-UiText $buttonText
  $normalizedPreference = Normalize-UiText $preference
  if ([string]::IsNullOrWhiteSpace($normalizedButton) -or [string]::IsNullOrWhiteSpace($normalizedPreference)) {
    return $false
  }

  return $normalizedButton -eq $normalizedPreference -or $normalizedButton.StartsWith($normalizedPreference)
}

function Get-DialogKind([string]$title, [string]$text) {
  if ((Contains-Pattern $title @('crash dump')) -or (Contains-Pattern $text $reportCompletePatterns)) {
    return 'report_complete'
  }

  if (Contains-Pattern $text $reportStartPatterns) {
    return 'report_start'
  }

  return 'generic'
}

function Find-MatchedWindow() {
  $script:matchedWindow = $null

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
      Kind = Get-DialogKind $title $joinedText
    }

    return $false
  }, [IntPtr]::Zero) | Out-Null

  return $script:matchedWindow
}

function Select-TargetButton($window) {
  foreach ($buttonText in $preferredButtons) {
    $candidate = $window.Buttons |
      Where-Object { Matches-ButtonPreference $_.Text $buttonText } |
      Sort-Object Left |
      Select-Object -First 1

    if ($null -ne $candidate) {
      return [pscustomobject]@{
        Button = $candidate
        Preference = $buttonText
      }
    }
  }

  if ($window.Buttons.Count -gt 0) {
    return [pscustomobject]@{
      Button = ($window.Buttons | Sort-Object Left | Select-Object -First 1)
      Preference = ''
    }
  }

  return $null
}

$startedAt = [DateTime]::UtcNow
$lastHandledAt = $startedAt
$watchUntil = $startedAt.AddMilliseconds($initialWaitMs)
$handledCount = 0
$reportedCount = 0

while ($true) {
  $matchedWindow = Find-MatchedWindow
  $now = [DateTime]::UtcNow

  if ($null -eq $matchedWindow) {
    if ($handledCount -eq 0 -and $now -lt $watchUntil) {
      Start-Sleep -Milliseconds $pollIntervalMs
      continue
    }

    if ($handledCount -eq 0) {
      Write-Output 'not_found'
      exit 0
    }

    if ($now -lt $watchUntil) {
      Start-Sleep -Milliseconds $pollIntervalMs
      continue
    }

    if (($now - $lastHandledAt).TotalMilliseconds -lt $idleExitMs) {
      Start-Sleep -Milliseconds 300
      continue
    }

    break
  }

  [Win32Recovery]::ShowWindow($matchedWindow.Handle, 5) | Out-Null
  [Win32Recovery]::SetForegroundWindow($matchedWindow.Handle) | Out-Null
  Start-Sleep -Milliseconds 120

  $selection = Select-TargetButton $matchedWindow
  if ($null -ne $selection) {
    [Win32Recovery]::SendMessage($selection.Button.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $handledCount += 1
    $lastHandledAt = [DateTime]::UtcNow

    if ((Matches-ButtonPreference $selection.Button.Text 'Yes') -or (Matches-ButtonPreference $selection.Button.Text '是')) {
      $reportedCount += 1
    }

    if ($matchedWindow.Kind -eq 'report_start') {
      $watchUntil = [DateTime]::UtcNow.AddMilliseconds($watchAfterReportStartMs)
    } elseif ($matchedWindow.Kind -eq 'report_complete') {
      $watchUntil = [DateTime]::UtcNow.AddMilliseconds($idleExitMs)
    } else {
      $watchUntil = [DateTime]::UtcNow.AddMilliseconds([Math]::Max($idleExitMs, $pollIntervalMs))
    }

    Start-Sleep -Milliseconds $pollIntervalMs
    continue
  }

  [Win32Recovery]::PostMessage($matchedWindow.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  $handledCount += 1
  $lastHandledAt = [DateTime]::UtcNow
  $watchUntil = [DateTime]::UtcNow.AddMilliseconds($idleExitMs)
  Start-Sleep -Milliseconds 500
}

if ($reportedCount -gt 0) {
  Write-Output 'reported'
  exit 0
}

if ($handledCount -gt 0) {
  Write-Output 'dismissed'
  exit 0
}

Write-Output 'not_found'
`.trim();

export type SystemErrorRecoveryDependencies = {
  execFileImpl?: typeof execFileAsync;
  platform?: NodeJS.Platform;
};

export type DismissCrashDialogResult = "reported" | "dismissed" | "closed" | "not_found" | "not_match" | "error";

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
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWER_SHELL_CRASH_DIALOG_SCRIPT],
        {
          encoding: "utf8",
          windowsHide: true
        }
      );

      const result = stdout.trim().toLowerCase();
      if (
        result === "reported" ||
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

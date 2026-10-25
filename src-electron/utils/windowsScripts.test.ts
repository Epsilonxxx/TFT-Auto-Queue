import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { SystemErrorRecovery } from "./systemErrorRecovery";
import { LeagueGameRecovery } from "./leagueGameRecovery";

describe.skipIf(process.platform !== "win32")(
  "Windows recovery script compatibility",
  () => {
    it("parses both recovery scripts with Windows PowerShell without executing them", async () => {
      const scripts: string[] = [];
      const execFileImpl = vi.fn(async (_file: string, args: string[]) => {
        const encodedIndex = args.indexOf("-EncodedCommand");
        scripts.push(
          encodedIndex >= 0
            ? Buffer.from(args[encodedIndex + 1], "base64").toString("utf16le")
            : args[args.indexOf("-Command") + 1],
        );
        return { stdout: "not_found", stderr: "" };
      }) as never;
      await new SystemErrorRecovery({
        execFileImpl,
        platform: "win32",
      }).dismissLeagueCrashDialog();
      await new LeagueGameRecovery({
        execFileImpl,
        platform: "win32",
      }).terminateLeagueGameProcess();
      for (const script of scripts) {
        const output = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$tokens = $null; $parseErrors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:TFT_TEST_SCRIPT, [ref]$tokens, [ref]$parseErrors); if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Output $_.Message }; exit 1 }; Write-Output 'valid'",
          ],
          {
            encoding: "utf8",
            windowsHide: true,
            timeout: 10000,
            env: { ...process.env, TFT_TEST_SCRIPT: script },
          },
        );
        expect(output.trim()).toBe("valid");
      }
    });
  },
);

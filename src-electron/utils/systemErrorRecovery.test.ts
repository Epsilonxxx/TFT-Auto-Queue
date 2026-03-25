import { describe, expect, it, vi } from "vitest";
import { SystemErrorRecovery } from "./systemErrorRecovery";

describe("SystemErrorRecovery", () => {
  it("returns a successful dismissal status from PowerShell output", async () => {
    const recovery = new SystemErrorRecovery({
      platform: "win32",
      execFileImpl: vi.fn(async () => ({
        stdout: "dismissed\r\n",
        stderr: ""
      })) as never
    });

    await expect(recovery.dismissLeagueCrashDialog()).resolves.toBe("dismissed");
  });

  it("skips Windows dialog handling on non-Windows platforms", async () => {
    const recovery = new SystemErrorRecovery({
      platform: "darwin",
      execFileImpl: vi.fn(async () => ({
        stdout: "dismissed\r\n",
        stderr: ""
      })) as never
    });

    await expect(recovery.dismissLeagueCrashDialog()).resolves.toBe("not_found");
  });

  it("maps command failures to an error result", async () => {
    const recovery = new SystemErrorRecovery({
      platform: "win32",
      execFileImpl: vi.fn(async () => {
        throw new Error("boom");
      }) as never
    });

    await expect(recovery.dismissLeagueCrashDialog()).resolves.toBe("error");
  });
});

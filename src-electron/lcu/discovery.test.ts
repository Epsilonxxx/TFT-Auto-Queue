import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(), readFileSync: vi.fn() },
}));

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { discoverLcuCredentials } from "./discovery";

afterEach(() => vi.resetAllMocks());

describe("LCU discovery fallback", () => {
  it("reads credentials from a quoted command line without exposing the token", () => {
    vi.mocked(execFileSync).mockReturnValue(
      '"E:\\Riot Games\\LeagueClientUx.exe" --app-port=54321 --remoting-auth-token="test-token"',
    );
    expect(discoverLcuCredentials()).toEqual({
      port: 54321,
      token: "test-token",
    });
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("continues to an E-drive lockfile if process discovery is denied", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Access denied");
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (file) => String(file) === "E:\\Riot Games\\League of Legends\\lockfile",
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      "LeagueClient:100:54321:test-token:https",
    );
    expect(discoverLcuCredentials()).toEqual({
      port: 54321,
      token: "test-token",
    });
  });

  it("skips an unreadable lockfile and an invalid port before checking the next drive", () => {
    vi.mocked(execFileSync).mockReturnValue(
      "--app-port=70000 --remoting-auth-token=invalid",
    );
    vi.mocked(fs.existsSync).mockImplementation((file) =>
      /^[CDE]:/.test(String(file)),
    );
    vi.mocked(fs.readFileSync).mockImplementation(((file: string) => {
      if (file.startsWith("C:")) throw new Error("File locked");
      return file.startsWith("D:")
        ? "LeagueClient:100:0:test:https"
        : "LeagueClient:100:54321:test-token:https";
    }) as typeof fs.readFileSync);
    expect(discoverLcuCredentials()).toEqual({
      port: 54321,
      token: "test-token",
    });
  });
});

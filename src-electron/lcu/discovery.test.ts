import { describe, expect, it } from "vitest";
import { discoverLcuCredentials } from "./discovery";

function createDependencies(options: {
  processOutput: string;
  files?: Record<string, string>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const files = new Map(
    Object.entries(options.files ?? {}).map(([filePath, content]) => [filePath.toLowerCase(), content])
  );

  return {
    execFileSyncImpl: () => options.processOutput,
    existsSyncImpl: (filePath: string) => files.has(filePath.toLowerCase()),
    readFileSyncImpl: (filePath: string) => {
      const value = files.get(filePath.toLowerCase());
      if (value === undefined) {
        throw new Error(`Unexpected read: ${filePath}`);
      }
      return value;
    },
    cwd: () => options.cwd ?? "D:\\CODEX\\TFT-Auto-Queue-git",
    env: options.env ?? { ProgramData: "C:\\ProgramData" }
  };
}

describe("discoverLcuCredentials", () => {
  it("reads credentials directly from the running client command line", () => {
    const credentials = discoverLcuCredentials(
      {},
      createDependencies({
        processOutput:
          '[{"Name":"LeagueClientUx.exe","CommandLine":"\\"E:\\\\Riot Games\\\\League of Legends\\\\LeagueClientUx.exe\\" --app-port=52341 --remoting-auth-token=secret-token","ExecutablePath":"E:\\\\Riot Games\\\\League of Legends\\\\LeagueClientUx.exe"}]'
      })
    );

    expect(credentials).toEqual({
      port: 52341,
      token: "secret-token"
    });
  });

  it("falls back to the configured install path lockfile when command-line credentials are unavailable", () => {
    const credentials = discoverLcuCredentials(
      {
        leagueInstallPath: "E:\\Riot Games\\League of Legends"
      },
      createDependencies({
        processOutput:
          '[{"Name":"LeagueClientUx.exe","CommandLine":"\\"E:\\\\Riot Games\\\\League of Legends\\\\LeagueClientUx.exe\\"","ExecutablePath":"E:\\\\Riot Games\\\\League of Legends\\\\LeagueClientUx.exe"}]',
        files: {
          "E:\\Riot Games\\League of Legends\\lockfile": "LeagueClient:1234:61234:lock-token:https"
        }
      })
    );

    expect(credentials).toEqual({
      port: 61234,
      token: "lock-token"
    });
  });

  it("falls back to Riot ProgramData metadata when the install path is not configured", () => {
    const credentials = discoverLcuCredentials(
      {},
      createDependencies({
        processOutput: "[]",
        files: {
          "C:\\ProgramData\\Riot Games\\RiotClientInstalls.json":
            '{"associated_client":{"E:/Riot Games/League of Legends/":"E:/Riot Games/Riot Client/RiotClientServices.exe"}}',
          "E:\\Riot Games\\League of Legends\\lockfile": "LeagueClient:1234:60000:metadata-token:https"
        }
      })
    );

    expect(credentials).toEqual({
      port: 60000,
      token: "metadata-token"
    });
  });
});

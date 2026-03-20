import https from "node:https";
import { Buffer } from "node:buffer";
import axios, { AxiosInstance } from "axios";
import WebSocket from "ws";
import { LcuCredentials } from "./discovery";

export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "InProgress"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | "Reconnect"
  | "TerminatedInError";

export class LcuClient {
  private readonly api: AxiosInstance;
  private ws: WebSocket | null = null;
  private readonly credentials: LcuCredentials;

  constructor(credentials: LcuCredentials) {
    this.credentials = credentials;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    this.api = axios.create({
      baseURL: `https://127.0.0.1:${credentials.port}`,
      httpsAgent,
      auth: { username: "riot", password: credentials.token },
      timeout: 8000
    });
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.api.get<T>(path);
    return res.data;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.api.post<T>(path, body ?? {});
    return res.data;
  }

  async delete<T>(path: string): Promise<T> {
    const res = await this.api.delete<T>(path);
    return res.data;
  }

  connectGameflowEvents(onPhase: (phase: GameflowPhase) => void): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    const authToken = Buffer.from(`riot:${this.credentials.token}`).toString("base64");
    this.ws = new WebSocket(`wss://127.0.0.1:${this.credentials.port}/`, {
      rejectUnauthorized: false,
      headers: { Authorization: `Basic ${authToken}` }
    });
    this.ws.on("open", () => {
      this.ws?.send(JSON.stringify([5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]));
    });
    this.ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (!Array.isArray(payload) || payload.length < 3) {
          return;
        }
        const phase = payload[2]?.data as GameflowPhase | undefined;
        if (typeof phase === "string") {
          onPhase(phase);
        }
      } catch {
        // ignore
      }
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export interface TwitchStatus {
  configured: boolean;
  state:
    | "disabled"
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "needs_auth"
    | "error";
  channel: string | null;
  lastMessageAt: number | null;
  reconnects: number;
  gap: boolean;
  message: string;
}

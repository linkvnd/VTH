export interface RoomState {
  players: number;
  bet: number;
}

export interface RoomStats {
  kills: number;
  survives: number;
  lastKillRound: number | null;
  lastPlayers: number;
  lastBet: number;
}

export interface BetRecord {
  issue: number;
  room: number;
  amount: number;
  time: string;
  result: string;
  algo: string;
  settled?: boolean;
  killedRoom?: number;
}

export type SelectionMode = "VIP50" | "VIP100" | "VIP500" | "VIP1000" | "VIP5000" | "VIP10000" | "VIP_ADAPTIVE";

export const ROOM_NAMES: Record<number, string> = {
  1: "📦 Nhà kho",
  2: "🪑 Phòng họp",
  3: "👔 Phòng giám đốc",
  4: "💬 Phòng trò chuyện",
  5: "🎥 Phòng giám sát",
  6: "🏢 Văn phòng",
  7: "💰 Phòng tài vụ",
  8: "👥 Phòng nhân sự"
};

export const ROOM_ORDER = [1, 2, 3, 4, 5, 6, 7, 8];

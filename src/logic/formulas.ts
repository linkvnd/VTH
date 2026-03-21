import { RoomState, RoomStats, SelectionMode, ROOM_ORDER, BetRecord } from "../types";

// Simple deterministic random generator to match Python's seed behavior if needed
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  uniform(min: number, max: number) {
    return min + this.next() * (max - min);
  }
}

interface FormulaWeights {
  players: number;
  bet: number;
  bpp: number;
  survive: number;
  recent: number;
  last: number;
  hot: number;
  cold: number;
}

interface Formula {
  w: FormulaWeights;
  noise: number;
  adapt: number;
}

export let FORMULAS: Formula[] = [];
const FORMULA_SEED = 1234567;

function getRoomFeatures(
  rid: number,
  roomState: Record<number, RoomState>,
  roomStats: Record<number, RoomStats>,
  betHistory: BetRecord[],
  lastKilledRoom: number | null,
  avoidLastKill: boolean
) {
  const st = roomState[rid] || { players: 0, bet: 0 };
  const stats = roomStats[rid] || { kills: 0, survives: 0, lastKillRound: null };
  
  const players = st.players;
  const bet = st.bet;
  const betPerPlayer = players > 0 ? bet / players : bet;

  // Normalization with refined scales
  const playersNorm = Math.min(1.0, players / 40.0);
  const betNorm = 1.0 / (1.0 + bet / 1500.0);
  const bppNorm = 1.0 / (1.0 + betPerPlayer / 1000.0);

  const killCount = stats.kills;
  const surviveCount = stats.survives;
  const killRate = (killCount + 0.5) / (killCount + surviveCount + 1.0);
  const surviveScore = 1.0 - killRate;

  // Trend analysis: check if this room is becoming "safer" or "riskier"
  const recentHistory = betHistory.slice(-20);
  let recentPen = 0.0;
  let trendScore = 0.0;
  
  recentHistory.reverse().forEach((rec, i) => {
    const weight = 1.0 / (i + 1);
    if (rec.room === rid) {
      recentPen += 0.15 * weight;
    }
    // If the room was safe in recent rounds, increase trend score
    if (rec.result === "Thắng" && rec.room === rid) {
      trendScore += 0.05 * weight;
    }
  });

  let lastPen = 0.0;
  if (lastKilledRoom === rid) {
    lastPen = avoidLastKill ? 0.45 : 0.0;
  }

  const hotScore = Math.max(0.0, surviveScore - 0.15) + trendScore;
  const coldScore = Math.max(0.0, killRate - 0.35);

  return {
    playersNorm,
    betNorm,
    bppNorm,
    surviveScore,
    recentPen,
    lastPen,
    hotScore,
    coldScore,
  };
}

export function initFormulas(mode: SelectionMode) {
  const rng = new SeededRandom(FORMULA_SEED);
  const formulas: Formula[] = [];

  function mkFormula(bias: "normal" | "hot" | "cold" | "trend" | "noise" = "normal") {
    const w: FormulaWeights = {
      players: rng.uniform(0.1, 0.9),
      bet: rng.uniform(0.1, 0.7),
      bpp: rng.uniform(0.05, 0.7),
      survive: rng.uniform(0.1, 0.5),
      recent: rng.uniform(0.05, 0.4),
      last: rng.uniform(0.1, 0.7),
      hot: rng.uniform(0.0, 0.4),
      cold: rng.uniform(0.0, 0.4),
    };
    let noise = rng.uniform(0.01, 0.05);

    if (bias === "hot") {
      w.hot += rng.uniform(0.3, 0.6);
      w.survive += rng.uniform(0.1, 0.3);
      w.players -= 0.2;
    } else if (bias === "cold") {
      w.cold += rng.uniform(0.3, 0.6);
      w.last += rng.uniform(0.1, 0.3);
      w.bet -= 0.2;
    } else if (bias === "trend") {
      w.recent += rng.uniform(0.3, 0.5);
      w.survive += rng.uniform(0.2, 0.4);
    } else if (bias === "noise") {
      noise = rng.uniform(0.1, 0.25);
    }
    
    return { w, noise, adapt: 1.0 };
  }

  if (mode === "VIP50") {
    for (let i = 0; i < 50; i++) formulas.push(mkFormula("normal"));
  } else if (mode === "VIP100") {
    for (let i = 0; i < 100; i++) formulas.push(mkFormula(i % 2 === 0 ? "hot" : "normal"));
  } else if (mode === "VIP500") {
    for (let i = 0; i < 500; i++) formulas.push(mkFormula(i % 3 === 0 ? "cold" : "normal"));
  } else if (mode === "VIP1000") {
    for (let i = 0; i < 1000; i++) formulas.push(mkFormula(i % 4 === 0 ? "trend" : "normal"));
  } else if (mode === "VIP5000") {
    for (let i = 0; i < 5000; i++) formulas.push(mkFormula(i % 5 === 0 ? "noise" : "normal"));
  } else if (mode === "VIP10000") {
    for (let i = 0; i < 10000; i++) {
      const b = i % 5 === 0 ? "hot" : i % 5 === 1 ? "cold" : i % 5 === 2 ? "trend" : i % 5 === 3 ? "noise" : "normal";
      formulas.push(mkFormula(b as any));
    }
  } else if (mode === "VIP_ADAPTIVE") {
    // AI Mode starts with a diverse set and learns over time
    for (let i = 0; i < 1000; i++) {
      const b = i % 4 === 0 ? "hot" : i % 4 === 1 ? "cold" : i % 4 === 2 ? "trend" : "normal";
      formulas.push(mkFormula(b as any));
    }
  }

  FORMULAS = formulas;
}

export function chooseRoom(
  mode: SelectionMode,
  roomState: Record<number, RoomState>,
  roomStats: Record<number, RoomStats>,
  betHistory: BetRecord[],
  lastKilledRoom: number | null,
  avoidLastKill: boolean
): { roomId: number; algo: string } {
  if (FORMULAS.length === 0) initFormulas(mode);

  const aggScores: Record<number, number> = {};
  ROOM_ORDER.forEach(r => aggScores[r] = 0.0);

  FORMULAS.forEach((fentry, idx) => {
    const weights = fentry.w;
    const adapt = fentry.adapt;
    const noiseScale = fentry.noise;
    let bestRoom = ROOM_ORDER[0];
    let bestScore = -Infinity;

    ROOM_ORDER.forEach(r => {
      const f = getRoomFeatures(r, roomState, roomStats, betHistory, lastKilledRoom, avoidLastKill);
      let score = 0.0;
      score += weights.players * f.playersNorm;
      score += weights.bet * f.betNorm;
      score += weights.bpp * f.bppNorm;
      score += weights.survive * f.surviveScore;
      score -= weights.recent * f.recentPen;
      score -= weights.last * f.lastPen;
      score += weights.hot * f.hotScore;
      score -= weights.cold * f.coldScore;

      // Deterministic noise
      const noise = (Math.sin((idx + 1) * (r + 1) * 12.9898) * 43758.5453) % 1.0;
      score += (noise - 0.5) * (noiseScale * 2.0);
      score *= adapt;

      if (score > bestScore) {
        bestScore = score;
        bestRoom = r;
      }
    });

    aggScores[bestRoom] += bestScore;
  });

  const n = Math.max(1, FORMULAS.length);
  ROOM_ORDER.forEach(r => {
    aggScores[r] /= n;
    const f = getRoomFeatures(r, roomState, roomStats, betHistory, lastKilledRoom, avoidLastKill);
    aggScores[r] += 0.02 * f.hotScore;
    aggScores[r] -= 0.02 * f.coldScore;
  });

  const ranked = Object.entries(aggScores).sort((a, b) => b[1] - a[1]);
  return { roomId: parseInt(ranked[0][0]), algo: mode };
}

export function updateFormulasAfterResult(
  predictedRoom: number | null,
  killedRoom: number | null,
  mode: SelectionMode,
  roomState: Record<number, RoomState>,
  roomStats: Record<number, RoomStats>,
  betHistory: BetRecord[],
  lastKilledRoom: number | null,
  avoidLastKill: boolean,
  lr: number = 0.12
) {
  if (mode !== "VIP_ADAPTIVE" || !FORMULAS.length || predictedRoom === null || killedRoom === null) return;

  const votesForPred: number[] = [];
  const votesForKilled: number[] = [];

  FORMULAS.forEach((fentry, idx) => {
    const weights = fentry.w;
    let bestRoom = ROOM_ORDER[0];
    let bestScore = -Infinity;

    ROOM_ORDER.forEach(r => {
      const f = getRoomFeatures(r, roomState, roomStats, betHistory, lastKilledRoom, avoidLastKill);
      let score = 0.0;
      score += weights.players * f.playersNorm;
      score += weights.bet * f.betNorm;
      score += weights.bpp * f.bppNorm;
      score += weights.survive * f.surviveScore;
      score -= weights.recent * f.recentPen;
      score -= weights.last * f.lastPen;
      score += weights.hot * f.hotScore;
      score -= weights.cold * f.coldScore;

      if (score > bestScore) {
        bestScore = score;
        bestRoom = r;
      }
    });

    if (bestRoom === predictedRoom) votesForPred.push(idx);
    if (bestRoom === killedRoom) votesForKilled.push(idx);
  });

  const win = predictedRoom !== killedRoom;

  FORMULAS.forEach((fentry, idx) => {
    let aw = fentry.adapt;
    if (win) {
      if (votesForPred.includes(idx)) aw *= (1.0 + lr);
      if (votesForKilled.includes(idx)) aw *= (1.0 - lr * 0.6);
    } else {
      if (votesForPred.includes(idx)) aw = Math.max(0.1, aw * (1.0 - lr));
      if (votesForKilled.includes(idx)) aw *= (1.0 + lr * 0.6);
    }
    fentry.adapt = Math.min(Math.max(aw, 0.1), 5.0);
  });
}

// Match state: one object owns the round flow, the score, the money and the
// kill feed, so the loop in main.js and the HUD both read the same truth.
// Phases: title -> buy -> round -> roundEnd -> (buy | matchEnd).
import { MATCH, ECONOMY } from './config.js';

export function createMatch() {
  return {
    phase: 'title',
    round: 1,
    score: { atk: 0, def: 0 },
    timer: 0,
    buyTimer: 0,
    roundEndTimer: 0,
    roundEndReason: '',
    roundWinner: null,
    matchWinner: null,
    matchDraw: false,
    money: ECONOMY.startMoney,
    lossStreak: 0,
    charge: {
      state: 'carried', // carried | planted | defused | exploded
      site: null,
      carrierId: 'player',
      plantT: 0, // fuse countdown while planted
      pos: null,
    },
    feed: [], // {text, cls, at} newest first, capped
    lastKiller: null,
  };
}

export function addFeed(match, text, cls) {
  match.feed.unshift({ text, cls: cls || '', at: match.round });
  if (match.feed.length > 6) match.feed.pop();
}

export function startBuyPhase(match) {
  match.phase = 'buy';
  match.buyTimer = MATCH.buyTime;
  match.charge.state = 'carried';
  match.charge.site = null;
  match.charge.carrierId = 'player';
  match.charge.plantT = 0;
  match.charge.pos = null;
}

export function startRound(match) {
  match.phase = 'round';
  match.timer = MATCH.roundTime;
}

// Who won the round and why. Returns {winner, reason} or null (round goes on).
export function checkRoundEnd(match, bots, playerAlive) {
  if (match.phase !== 'round') return null;
  const atkAlive = bots.some((b) => b.team === 'atk' && b.alive) || playerAlive;
  const defAlive = bots.some((b) => b.team === 'def' && b.alive);
  if (!defAlive) return { winner: 'atk', reason: 'ENEMY TEAM ELIMINATED' };
  if (!atkAlive) return { winner: 'def', reason: 'YOUR TEAM ELIMINATED' };
  if (match.charge.state === 'exploded') return { winner: 'atk', reason: 'CHARGE DETONATED' };
  if (match.charge.state === 'defused') return { winner: 'def', reason: 'CHARGE DEFUSED' };
  if (match.timer <= 0) {
    return match.charge.state === 'planted'
      ? { winner: 'atk', reason: 'CHARGE DETONATED' }
      : { winner: 'def', reason: 'TIME EXPIRED — CHARGE NOT PLANTED' };
  }
  return null;
}

export function endRound(match, result) {
  match.phase = 'roundEnd';
  match.roundEndTimer = MATCH.roundEndTime;
  match.roundWinner = result.winner;
  match.roundEndReason = result.reason;
  match.score[result.winner] += 1;
  const playerWon = result.winner === 'atk';
  // Economy: winners get the win bonus, losers the loss bonus (growing with
  // the streak so a losing run can still buy back in).
  if (playerWon) {
    match.money = Math.min(ECONOMY.maxMoney, match.money + ECONOMY.winReward);
    match.lossStreak = 0;
  } else {
    const bonus = ECONOMY.lossReward + Math.min(2, match.lossStreak) * ECONOMY.lossStreakBonus;
    match.money = Math.min(ECONOMY.maxMoney, match.money + bonus);
    match.lossStreak += 1;
  }
  return playerWon;
}

export function advanceAfterRound(match) {
  if (match.score.atk >= MATCH.winsToTake || match.score.def >= MATCH.winsToTake) {
    match.phase = 'matchEnd';
    match.matchWinner = match.score.atk > match.score.def ? 'atk' : 'def';
    return 'matchEnd';
  }
  if (match.round >= MATCH.maxRounds) {
    match.phase = 'matchEnd';
    match.matchDraw = match.score.atk === match.score.def;
    match.matchWinner = match.matchDraw ? null : (match.score.atk > match.score.def ? 'atk' : 'def');
    return 'matchEnd';
  }
  match.round += 1;
  startBuyPhase(match);
  return 'buy';
}

export function awardKill(match) {
  match.money = Math.min(ECONOMY.maxMoney, match.money + ECONOMY.killReward);
}

export function awardPlant(match) {
  match.money = Math.min(ECONOMY.maxMoney, match.money + ECONOMY.plantReward);
}

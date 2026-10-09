// Regras da patota: jogadores, dias de jogo, times, partidas e gols.
//
// Arquivos guardados:
//   config.json          { name }
//   players.json         { players: [{ id, name, nickname, position, active, createdAt }] }
//   days/<id>.json       um dia de jogo, com presença, times e partidas

import { read, write, remove, listKeys, mutate } from './store.js';
import { HttpError, newId } from './http.js';

export const TEAM_COLORS = ['vermelho', 'azul', 'preto', 'branco', 'verde', 'amarelo', 'laranja', 'roxo'];
export const POSITIONS = ['Linha', 'Goleiro'];
const DEFAULT_NAME = 'Patota de Terça';

const CONFIG = 'config.json';
const PLAYERS = 'players.json';
const dayKey = (id) => `days/${id}.json`;
const DAY_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]{4,12}$/;

const now = () => new Date().toISOString();
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fail = (status, message) => {
  throw new HttpError(status, message);
};

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

// ---------- Leitura ----------

export async function getConfig() {
  return (await read(CONFIG))?.data ?? { name: DEFAULT_NAME };
}

export async function getPlayers() {
  return (await read(PLAYERS))?.data?.players ?? [];
}

export async function getDay(id) {
  if (!DAY_ID.test(id ?? '')) fail(404, 'Dia de jogo não encontrado.');
  const day = (await read(dayKey(id)))?.data;
  if (!day) fail(404, 'Dia de jogo não encontrado.');
  return day;
}

export async function getDays() {
  const keys = (await listKeys('days/')).filter((k) => k.endsWith('.json'));
  const days = await Promise.all(keys.map(async (k) => (await read(k))?.data));
  return days
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

// ---------- Configuração ----------

export async function setPatotaName(input) {
  const name = text(input.name, 40);
  if (!name) fail(400, 'Informe o nome da patota.');
  return mutate(CONFIG, (config) => ({ ...config, name }), { name: DEFAULT_NAME });
}

// ---------- Jogadores ----------

function playedAny(days, playerId) {
  return days.some(
    (d) =>
      d.presentes.includes(playerId) ||
      d.matches.some((m) => m.goals.some((g) => g.playerId === playerId)),
  );
}

export async function playersOp(input) {
  const { op } = input;

  if (op === 'save') {
    const p = input.player ?? {};
    const name = text(p.name, 40);
    const nickname = text(p.nickname, 20);
    const position = POSITIONS.includes(p.position) ? p.position : 'Linha';
    if (!name) fail(400, 'Informe o nome do jogador.');

    let saved;
    const data = await mutate(
      PLAYERS,
      (data) => {
        const label = (x) => (x.nickname || x.name).toLowerCase();
        const clash = data.players.find(
          (x) => x.id !== p.id && label(x) === (nickname || name).toLowerCase(),
        );
        if (clash) fail(409, `Já existe um jogador chamado ${clash.nickname || clash.name}.`);

        if (p.id) {
          const existing = data.players.find((x) => x.id === p.id);
          if (!existing) fail(404, 'Jogador não encontrado.');
          Object.assign(existing, { name, nickname, position });
          saved = existing;
        } else {
          if (data.players.length >= 300) fail(400, 'Limite de jogadores atingido.');
          saved = { id: newId(), name, nickname, position, active: true, createdAt: now() };
          data.players.push(saved);
        }
        return data;
      },
      { players: [] },
    );
    return { players: data.players, player: saved };
  }

  if (op === 'setActive') {
    const data = await mutate(PLAYERS, (data) => {
      const player = data.players.find((x) => x.id === input.id);
      if (!player) fail(404, 'Jogador não encontrado.');
      player.active = Boolean(input.active);
      return data;
    });
    if (!data) fail(404, 'Jogador não encontrado.');
    return { players: data.players };
  }

  if (op === 'delete') {
    // Quem já jogou não é apagado, só desativado, para não sumir das estatísticas.
    const hasHistory = playedAny(await getDays(), input.id);
    const data = await mutate(PLAYERS, (data) => {
      const player = data.players.find((x) => x.id === input.id);
      if (!player) fail(404, 'Jogador não encontrado.');
      if (hasHistory) player.active = false;
      else data.players = data.players.filter((x) => x.id !== input.id);
      return data;
    });
    if (!data) fail(404, 'Jogador não encontrado.');
    return { players: data.players, deactivated: hasHistory };
  }

  fail(400, 'Operação desconhecida.');
}

// ---------- Dias de jogo ----------

const teamPlayers = (day, teamId) => day.teams.find((t) => t.id === teamId)?.playerIds ?? [];

// Enquanto a partida está rolando, o elenco dela acompanha o time do dia.
function syncLiveRosters(day) {
  for (const m of day.matches) {
    if (m.status !== 'live') continue;
    m.rosterA = [...teamPlayers(day, m.teamA)];
    m.rosterB = [...teamPlayers(day, m.teamB)];
  }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function findMatch(day, matchId) {
  const match = day.matches.find((m) => m.id === matchId);
  if (!match) fail(404, 'Partida não encontrada.');
  return match;
}

function applyDayOp(day, input, players, result) {
  const isPresent = (id) => day.presentes.includes(id);

  switch (input.op) {
    case 'setPresence': {
      const player = players.find((p) => p.id === input.playerId);
      if (!player) fail(404, 'Jogador não encontrado.');
      if (input.present) {
        if (!isPresent(player.id)) day.presentes.push(player.id);
      } else {
        day.presentes = day.presentes.filter((id) => id !== player.id);
        for (const t of day.teams) t.playerIds = t.playerIds.filter((id) => id !== player.id);
      }
      break;
    }

    case 'addTeam': {
      if (day.teams.length >= TEAM_COLORS.length) fail(400, 'Limite de times atingido.');
      const used = new Set(day.teams.map((t) => t.color));
      const color = TEAM_COLORS.includes(input.color) && !used.has(input.color)
        ? input.color
        : TEAM_COLORS.find((c) => !used.has(c));
      day.teams.push({ id: newId(), color, playerIds: [] });
      break;
    }

    case 'removeTeam': {
      if (day.matches.some((m) => m.teamA === input.teamId || m.teamB === input.teamId)) {
        fail(409, 'Esse time já tem partida registrada e não pode ser removido.');
      }
      day.teams = day.teams.filter((t) => t.id !== input.teamId);
      break;
    }

    case 'assignPlayer': {
      if (!isPresent(input.playerId)) fail(400, 'Marque a presença do jogador primeiro.');
      if (input.teamId && !day.teams.some((t) => t.id === input.teamId)) fail(404, 'Time não encontrado.');
      for (const t of day.teams) t.playerIds = t.playerIds.filter((id) => id !== input.playerId);
      if (input.teamId) day.teams.find((t) => t.id === input.teamId).playerIds.push(input.playerId);
      break;
    }

    case 'drawTeams': {
      if (day.teams.length < 2) fail(400, 'Crie pelo menos dois times para sortear.');
      const byId = new Map(players.map((p) => [p.id, p]));
      const keepers = shuffle(day.presentes.filter((id) => byId.get(id)?.position === 'Goleiro'));
      const others = shuffle(day.presentes.filter((id) => byId.get(id)?.position !== 'Goleiro'));
      for (const t of day.teams) t.playerIds = [];
      // Goleiros primeiro, um por time; depois o resto, sempre no time com menos gente.
      for (const id of [...keepers, ...others]) {
        const smallest = day.teams.reduce((a, b) => (b.playerIds.length < a.playerIds.length ? b : a));
        smallest.playerIds.push(id);
      }
      break;
    }

    case 'addMatch': {
      const { teamA, teamB } = input;
      if (!teamA || !teamB || teamA === teamB) fail(400, 'Escolha dois times diferentes.');
      if (![teamA, teamB].every((id) => day.teams.some((t) => t.id === id))) fail(404, 'Time não encontrado.');
      if (day.matches.length >= 80) fail(400, 'Limite de partidas do dia atingido.');
      const n = day.matches.reduce((max, m) => Math.max(max, m.n), 0) + 1;
      day.matches.push({
        id: newId(),
        n,
        teamA,
        teamB,
        rosterA: [],
        rosterB: [],
        goals: [],
        status: 'live',
        startedAt: now(),
        endedAt: null,
      });
      break;
    }

    case 'goal': {
      const match = findMatch(day, input.matchId);
      if (match.status !== 'live') fail(409, 'Essa partida já foi encerrada. Reabra para corrigir.');
      if (!['A', 'B'].includes(input.side)) fail(400, 'Time inválido.');
      const playerId = input.playerId ?? null;
      if (playerId && !isPresent(playerId)) fail(400, 'Esse jogador não está na lista de presença.');
      if (match.goals.length >= 99) fail(400, 'Limite de gols da partida atingido.');
      const goal = { id: newId(), side: input.side, playerId, at: now() };
      match.goals.push(goal);
      result.goalId = goal.id;
      break;
    }

    case 'undoGoal': {
      const match = findMatch(day, input.matchId);
      match.goals = match.goals.filter((g) => g.id !== input.goalId);
      break;
    }

    case 'finishMatch': {
      const match = findMatch(day, input.matchId);
      match.status = 'done';
      match.endedAt = now();
      break;
    }

    case 'reopenMatch': {
      const match = findMatch(day, input.matchId);
      match.status = 'live';
      match.endedAt = null;
      break;
    }

    case 'deleteMatch': {
      findMatch(day, input.matchId);
      day.matches = day.matches.filter((m) => m.id !== input.matchId);
      break;
    }

    default:
      fail(400, 'Operação desconhecida.');
  }

  syncLiveRosters(day);
  day.updatedAt = now();
  return day;
}

export async function dayOp(input) {
  if (input.op === 'create') {
    if (!validDate(input.date)) fail(400, 'Data inválida.');
    const id = `${input.date}-${newId().slice(0, 6)}`;
    const day = {
      id,
      date: input.date,
      presentes: [],
      teams: [
        { id: newId(), color: 'vermelho', playerIds: [] },
        { id: newId(), color: 'azul', playerIds: [] },
      ],
      matches: [],
      createdAt: now(),
      updatedAt: now(),
    };
    await write(dayKey(id), day, null);
    return { day };
  }

  if (!DAY_ID.test(input.id ?? '')) fail(404, 'Dia de jogo não encontrado.');

  if (input.op === 'delete') {
    await remove(dayKey(input.id));
    return { deleted: true };
  }

  const players = await getPlayers();
  const result = {};
  const day = await mutate(dayKey(input.id), (day) => applyDayOp(day, input, players, result));
  if (!day) fail(404, 'Dia de jogo não encontrado.');
  return { day, ...result };
}

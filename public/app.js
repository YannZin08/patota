// Patota: site de uma página só. As telas são montadas a partir de `state`
// e o endereço (#/, #/dia/<id>, #/dia/<id>/partida/<id>, #/jogadores, #/estatisticas).

const TEAM_NAMES = {
  vermelho: 'Vermelho',
  azul: 'Azul',
  preto: 'Preto',
  branco: 'Branco',
  verde: 'Verde',
  amarelo: 'Amarelo',
  laranja: 'Laranja',
  roxo: 'Roxo',
};
const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const AVATAR_COLORS = ['#16784a', '#2e6be0', '#c2410c', '#8a5cf3', '#0e7490', '#b45309', '#be185d', '#4d7c0f'];

const state = {
  loaded: false,
  config: { name: 'Patota' },
  players: [],
  days: [],
  pinRequired: false,
  ui: {
    daySection: {},
    newMatch: {},
    editingPlayer: null,
    statsPeriod: 'all',
    statsSort: 'gols',
  },
};

const view = document.getElementById('view');
let playersById = new Map();
let lastFullLoad = 0;

// ---------- Utilidades ----------

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso, { weekday = true } = {}) {
  const d = new Date(`${iso}T12:00:00`);
  const options = { day: '2-digit', month: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  if (weekday) options.weekday = 'long';
  const text = d.toLocaleDateString('pt-BR', options);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const decimal = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const playerName = (id) => {
  const p = playersById.get(id);
  return p ? p.nickname || p.name : 'Jogador removido';
};

function initials(text) {
  const words = text.trim().split(/\s+/);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] ?? '')).toUpperCase();
}

function avatar(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `<span class="avatar" style="background:${color}" aria-hidden="true">${esc(initials(playerName(id)))}</span>`;
}

const byName = (a, b) => playerName(a).localeCompare(playerName(b), 'pt-BR');
const findDay = (id) => state.days.find((d) => d.id === id);
const team = (day, teamId) => day.teams.find((t) => t.id === teamId);
const teamLabel = (t) => (t ? TEAM_NAMES[t.color] ?? t.color : 'Time removido');
const swatch = (t) => `<span class="swatch" style="background:var(--team-${esc(t?.color)})"></span>`;

function score(match) {
  let a = 0;
  let b = 0;
  for (const g of match.goals) g.side === 'A' ? a++ : b++;
  return { a, b };
}

function goalsByPlayer(days) {
  const goals = new Map();
  for (const d of days)
    for (const m of d.matches)
      for (const g of m.goals) if (g.playerId) goals.set(g.playerId, (goals.get(g.playerId) ?? 0) + 1);
  return goals;
}

function setPlayers(players) {
  state.players = players;
  playersById = new Map(players.map((p) => [p.id, p]));
}

function upsertDay(day) {
  const i = state.days.findIndex((d) => d.id === day.id);
  if (i >= 0) state.days[i] = day;
  else state.days.push(day);
  state.days.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

// ---------- Avisos ----------

let toastTimer;
function toast(message, { error = false, action, onAction, duration = 3500 } = {}) {
  const el = document.getElementById('toast');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) {
    el.querySelector('button').onclick = () => {
      el.hidden = true;
      onAction();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

function setOffline(offline) {
  document.getElementById('sync').hidden = !offline;
}

// ---------- Comunicação com o servidor ----------

function storedPin() {
  try {
    return localStorage.getItem('patota-pin');
  } catch {
    return null;
  }
}

function savePin(pin) {
  try {
    if (pin) localStorage.setItem('patota-pin', pin);
    else localStorage.removeItem('patota-pin');
  } catch {}
}

async function api(path, body, retried = false) {
  const options = { headers: {} };
  if (body) {
    options.method = 'POST';
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
    if (state.pinRequired) {
      let pin = storedPin();
      if (!pin) {
        pin = prompt('Digite o PIN da patota para alterar os dados:');
        if (!pin) throw new Error('Sem o PIN da patota não dá para alterar os dados.');
        savePin(pin);
      }
      options.headers['x-patota-pin'] = pin;
    }
  }

  let res;
  try {
    res = await fetch(path, options);
  } catch {
    setOffline(true);
    throw new Error('Sem conexão. Tente de novo.');
  }
  setOffline(false);

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && body && !retried) {
    savePin(null);
    return api(path, body, true);
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Algo deu errado. Tente de novo.');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function loadAll() {
  const data = await api('/api/state');
  state.config = data.config;
  state.days = data.days;
  state.pinRequired = data.pinRequired;
  setPlayers(data.players);
  state.loaded = true;
  lastFullLoad = Date.now();
}

// Alterações num dia de jogo. A tela muda na hora (otimista) e, quando todas as
// requisições em andamento terminam, fica com a versão mais nova do servidor.
// As alterações de um mesmo celular vão uma de cada vez, na ordem dos toques,
// para não disputarem o mesmo arquivo no servidor.
const inflight = { count: 0, latest: new Map(), stale: new Set() };
let queue = Promise.resolve();

async function changeDay(dayId, payload, optimistic) {
  const day = findDay(dayId);
  if (optimistic && day) {
    optimistic(day);
    render();
  }
  inflight.count++;
  try {
    const request = queue.then(() => api('/api/day', { id: dayId, ...payload }));
    queue = request.catch(() => {});
    const res = await request;
    if (res.day) {
      const prev = inflight.latest.get(dayId);
      if (!prev || res.day.updatedAt >= prev.updatedAt) inflight.latest.set(dayId, res.day);
    }
    return res;
  } catch (err) {
    inflight.stale.add(dayId);
    throw err;
  } finally {
    inflight.count--;
    if (inflight.count === 0) {
      for (const d of inflight.latest.values()) upsertDay(d);
      inflight.latest.clear();
      const stale = [...inflight.stale];
      inflight.stale.clear();
      render();
      for (const id of stale) refreshDay(id);
    }
  }
}

async function refreshDay(id) {
  try {
    const res = await api(`/api/day?id=${encodeURIComponent(id)}`);
    if (inflight.count) return;
    const current = findDay(id);
    const playersChanged = JSON.stringify(res.players) !== JSON.stringify(state.players);
    if (playersChanged) setPlayers(res.players);
    if (!current || current.updatedAt !== res.day.updatedAt || playersChanged) {
      upsertDay(res.day);
      softRender();
    }
  } catch (err) {
    if (err.status === 404 && findDay(id)) {
      state.days = state.days.filter((d) => d.id !== id);
      softRender();
    }
  }
}

async function refreshAll() {
  try {
    const before = JSON.stringify([state.config, state.players, state.days]);
    await loadAll();
    if (inflight.count) return;
    if (JSON.stringify([state.config, state.players, state.days]) !== before) softRender();
  } catch {}
}

// Atualiza a tela sozinha (placar ao vivo para quem está só olhando).
async function poll() {
  if (document.hidden || inflight.count || !state.loaded) return;
  const r = route();
  if (r.name === 'dia' || r.name === 'partida') await refreshDay(r.dayId);
  else if (Date.now() - lastFullLoad > 15000) await refreshAll();
}
setInterval(poll, 4000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

// ---------- Rotas ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'jogadores') return { name: 'jogadores' };
  if (parts[0] === 'estatisticas') return { name: 'estatisticas' };
  if (parts[0] === 'dia' && parts[1]) {
    if (parts[2] === 'partida' && parts[3]) return { name: 'partida', dayId: parts[1], matchId: parts[3] };
    return { name: 'dia', dayId: parts[1] };
  }
  return { name: 'jogos' };
}

function render() {
  const r = route();
  const tab = ['dia', 'partida'].includes(r.name) ? 'jogos' : r.name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.getElementById('patota-name').textContent = state.config.name;
  document.title = state.config.name;
  if (!state.loaded) return;
  view.innerHTML = VIEWS[r.name](r);
}

// Não redesenha enquanto alguém está digitando.
function softRender() {
  const active = document.activeElement;
  if (active && view.contains(active) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
  render();
}

// ---------- Tela: Jogos ----------

function viewJogos() {
  const today = todayISO();
  const days = state.days;

  const cards = days
    .map((d) => {
      const goals = goalsByPlayer([d]);
      const totalGoals = d.matches.reduce((n, m) => n + m.goals.length, 0);
      const top = [...goals.entries()].sort((a, b) => b[1] - a[1])[0];
      const live = d.matches.some((m) => m.status === 'live');
      return `
        <a class="card day-card" href="#/dia/${esc(d.id)}">
          <div class="row">
            <span class="title grow">${esc(formatDate(d.date))}</span>
            ${live ? '<span class="badge live">Ao vivo</span>' : d.date === today ? '<span class="badge">Hoje</span>' : ''}
          </div>
          <div class="muted small">${plural(d.presentes.length, 'presente', 'presentes')} · ${plural(d.matches.length, 'partida', 'partidas')} · ${plural(totalGoals, 'gol', 'gols')}</div>
          ${top ? `<div class="small" style="margin-top:4px">Artilheiro: <strong>${esc(playerName(top[0]))}</strong> (${top[1]})</div>` : ''}
        </a>`;
    })
    .join('');

  return `
    <h1>Jogos</h1>
    <form class="card" data-form="create-day">
      <h2>Novo dia de jogo</h2>
      <div class="row">
        <input type="date" name="date" value="${today}" required class="grow" aria-label="Data do jogo">
        <button class="btn primary" type="submit">Criar</button>
      </div>
    </form>
    ${
      state.players.length === 0
        ? `<div class="card empty"><strong>Comece pelos jogadores</strong>Cadastre a turma da patota na aba <a href="#/jogadores">Jogadores</a>.</div>`
        : ''
    }
    ${days.length ? `<div class="section-title"><h2>Dias de jogo</h2></div>${cards}` : `<div class="empty"><strong>Nenhum dia de jogo ainda</strong>Crie o primeiro dia acima.</div>`}
  `;
}

// ---------- Tela: Dia de jogo ----------

function notFound(text) {
  return `<a class="back" href="#/">‹ Jogos</a><div class="empty"><strong>${esc(text)}</strong>Ele pode ter sido excluído.</div>`;
}

function viewDia(r) {
  const day = findDay(r.dayId);
  if (!day) return notFound('Dia de jogo não encontrado');

  const section = state.ui.daySection[day.id] ?? (day.matches.length ? 'partidas' : 'presenca');
  const liveMatches = day.matches.filter((m) => m.status === 'live');

  const live = liveMatches
    .map((m) => {
      const s = score(m);
      return `
        <a class="card row" style="text-decoration:none;color:inherit" href="#/dia/${esc(day.id)}/partida/${esc(m.id)}">
          <span class="badge live">Ao vivo</span>
          <span class="grow"><strong>${esc(teamLabel(team(day, m.teamA)))} ${s.a} x ${s.b} ${esc(teamLabel(team(day, m.teamB)))}</strong></span>
          <span class="muted">Placar ›</span>
        </a>`;
    })
    .join('');

  const tabs = [
    ['presenca', `Presença (${day.presentes.length})`],
    ['times', 'Times'],
    ['partidas', `Partidas (${day.matches.length})`],
  ]
    .map(([key, label]) => `<button type="button" data-action="day-section" data-value="${key}" aria-pressed="${section === key}">${label}</button>`)
    .join('');

  const content = { presenca: dayPresence, times: dayTeams, partidas: dayMatches }[section](day);

  return `
    <a class="back" href="#/">‹ Jogos</a>
    <h1>${esc(formatDate(day.date))}</h1>
    ${live}
    <div class="segmented" style="margin-bottom:14px">${tabs}</div>
    ${content}
    <div style="text-align:center;margin-top:28px">
      <button class="btn danger" data-action="delete-day">Excluir este dia</button>
    </div>
  `;
}

function dayPresence(day) {
  const ids = [...new Set([...state.players.filter((p) => p.active).map((p) => p.id), ...day.presentes])].sort(byName);
  const chips = ids
    .map((id) => {
      const p = playersById.get(id);
      const on = day.presentes.includes(id);
      return `<button type="button" class="chip" data-action="toggle-presence" data-id="${esc(id)}" aria-pressed="${on}">${esc(playerName(id))}${p?.position === 'Goleiro' ? '<span class="pos">goleiro</span>' : ''}</button>`;
    })
    .join('');

  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <h2 style="margin:0">Quem veio?</h2>
        <span class="muted small">${plural(day.presentes.length, 'presente', 'presentes')}</span>
      </div>
      ${ids.length ? `<div class="chips">${chips}</div>` : `<p class="muted">Nenhum jogador cadastrado ainda.</p>`}
    </div>
    <form class="card" data-form="quick-player">
      <h2>Jogador novo ou convidado</h2>
      <div class="row">
        <input type="text" name="name" placeholder="Nome" maxlength="40" class="grow" autocomplete="off" aria-label="Nome do jogador">
        <button class="btn" type="submit">Adicionar</button>
      </div>
      <p class="muted small" style="margin:8px 0 0">Cadastra o jogador e já marca presença.</p>
    </form>
  `;
}

function dayTeams(day) {
  const assigned = new Map();
  for (const t of day.teams) for (const id of t.playerIds) assigned.set(id, t.id);
  const unassigned = day.presentes.filter((id) => !assigned.has(id)).length;
  const usedInMatch = (t) => day.matches.some((m) => m.teamA === t.id || m.teamB === t.id);

  const pills = day.teams
    .map(
      (t) => `
      <span class="team-pill">${swatch(t)}${esc(teamLabel(t))} · ${t.playerIds.length}
        ${usedInMatch(t) ? '' : `<button type="button" data-action="remove-team" data-id="${esc(t.id)}" aria-label="Remover time ${esc(teamLabel(t))}">×</button>`}
      </span>`,
    )
    .join('');

  const rows = [...day.presentes]
    .sort(byName)
    .map((id) => {
      const p = playersById.get(id);
      const dots = day.teams
        .map(
          (t) => `
          <button type="button" class="dot" data-action="assign" data-player="${esc(id)}" data-team="${esc(t.id)}"
            aria-pressed="${assigned.get(id) === t.id}" aria-label="${esc(playerName(id))} no ${esc(teamLabel(t))}" title="${esc(teamLabel(t))}">
            <span class="fill" style="background:var(--team-${esc(t.color)})"></span>
          </button>`,
        )
        .join('');
      return `
        <li>
          <div class="grow">
            <div class="name">${esc(playerName(id))}</div>
            ${p?.position === 'Goleiro' ? '<div class="muted small">Goleiro</div>' : ''}
          </div>
          <div class="dots">${dots}
            <button type="button" class="dot none" data-action="assign" data-player="${esc(id)}" data-team="" aria-pressed="${!assigned.has(id)}" aria-label="${esc(playerName(id))} sem time" title="Sem time">–</button>
          </div>
        </li>`;
    })
    .join('');

  return `
    <div class="card">
      <div class="row wrap" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Times do dia</h2>
        <div class="row">
          <button type="button" class="btn small" data-action="draw-teams">Sortear</button>
          <button type="button" class="btn small" data-action="add-team">+ Time</button>
        </div>
      </div>
      <div class="team-summary">
        ${pills}
        ${unassigned ? `<span class="team-pill"><span class="swatch" style="background:transparent"></span>Sem time · ${unassigned}</span>` : ''}
      </div>
    </div>
    ${
      day.presentes.length
        ? `<div class="card"><h2>Toque na cor do time de cada um</h2><ul class="list">${rows}</ul></div>`
        : `<div class="empty"><strong>Ninguém na lista ainda</strong>Marque quem veio na aba Presença.</div>`
    }
  `;
}

function dayMatches(day) {
  const teams = day.teams;
  const saved = state.ui.newMatch[day.id] ?? {};
  const pickA = team(day, saved.teamA) ? saved.teamA : teams[0]?.id;
  const pickB = team(day, saved.teamB) && saved.teamB !== pickA ? saved.teamB : teams.find((t) => t.id !== pickA)?.id;
  const options = (selected) =>
    teams.map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(teamLabel(t))} (${t.playerIds.length})</option>`).join('');

  const matches = [...day.matches]
    .sort((a, b) => b.n - a.n)
    .map((m) => {
      const s = score(m);
      const tA = team(day, m.teamA);
      const tB = team(day, m.teamB);
      return `
        <a class="match-row" href="#/dia/${esc(day.id)}/partida/${esc(m.id)}">
          <span class="n">#${m.n}</span>
          <span class="grow row" style="gap:6px;flex-wrap:wrap">
            ${swatch(tA)}<span>${esc(teamLabel(tA))}</span>
            <span class="score">${s.a} x ${s.b}</span>
            <span>${esc(teamLabel(tB))}</span>${swatch(tB)}
          </span>
          ${m.status === 'live' ? '<span class="badge live">Ao vivo</span>' : '<span class="muted">›</span>'}
        </a>`;
    })
    .join('');

  const scorers = [...goalsByPlayer([day]).entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]));
  const scorersList = scorers
    .map(([id, n], i) => `<li><span class="rank${i < 3 ? ' top' : ''}">${i + 1}</span>${avatar(id)}<span class="grow name">${esc(playerName(id))}</span><span class="big">${n}</span></li>`)
    .join('');

  return `
    <form class="card" data-form="new-match">
      <h2>Nova partida</h2>
      ${
        teams.length < 2
          ? `<p class="muted" style="margin:0">Crie pelo menos dois times na aba Times.</p>`
          : `<div class="row">
              <select name="teamA" class="grow" aria-label="Primeiro time">${options(pickA)}</select>
              <span class="muted" style="font-weight:700">x</span>
              <select name="teamB" class="grow" aria-label="Segundo time">${options(pickB)}</select>
            </div>
            <button class="btn primary block" type="submit" style="margin-top:10px">Começar partida</button>`
      }
    </form>
    <div class="card">
      <h2>Partidas do dia</h2>
      ${matches || '<p class="muted" style="margin:0">Nenhuma partida ainda.</p>'}
    </div>
    ${scorers.length ? `<div class="card"><h2>Artilharia do dia</h2><ul class="list">${scorersList}</ul></div>` : ''}
  `;
}

// ---------- Tela: Partida (placar ao vivo) ----------

function viewPartida(r) {
  const day = findDay(r.dayId);
  if (!day) return notFound('Dia de jogo não encontrado');
  const match = day.matches.find((m) => m.id === r.matchId);
  if (!match) return `<a class="back" href="#/dia/${esc(day.id)}">‹ Voltar</a><div class="empty"><strong>Partida não encontrada</strong>Ela pode ter sido excluída.</div>`;

  const live = match.status === 'live';
  const s = score(match);
  const tA = team(day, match.teamA);
  const tB = team(day, match.teamB);
  const goalsIn = new Map();
  for (const g of match.goals) if (g.playerId) goalsIn.set(g.playerId, (goalsIn.get(g.playerId) ?? 0) + 1);

  const column = (side, t, roster) => {
    const ordered = [...roster].sort((a, b) => {
      const ga = playersById.get(a)?.position === 'Goleiro';
      const gb = playersById.get(b)?.position === 'Goleiro';
      return ga - gb || byName(a, b);
    });
    const buttons = ordered
      .map((id) => {
        const n = goalsIn.get(id) ?? 0;
        const gk = playersById.get(id)?.position === 'Goleiro';
        return `
          <button type="button" class="scorer" style="--team:var(--team-${esc(t?.color)})" data-action="goal" data-side="${side}" data-player="${esc(id)}" ${live ? '' : 'disabled'}>
            <span class="label">${esc(playerName(id))}${gk ? ' <span class="muted small">(G)</span>' : ''}</span>
            <span class="count">${n ? `⚽ ${n}` : ''}</span>
          </button>`;
      })
      .join('');
    return `
      <div class="column">
        <h3>${swatch(t)}${esc(teamLabel(t))}</h3>
        ${buttons || '<p class="muted small">Sem jogadores. Monte os times na aba Times do dia.</p>'}
        ${live ? `<button type="button" class="btn ghost small block" data-action="goal" data-side="${side}" data-player="">+ Gol contra / sem autor</button>` : ''}
      </div>`;
  };

  const start = new Date(match.startedAt).getTime();
  const timeline = [...match.goals]
    .reverse()
    .map((g) => {
      const t = g.side === 'A' ? tA : tB;
      const minute = Math.max(1, Math.floor((new Date(g.at).getTime() - start) / 60000) + 1);
      const pendingGoal = g.id.startsWith('tmp');
      return `
        <li>
          <span class="min">${minute}'</span>
          ${swatch(t)}
          <span class="grow name">${g.playerId ? esc(playerName(g.playerId)) : '<span class="muted">Gol contra / sem autor</span>'}</span>
          ${live && !pendingGoal ? `<button type="button" class="btn small ghost" data-action="undo-goal" data-goal="${esc(g.id)}">Desfazer</button>` : ''}
        </li>`;
    })
    .join('');

  let result = '';
  if (!live) {
    result = s.a === s.b ? 'Empate' : `Vitória do ${esc(teamLabel(s.a > s.b ? tA : tB))}`;
  }

  return `
    <a class="back" href="#/dia/${esc(day.id)}">‹ ${esc(formatDate(day.date))}</a>
    <div class="row" style="justify-content:space-between;margin:4px 0 12px">
      <h1 style="margin:0">Partida ${match.n}</h1>
      ${live ? '<span class="badge live">Ao vivo</span>' : `<span class="badge">${result}</span>`}
    </div>

    <div class="scoreboard">
      <div class="side" style="--team:var(--team-${esc(tA?.color)})"><div class="team-name">${esc(teamLabel(tA))}</div><div class="goals">${s.a}</div></div>
      <div class="x">x</div>
      <div class="side" style="--team:var(--team-${esc(tB?.color)})"><div class="team-name">${esc(teamLabel(tB))}</div><div class="goals">${s.b}</div></div>
    </div>

    ${live ? '<p class="muted small" style="margin:-4px 0 12px;text-align:center">Toque no nome de quem fez o gol.</p>' : ''}

    <div class="columns">
      ${column('A', tA, match.rosterA)}
      ${column('B', tB, match.rosterB)}
    </div>

    <div class="card" style="margin-top:6px">
      <h2>Lances</h2>
      ${timeline ? `<ul class="list timeline">${timeline}</ul>` : '<p class="muted" style="margin:0">Nenhum gol ainda.</p>'}
    </div>

    ${
      live
        ? `<button type="button" class="btn primary block" data-action="finish-match">Encerrar partida</button>`
        : `<div class="row">
            <button type="button" class="btn primary grow" data-action="next-match">Nova partida</button>
            <button type="button" class="btn grow" data-action="reopen-match">Reabrir</button>
          </div>`
    }
    <div style="text-align:center;margin-top:18px">
      <button type="button" class="btn danger" data-action="delete-match">Excluir partida</button>
    </div>
  `;
}

// ---------- Tela: Jogadores ----------

function playerStats(days) {
  const stats = new Map();
  const get = (id) => {
    if (!stats.has(id)) stats.set(id, { id, presencas: 0, gols: 0, partidas: 0, vitorias: 0, empates: 0, derrotas: 0 });
    return stats.get(id);
  };
  for (const d of days) {
    for (const id of d.presentes) get(id).presencas++;
    for (const m of d.matches) {
      const s = score(m);
      for (const [roster, mine, theirs] of [
        [m.rosterA, s.a, s.b],
        [m.rosterB, s.b, s.a],
      ]) {
        for (const id of roster) {
          const st = get(id);
          st.partidas++;
          if (m.status === 'done') {
            if (mine > theirs) st.vitorias++;
            else if (mine === theirs) st.empates++;
            else st.derrotas++;
          }
        }
      }
      for (const g of m.goals) if (g.playerId) get(g.playerId).gols++;
    }
  }
  return stats;
}

function viewJogadores() {
  const editing = state.ui.editingPlayer ? playersById.get(state.ui.editingPlayer) : null;
  const stats = playerStats(state.days);
  const position = editing?.position ?? 'Linha';

  const row = (p) => {
    const st = stats.get(p.id);
    const details = [
      p.nickname ? p.name : '',
      p.position === 'Goleiro' ? 'Goleiro' : '',
      st ? `${plural(st.gols, 'gol', 'gols')} · ${plural(st.presencas, 'presença', 'presenças')}` : 'Ainda não jogou',
    ].filter(Boolean);
    const actions = p.active
      ? `<button type="button" class="icon-btn" data-action="edit-player" data-id="${esc(p.id)}" aria-label="Editar ${esc(p.nickname || p.name)}" title="Editar">${ICON_EDIT}</button>
         <button type="button" class="icon-btn danger" data-action="remove-player" data-id="${esc(p.id)}" aria-label="Remover ${esc(p.nickname || p.name)}" title="Remover">${ICON_REMOVE}</button>`
      : `<button type="button" class="btn small" data-action="reactivate-player" data-id="${esc(p.id)}">Reativar</button>`;
    return `
      <li>
        ${avatar(p.id)}
        <div class="grow">
          <div class="name">${esc(p.nickname || p.name)}</div>
          <div class="muted small">${esc(details.join(' · '))}</div>
        </div>
        ${actions}
      </li>`;
  };

  const sorted = [...state.players].sort((a, b) => byName(a.id, b.id));
  const active = sorted.filter((p) => p.active);
  const inactive = sorted.filter((p) => !p.active);

  return `
    <h1>Jogadores</h1>
    <form class="card stack" data-form="save-player">
      <h2>${editing ? 'Editar jogador' : 'Cadastrar jogador'}</h2>
      <label class="field"><span>Nome</span>
        <input type="text" name="name" required maxlength="40" autocomplete="off" value="${esc(editing?.name)}">
      </label>
      <label class="field"><span>Apelido (opcional, é o que aparece no placar)</span>
        <input type="text" name="nickname" maxlength="20" autocomplete="off" value="${esc(editing?.nickname)}">
      </label>
      <div class="field">
        <span class="muted small" style="display:block;font-weight:600;margin-bottom:4px">Posição</span>
        <div class="segmented">
          <button type="button" data-action="set-position" data-value="Linha" aria-pressed="${position === 'Linha'}">Linha</button>
          <button type="button" data-action="set-position" data-value="Goleiro" aria-pressed="${position === 'Goleiro'}">Goleiro</button>
        </div>
        <input type="hidden" name="position" value="${esc(position)}">
      </div>
      <div class="row">
        <button class="btn primary grow" type="submit">${editing ? 'Salvar alterações' : 'Cadastrar jogador'}</button>
        ${editing ? '<button type="button" class="btn" data-action="cancel-edit">Cancelar</button>' : ''}
      </div>
    </form>

    <div class="card">
      <h2>Na patota (${active.length})</h2>
      ${active.length ? `<ul class="list">${active.map(row).join('')}</ul>` : '<p class="muted" style="margin:0">Ninguém cadastrado ainda.</p>'}
    </div>

    ${inactive.length ? `<details class="card"><summary>Desativados (${inactive.length})</summary><ul class="list" style="margin-top:8px">${inactive.map(row).join('')}</ul></details>` : ''}

    <form class="card" data-form="patota-name">
      <h2>Nome da patota</h2>
      <div class="row">
        <input type="text" name="name" maxlength="40" value="${esc(state.config.name)}" class="grow" aria-label="Nome da patota">
        <button class="btn" type="submit">Salvar</button>
      </div>
    </form>
  `;
}

// ---------- Tela: Estatísticas ----------

function viewEstatisticas() {
  const { statsPeriod: period, statsSort: sortKey } = state.ui;
  const now = new Date();
  const year = String(now.getFullYear());
  const month = `${year}-${pad(now.getMonth() + 1)}`;
  const lastDay = state.days[0]?.id;
  const days = state.days.filter((d) =>
    period === 'year' ? d.date.startsWith(year) : period === 'month' ? d.date.startsWith(month) : period === 'last' ? d.id === lastDay : true,
  );

  const stats = [...playerStats(days).values()].filter((s) => s.presencas || s.gols || s.partidas);
  const metric = { gols: (s) => s.gols, presencas: (s) => s.presencas, vitorias: (s) => s.vitorias }[sortKey];
  stats.sort((a, b) => metric(b) - metric(a) || b.gols - a.gols || b.presencas - a.presencas || byName(a.id, b.id));

  let rank = 0;
  let previous;
  const rows = stats
    .map((s, i) => {
      if (metric(s) !== previous) rank = i + 1;
      previous = metric(s);
      const media = s.presencas ? decimal(s.gols / s.presencas) : '0,0';
      const unit = { gols: s.gols === 1 ? 'gol' : 'gols', presencas: s.presencas === 1 ? 'presença' : 'presenças', vitorias: s.vitorias === 1 ? 'vitória' : 'vitórias' }[sortKey];
      return `
        <li>
          <span class="rank${rank <= 3 && metric(s) > 0 ? ' top' : ''}">${rank}</span>
          ${avatar(s.id)}
          <div class="grow">
            <div class="name">${esc(playerName(s.id))}</div>
            <div class="muted small">${[
              plural(s.presencas, 'presença', 'presenças'),
              plural(s.partidas, 'partida', 'partidas'),
              `${s.vitorias}V ${s.empates}E ${s.derrotas}D`,
              `${media} gol/dia`,
            ]
              .map((t) => `<span class="nw">${t}</span>`)
              .join(' · ')}</div>
          </div>
          <div class="big">${metric(s)}<small>${unit}</small></div>
        </li>`;
    })
    .join('');

  const totalMatches = days.reduce((n, d) => n + d.matches.length, 0);
  const totalGoals = days.reduce((n, d) => n + d.matches.reduce((k, m) => k + m.goals.length, 0), 0);
  const seg = (action, current, items) =>
    `<div class="segmented">${items.map(([v, l]) => `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${current === v}">${l}</button>`).join('')}</div>`;

  return `
    <h1>Estatísticas</h1>
    <div class="filters">
      ${seg('stats-period', period, [['all', 'Tudo'], ['year', 'Ano'], ['month', 'Mês'], ['last', 'Último dia']])}
      ${seg('stats-sort', sortKey, [['gols', 'Gols'], ['presencas', 'Presenças'], ['vitorias', 'Vitórias']])}
    </div>
    <div class="tiles">
      <div class="tile"><div class="value">${days.length}</div><div class="label">${days.length === 1 ? 'dia de jogo' : 'dias de jogo'}</div></div>
      <div class="tile"><div class="value">${totalMatches}</div><div class="label">${totalMatches === 1 ? 'partida' : 'partidas'}</div></div>
      <div class="tile"><div class="value">${totalGoals}</div><div class="label">${totalGoals === 1 ? 'gol' : 'gols'}</div></div>
    </div>
    ${
      rows
        ? `<div class="card"><ul class="list">${rows}</ul></div>`
        : '<div class="empty"><strong>Sem jogos nesse período</strong>As estatísticas aparecem quando os gols forem marcados.</div>'
    }
  `;
}

const VIEWS = { jogos: viewJogos, dia: viewDia, partida: viewPartida, jogadores: viewJogadores, estatisticas: viewEstatisticas };

// ---------- Ações ----------

const ACTIONS = {
  'day-section'(el, r) {
    state.ui.daySection[r.dayId] = el.dataset.value;
    render();
  },

  async 'toggle-presence'(el, r) {
    const id = el.dataset.id;
    const present = el.getAttribute('aria-pressed') !== 'true';
    await changeDay(r.dayId, { op: 'setPresence', playerId: id, present }, (d) => {
      if (present) d.presentes.push(id);
      else {
        d.presentes = d.presentes.filter((x) => x !== id);
        for (const t of d.teams) t.playerIds = t.playerIds.filter((x) => x !== id);
      }
    });
  },

  async assign(el, r) {
    const playerId = el.dataset.player;
    const teamId = el.dataset.team || null;
    await changeDay(r.dayId, { op: 'assignPlayer', playerId, teamId }, (d) => {
      for (const t of d.teams) t.playerIds = t.playerIds.filter((x) => x !== playerId);
      if (teamId) team(d, teamId)?.playerIds.push(playerId);
    });
  },

  async 'draw-teams'(el, r) {
    const day = findDay(r.dayId);
    if (day.teams.some((t) => t.playerIds.length) && !confirm('Sortear de novo? Os times atuais serão refeitos.')) return;
    await changeDay(r.dayId, { op: 'drawTeams' });
    toast('Times sorteados!');
  },

  async 'add-team'(el, r) {
    await changeDay(r.dayId, { op: 'addTeam' });
  },

  async 'remove-team'(el, r) {
    await changeDay(r.dayId, { op: 'removeTeam', teamId: el.dataset.id });
  },

  async 'delete-day'(el, r) {
    const day = findDay(r.dayId);
    if (!confirm(`Excluir o dia ${formatDate(day.date)}? Presença, partidas e gols desse dia serão apagados.`)) return;
    await api('/api/day', { op: 'delete', id: day.id });
    state.days = state.days.filter((d) => d.id !== day.id);
    location.hash = '#/';
    toast('Dia excluído.');
  },

  async goal(el, r) {
    const side = el.dataset.side;
    const playerId = el.dataset.player || null;
    const tempId = `tmp${Math.random().toString(36).slice(2)}`;
    navigator.vibrate?.(40);
    const request = changeDay(r.dayId, { op: 'goal', matchId: r.matchId, side, playerId }, (d) => {
      d.matches.find((m) => m.id === r.matchId)?.goals.push({ id: tempId, side, playerId, at: new Date().toISOString() });
    });
    toast(playerId ? `Gol de ${playerName(playerId)}!` : 'Gol contra / sem autor marcado', {
      action: 'Desfazer',
      onAction: async () => {
        try {
          const res = await request;
          await undoGoal(r, res.goalId);
        } catch (err) {
          toast(err.message, { error: true });
        }
      },
    });
    await request;
  },

  async 'undo-goal'(el, r) {
    await undoGoal(r, el.dataset.goal);
  },

  async 'finish-match'(el, r) {
    await changeDay(r.dayId, { op: 'finishMatch', matchId: r.matchId }, (d) => {
      const m = d.matches.find((x) => x.id === r.matchId);
      if (m) m.status = 'done';
    });
  },

  async 'reopen-match'(el, r) {
    await changeDay(r.dayId, { op: 'reopenMatch', matchId: r.matchId });
  },

  async 'delete-match'(el, r) {
    if (!confirm('Excluir esta partida e os gols dela?')) return;
    await changeDay(r.dayId, { op: 'deleteMatch', matchId: r.matchId });
    location.hash = `#/dia/${r.dayId}`;
  },

  'next-match'(el, r) {
    state.ui.daySection[r.dayId] = 'partidas';
    location.hash = `#/dia/${r.dayId}`;
  },

  'set-position'(el) {
    // Só troca o botão, sem redesenhar, para não perder o que já foi digitado.
    const form = el.closest('form');
    form.querySelectorAll('[data-action="set-position"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    form.elements.position.value = el.dataset.value;
  },

  'edit-player'(el) {
    state.ui.editingPlayer = el.dataset.id;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    view.querySelector('input[name="name"]')?.focus();
  },

  'cancel-edit'() {
    state.ui.editingPlayer = null;
    render();
  },

  async 'remove-player'(el) {
    const id = el.dataset.id;
    if (!confirm(`Remover ${playerName(id)}? Se ele já jogou, fica só desativado para não sumir das estatísticas.`)) return;
    const res = await api('/api/players', { op: 'delete', id });
    setPlayers(res.players);
    if (state.ui.editingPlayer === id) state.ui.editingPlayer = null;
    render();
    toast(res.deactivated ? 'Jogador desativado.' : 'Jogador excluído.');
  },

  async 'reactivate-player'(el) {
    const res = await api('/api/players', { op: 'setActive', id: el.dataset.id, active: true });
    setPlayers(res.players);
    render();
  },

  'stats-period'(el) {
    state.ui.statsPeriod = el.dataset.value;
    render();
  },

  'stats-sort'(el) {
    state.ui.statsSort = el.dataset.value;
    render();
  },

  async retry() {
    await start();
  },
};

async function undoGoal(r, goalId) {
  if (!goalId) return;
  await changeDay(r.dayId, { op: 'undoGoal', matchId: r.matchId, goalId }, (d) => {
    const m = d.matches.find((x) => x.id === r.matchId);
    if (m) m.goals = m.goals.filter((g) => g.id !== goalId);
  });
}

const FORMS = {
  async 'create-day'(form) {
    const res = await api('/api/day', { op: 'create', date: form.elements.date.value });
    upsertDay(res.day);
    state.ui.daySection[res.day.id] = 'presenca';
    location.hash = `#/dia/${res.day.id}`;
  },

  async 'quick-player'(form, r) {
    const name = form.elements.name.value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    // Se o nome já está cadastrado, só marca presença (e reativa, se preciso).
    const key = name.toLowerCase();
    let player = state.players.find((p) => p.name.toLowerCase() === key || (p.nickname || '').toLowerCase() === key);
    if (player && !player.active) {
      setPlayers((await api('/api/players', { op: 'setActive', id: player.id, active: true })).players);
    }
    if (!player) {
      const res = await api('/api/players', { op: 'save', player: { name } });
      setPlayers(res.players);
      player = res.player;
    }
    form.elements.name.value = '';
    if (!findDay(r.dayId).presentes.includes(player.id)) {
      await changeDay(r.dayId, { op: 'setPresence', playerId: player.id, present: true }, (d) => d.presentes.push(player.id));
    }
    toast(`${player.nickname || player.name} está na lista.`);
  },

  async 'new-match'(form, r) {
    const teamA = form.elements.teamA.value;
    const teamB = form.elements.teamB.value;
    if (teamA === teamB) throw new Error('Escolha dois times diferentes.');
    state.ui.newMatch[r.dayId] = { teamA, teamB };
    const res = await changeDay(r.dayId, { op: 'addMatch', teamA, teamB });
    const match = [...res.day.matches].sort((a, b) => b.n - a.n)[0];
    location.hash = `#/dia/${r.dayId}/partida/${match.id}`;
  },

  async 'save-player'(form) {
    const editing = state.ui.editingPlayer;
    const player = {
      id: editing ?? undefined,
      name: form.elements.name.value,
      nickname: form.elements.nickname.value,
      position: form.elements.position.value,
    };
    const res = await api('/api/players', { op: 'save', player });
    setPlayers(res.players);
    state.ui.editingPlayer = null;
    render();
    toast(editing ? 'Jogador atualizado.' : `${res.player.nickname || res.player.name} cadastrado!`);
    if (!editing) view.querySelector('input[name="name"]')?.focus();
  },

  async 'patota-name'(form) {
    const res = await api('/api/config', { name: form.elements.name.value });
    state.config = res.config;
    render();
    toast('Nome da patota salvo.');
  },
};

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || !ACTIONS[el.dataset.action]) return;
  event.preventDefault();
  try {
    await ACTIONS[el.dataset.action](el, route());
  } catch (err) {
    toast(err.message, { error: true });
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form || !FORMS[form.dataset.form]) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await FORMS[form.dataset.form](form, route());
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});

async function start() {
  view.innerHTML = '<p class="loading">Carregando…</p>';
  try {
    await loadAll();
    render();
  } catch (err) {
    view.innerHTML = `<div class="empty"><strong>Não deu para carregar</strong>${esc(err.message)}<div style="margin-top:12px"><button class="btn" data-action="retry">Tentar de novo</button></div></div>`;
  }
}

start();

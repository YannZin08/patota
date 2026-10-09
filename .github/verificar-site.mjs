// Teste rápido do site no ar: cria um jogador e um dia de teste, marca gols
// ao mesmo tempo, confere e apaga tudo no final.
const base = process.argv[2].replace(/\/$/, '');
const ok = (cond, msg) => { if (!cond) throw new Error('FALHOU: ' + msg); console.log('ok -', msg); };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.text() }; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} ${body.op} -> ${r.status} ${j.error ?? ''}`);
  return j;
};

const home = await get('/');
ok(home.status === 200 && home.body.includes('Patota'), 'página inicial abre');
const state = JSON.parse((await get('/api/state')).body);
ok(Array.isArray(state.players), `API responde (${state.players.length} jogadores, ${state.days.length} dias)`);

const tag = Math.random().toString(36).slice(2, 7);
let dayId, playerId;
try {
  playerId = (await post('/api/players', { op: 'save', player: { name: `Teste Robô ${tag}` } })).player.id;
  ok(playerId, 'cadastro de jogador grava no Blob');
  const day = (await post('/api/day', { op: 'create', date: '2099-01-01' })).day;
  dayId = day.id;
  ok(dayId, 'dia de jogo criado');
  await post('/api/day', { id: dayId, op: 'setPresence', playerId, present: true });
  await post('/api/day', { id: dayId, op: 'assignPlayer', playerId, teamId: day.teams[0].id });
  const m = (await post('/api/day', { id: dayId, op: 'addMatch', teamA: day.teams[0].id, teamB: day.teams[1].id })).day.matches[0];
  await Promise.all(Array.from({ length: 8 }, () => post('/api/day', { id: dayId, op: 'goal', matchId: m.id, side: 'A', playerId })));
  const saved = JSON.parse((await get(`/api/day?id=${dayId}`)).body).day;
  ok(saved.matches[0].goals.length === 8, `8 gols enviados ao mesmo tempo, ${saved.matches[0].goals.length} salvos`);
} finally {
  if (dayId) await post('/api/day', { op: 'delete', id: dayId });
  if (playerId) await post('/api/players', { op: 'delete', id: playerId });
}
const after = JSON.parse((await get('/api/state')).body);
ok(!after.players.some((p) => p.id === playerId) && !after.days.some((d) => d.id === dayId), 'dados de teste apagados');

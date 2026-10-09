// Teste rápido do site no ar: cria um jogador e um dia de teste, marca gols
// ao mesmo tempo, confere e apaga tudo no final.
const base = process.argv[2].replace(/\/$/, '');
const ok = (cond, msg) => { if (!cond) throw new Error('FALHOU: ' + msg); console.log('ok -', msg); };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.text() }; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} ${body.op} -> ${r.status} ${j.error ?? ''} ${j.detail ?? ''}`);
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
  const goal = () => post('/api/day', { id: dayId, op: 'goal', matchId: m.id, side: 'A', playerId });
  const count = async () => JSON.parse((await get(`/api/day?id=${dayId}`)).body).day.matches[0].goals.length;

  let t = Date.now();
  for (let i = 0; i < 6; i++) await goal();
  ok((await count()) === 6, `6 gols seguidos de um celular (${Date.now() - t} ms)`);

  t = Date.now();
  await Promise.all([goal(), goal(), goal()]);
  ok((await count()) === 9, `3 gols no mesmo instante de celulares diferentes (${Date.now() - t} ms)`);

  t = Date.now();
  const burst = await Promise.allSettled(Array.from({ length: 8 }, goal));
  const failed = burst.filter((r) => r.status === 'rejected');
  for (const f of failed) console.log('   erro:', f.reason.message);
  console.log(`info - teste de estresse: 8 gols no mesmo instante, ${8 - failed.length} aceitos, total salvo ${await count()} (${Date.now() - t} ms)`);
} finally {
  if (dayId) await post('/api/day', { op: 'delete', id: dayId });
  if (playerId) await post('/api/players', { op: 'delete', id: playerId });
}
const after = JSON.parse((await get('/api/state')).body);
ok(!after.players.some((p) => p.id === playerId) && !after.days.some((d) => d.id === dayId), 'dados de teste apagados');

// GET  /api/day?id=...: um dia de jogo (usado para atualizar o placar ao vivo).
// POST /api/day: criar/excluir dia, presença, times, partidas e gols.
import { handler, json, readBody, checkPin } from '../lib/http.js';
import { getDay, getPlayers, dayOp } from '../lib/domain.js';

export const GET = handler(async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  const [day, players] = await Promise.all([getDay(id), getPlayers()]);
  return json({ day, players });
});

export const POST = handler(async (request) => {
  checkPin(request);
  return json(await dayOp(await readBody(request)));
});

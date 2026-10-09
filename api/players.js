// POST /api/players: cadastrar, editar, ativar/desativar e excluir jogadores.
import { handler, json, readBody, checkPin } from '../lib/http.js';
import { playersOp } from '../lib/domain.js';

export const POST = handler(async (request) => {
  checkPin(request);
  return json(await playersOp(await readBody(request)));
});

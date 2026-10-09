// GET /api/state: tudo o que o site precisa para abrir (patota, jogadores e dias de jogo).
import { handler, json, pinRequired } from '../lib/http.js';
import { getConfig, getPlayers, getDays } from '../lib/domain.js';

export const GET = handler(async () => {
  const [config, players, days] = await Promise.all([getConfig(), getPlayers(), getDays()]);
  return json({ config, players, days, pinRequired: pinRequired() });
});

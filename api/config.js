// POST /api/config: muda o nome da patota.
import { handler, json, readBody, checkPin } from '../lib/http.js';
import { setPatotaName } from '../lib/domain.js';

export const POST = handler(async (request) => {
  checkPin(request);
  return json({ config: await setPatotaName(await readBody(request)) });
});

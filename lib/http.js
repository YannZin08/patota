import { randomUUID, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function readBody(request) {
  const text = await request.text();
  if (text.length > 50_000) throw new HttpError(413, 'Requisição muito grande.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

// PIN opcional: se a variável PATOTA_PIN existir, só quem souber o PIN altera dados.
// Ver os dados continua aberto para todo mundo.
export const pinRequired = () => Boolean(process.env.PATOTA_PIN);

export function checkPin(request) {
  const pin = process.env.PATOTA_PIN;
  if (!pin) return;
  const given = Buffer.from(request.headers.get('x-patota-pin') ?? '');
  const expected = Buffer.from(pin);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'PIN da patota incorreto.');
  }
}

export function handler(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Erro no servidor, tente de novo.', detail: err?.name ?? 'Error' }, 500);
    }
  };
}

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 10);

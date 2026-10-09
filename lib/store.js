// Armazenamento dos dados em JSON.
// Em produção usa o Vercel Blob (store privado); localmente grava em ./.data.
// Toda escrita usa o ETag lido antes (ifMatch), então duas pessoas marcando
// gol ao mesmo tempo não apagam o gol uma da outra: quem perde a corrida
// relê o arquivo e tenta de novo.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'patota/';
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const LOCAL_DIR = path.resolve(process.cwd(), '.data');

if (!useBlob && process.env.VERCEL) {
  console.error('Nenhum Blob store conectado ao projeto (BLOB_READ_WRITE_TOKEN ausente).');
}

export class ConflictError extends Error {}

// ---------- Vercel Blob ----------

async function blob() {
  return import('@vercel/blob');
}

async function blobRead(key) {
  const { get, BlobNotFoundError } = await blob();
  let res;
  try {
    res = await get(PREFIX + key, { access: 'private', useCache: false });
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return { data: JSON.parse(text), etag: res.blob.etag };
}

async function blobWrite(key, data, etag) {
  const { put, BlobPreconditionFailedError } = await blob();
  const options = {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  };
  if (etag) options.ifMatch = etag;
  try {
    await put(PREFIX + key, JSON.stringify(data), options);
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new ConflictError();
    // Criação de arquivo que alguém acabou de criar também é conflito.
    if (!etag && (await blobRead(key))) throw new ConflictError();
    throw err;
  }
}

async function blobList(prefix) {
  const { list } = await blob();
  const keys = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX + prefix, cursor, limit: 1000 });
    for (const b of page.blobs) keys.push(b.pathname.slice(PREFIX.length));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function blobDelete(key) {
  const { del } = await blob();
  await del(PREFIX + key);
}

// ---------- Arquivos locais (desenvolvimento) ----------
// Usa chamadas síncronas para que ler-comparar-gravar seja atômico no processo.

const localPath = (key) => path.join(LOCAL_DIR, PREFIX, key);
const hash = (text) => createHash('sha1').update(text).digest('hex');

function localRead(key) {
  const file = localPath(key);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return { data: JSON.parse(text), etag: hash(text) };
}

function localWrite(key, data, etag) {
  const file = localPath(key);
  const current = localRead(key);
  if (etag ? current?.etag !== etag : current) throw new ConflictError();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function localList(prefix) {
  const dir = localPath(prefix);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => prefix + name);
}

function localDelete(key) {
  fs.rmSync(localPath(key), { force: true });
}

// ---------- API pública ----------

export const read = (key) => (useBlob ? blobRead(key) : localRead(key));
export const write = (key, data, etag) => (useBlob ? blobWrite(key, data, etag) : localWrite(key, data, etag));
export const listKeys = (prefix) => (useBlob ? blobList(prefix) : localList(prefix));
export const remove = (key) => (useBlob ? blobDelete(key) : localDelete(key));

// Lê o JSON, aplica `change` e grava só se ninguém mexeu no meio do caminho.
// `change` recebe uma cópia dos dados e devolve os dados novos.
export async function mutate(key, change, initial) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await read(key);
    if (!current && initial === undefined) return null;
    const data = current ? current.data : structuredClone(initial);
    const next = await change(data);
    try {
      await write(key, next, current?.etag ?? null);
      return next;
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  throw new Error('Muitas alterações ao mesmo tempo, tente de novo.');
}

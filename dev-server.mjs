// Servidor local para testar sem a Vercel: `npm run dev` e abra http://localhost:3000
// Os dados ficam na pasta .data (sem BLOB_READ_WRITE_TOKEN).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.resolve('public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const api = url.pathname.match(/^\/api\/([a-z]+)$/);

    if (api) {
      const file = path.resolve('api', `${api[1]}.js`);
      const mod = fs.existsSync(file) ? await import(file) : null;
      const fn = mod?.[req.method];
      if (!fn) return res.writeHead(405).end();
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await fn(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }

    let file = path.join(PUBLIC, path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Patota rodando em http://localhost:${PORT}`));

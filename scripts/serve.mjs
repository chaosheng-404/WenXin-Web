import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const file = normalize(join(root, relative));
        if (!file.startsWith(root)) throw new Error('Forbidden');
        if (!(await stat(file)).isFile()) throw new Error('Not found');
        response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
        response.end(await readFile(file));
    } catch {
        response.writeHead(404);
        response.end('Not found');
    }
}).listen(port, '127.0.0.1', () => console.log(`Local URL: http://127.0.0.1:${port}`));

// Serves src/ for desktop preview. Arrow keys + Enter navigate, Esc/Backspace = Back.
import { createServer } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ensurePersonalWallpapers, personalDir } from './personal-wallpapers.mjs';

const root = resolve(import.meta.dirname, '..', 'src');
ensurePersonalWallpapers();

// index.html always loads the gitignored local overrides; make sure there is something to load.
const localConfig = join(root, 'js', 'config.local.js');
try {
    await access(localConfig);
} catch {
    await writeFile(localConfig, '/* No local overrides. See config.local.example.js. */\n');
}
const port = Number(process.env.PORT) || 8080;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml'
};

createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const privateAsset = path.startsWith('/personal-wallpapers/');
    const base = privateAsset ? personalDir : root;
    const file = normalize(join(base, privateAsset ? path.slice('/personal-wallpapers/'.length) :
        path === '/' ? 'index.html' : path));
    if (!file.startsWith(base + sep)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    } catch {
        res.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://localhost:${port}`);
});

// Turns large photos into TV-ready wallpapers: 1920x1080 cover crop with the readability scrim
// baked in, saved privately in .personal-wallpapers/ with a separate catalog.
// The scrim is part of the image so the TV never composites a gradient over a photo at runtime.
//
//   node scripts/prepare-wallpapers.mjs ~/Downloads/backgrounds [--mode add|replace]
//   node scripts/prepare-wallpapers.mjs --mode restore
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { catalogScript, ensurePersonalWallpapers, personalAssetPath, personalDir } from './personal-wallpapers.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = resolve(import.meta.dirname, '..');
const outDir = personalDir;
const catalogFile = join(outDir, 'catalog.js');
const originalsFile = join(root, 'src/js/wallpapers.js');
const originalDir = join(root, 'scripts/assets/original-wallpapers');

// Friendly names for known files (Unsplash file names: <photographer>-<id>-unsplash.jpg).
// `position` is the CSS background-position used for the crop.
const KNOWN = {
    'anders-jilden-cYrMQA7a3Wc-unsplash.jpg': { key: 'coast', title: 'Coast village', position: 'center 60%' },
    'jms-kFHz9Xh3PPU-unsplash.jpg': { key: 'valley-snow', title: 'Snowy valley' },
    'johannes-plenio-hvrpOmuMrAI-unsplash.jpg': { key: 'forest', title: 'Forest path' },
    'jonatan-pie-3l3RwQdHRHg-unsplash.jpg': { key: 'aurora', title: 'Aurora' },
    'jonatan-pie-h8nxGssjQXs-unsplash.jpg': { key: 'night-sky', title: 'Night sky' },
    'nasa-Q1p7bh3SHj8-unsplash.jpg': { key: 'earth', title: 'Earth at night' },
    'stefan-stefancik-TPv9dh822VA-unsplash.jpg': { key: 'milky-way', title: 'Milky Way' },
    'su-san-lee-E_eWwM29wfU-unsplash.jpg': { key: 'kyoto', title: 'Kyoto' },
    'urban-vintage-78A265wPiO4-unsplash.jpg': { key: 'hills', title: 'Golden hills' },
    'wil-stewart-pHANr-CpbYM-unsplash.jpg': { key: 'waterfall', title: 'Waterfall' }
};

// Darker at the top-left (clock) and towards the bottom (tiles and labels).
const SCRIM = [
    'radial-gradient(1300px 700px at 0% 0%, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)',
    'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.30) 30%, rgba(0,0,0,0.62) 62%, rgba(0,0,0,0.82) 100%)'
].join(',');

function credit(file) {
    const m = basename(file).match(/^(.*)-[A-Za-z0-9_-]{11}-unsplash\.jpe?g$/);
    if (!m) return '';
    return m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') + ' on Unsplash';
}

function entry(key, title, attribution) {
    return { key, title, file: `personal-wallpapers/${key}.jpg`,
        thumb: `personal-wallpapers/thumbs/${key}.jpg`, credit: attribution };
}

function readCatalog() {
    if (!statSync(catalogFile, { throwIfNoEntry: false })) {
        if (assetFiles(outDir).length) throw new Error('Personal wallpaper assets exist without a catalog.');
        return { includeOriginals: true, photos: [] };
    }
    const text = readFileSync(catalogFile, 'utf8');
    const match = text.match(/window\.PERSONAL_WALLPAPERS = (\{[\s\S]*?\});\n/);
    if (!match) throw new Error('Cannot read the personal wallpaper catalog.');
    const config = JSON.parse(match[1]);
    if (typeof config.includeOriginals !== 'boolean' || !Array.isArray(config.photos)) {
        throw new Error('Invalid personal wallpaper configuration.');
    }
    const catalog = config.photos;
    const keys = new Set();
    for (const item of catalog) {
        if (!item || !/^[a-z0-9][a-z0-9-]*$/.test(item.key) || keys.has(item.key) ||
            item.file !== `personal-wallpapers/${item.key}.jpg` ||
            item.thumb !== `personal-wallpapers/thumbs/${item.key}.jpg` ||
            typeof item.title !== 'string' || typeof item.credit !== 'string') {
            throw new Error('The existing wallpaper catalog contains an invalid or duplicate entry.');
        }
        keys.add(item.key);
        for (const file of [item.file, item.thumb]) {
            if (!statSync(personalAssetPath(file), { throwIfNoEntry: false })?.isFile()) {
                throw new Error(`Existing wallpaper asset is missing: ${file}`);
            }
        }
    }
    return config;
}

function originalKeys() {
    const text = readFileSync(originalsFile, 'utf8');
    const match = text.match(/window\.WALLPAPERS\s*=\s*(\[[\s\S]*\]);\s*$/);
    if (!match) throw new Error('Cannot read the original wallpaper catalog.');
    return JSON.parse(match[1]).map((item) => item.key);
}

function assetFiles(dir) {
    if (!statSync(dir, { throwIfNoEntry: false })) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((file) => {
        const path = join(dir, file.name);
        if (file.isDirectory()) return assetFiles(path);
        if (!file.isFile()) throw new Error(`Unsupported wallpaper asset: ${path}`);
        return [path];
    });
}

function inside(parent, child) {
    const path = relative(parent, child);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function removeEmptyFolders(dir) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (file.isDirectory()) removeEmptyFolders(join(dir, file.name));
    }
    if (dir !== outDir && !readdirSync(dir).length) rmdirSync(dir);
}

async function options() {
    let mode;
    let folder;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode' && !mode) {
            mode = args[++i];
            if (!mode) throw new Error('--mode requires add, replace, or restore.');
        }
        else if (!args[i].startsWith('-') && !folder) folder = args[i];
        else throw new Error('Usage: node scripts/prepare-wallpapers.mjs [photo-folder] [--mode add|replace|restore]');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        if (!mode) {
            if (!process.stdin.isTTY) throw new Error('Specify --mode add, replace, or restore when running non-interactively.');
            const choice = await rl.question(
                '1. Add personal photos and keep the current collection\n' +
                '2. Show only new personal photos (originals stay untouched)\n' +
                '3. Clear personal photos and show only originals\nChoice (1/2/3): ');
            mode = { '1': 'add', '2': 'replace', '3': 'restore' }[choice.trim()];
        }
        if (!['add', 'replace', 'restore'].includes(mode)) throw new Error('Choose add, replace, or restore.');
        if (mode === 'restore') {
            return { mode };
        }
        if (!folder && process.stdin.isTTY) folder = (await rl.question('Photo folder: ')).trim();
        if (!folder) throw new Error('Add and replace require a photo folder.');
        const sourceDir = resolve(folder);
        if (!statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory()) {
            throw new Error(`Photo folder does not exist: ${sourceDir}`);
        }
        if (inside(outDir, sourceDir) || inside(originalDir, sourceDir) ||
            inside(join(root, 'src/img/wallpapers'), sourceDir)) {
            throw new Error('Use original photos, not the generated or bundled wallpaper folders.');
        }
        return { mode, sourceDir };
    } finally {
        rl.close();
    }
}

async function main() {
    const { mode, sourceDir } = await options();
    ensurePersonalWallpapers();
    const config = mode === 'add' ? readCatalog() : { includeOriginals: mode === 'restore', photos: [] };
    const catalog = config.photos;
    const existingFiles = assetFiles(outDir);
    const usedKeys = new Set([...originalKeys(), ...catalog.map((item) => item.key)]);
    if (mode === 'add') {
        for (const file of existingFiles) usedKeys.add(basename(file, extname(file)));
    }
    const photos = sourceDir ? readdirSync(sourceDir).sort().filter((file) =>
        /\.(jpe?g|png|webp)$/i.test(file) && statSync(join(sourceDir, file)).isFile()) : [];
    if (sourceDir && !photos.length) throw new Error('The photo folder contains no JPEG, PNG, or WebP files.');

    const tmp = mkdtempSync(join(tmpdir(), 'wallpapers-'));
    const staged = join(tmp, 'assets');
    const thumbDir = join(staged, 'thumbs');
    mkdirSync(thumbDir, { recursive: true });
    try {
        if (mode !== 'restore') {
            for (const file of photos) {
                const dimensions = execFileSync('sips',
                    ['-g', 'pixelWidth', '-g', 'pixelHeight', join(sourceDir, file)], { encoding: 'utf8', stdio: 'pipe' });
                if (!/pixelWidth:\s*[1-9]\d*/.test(dimensions) || !/pixelHeight:\s*[1-9]\d*/.test(dimensions)) {
                    throw new Error(`Cannot decode source photo: ${file}`);
                }
                const info = KNOWN[file] || {};
                const baseKey = info.key || basename(file, extname(file)).toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'photo';
                let key = baseKey;
                for (let suffix = 2; usedKeys.has(key); suffix++) key = `${baseKey}-${suffix}`;
                usedKeys.add(key);
                const html = join(tmp, `${key}.html`);
                const png = join(tmp, `${key}.png`);
                const src = pathToFileURL(join(sourceDir, file)).href.replace(/'/g, '%27');
                writeFileSync(html, `<!DOCTYPE html><body style="margin:0;width:1920px;height:1080px;background:${SCRIM},` +
                    `url('${src}') ${info.position || 'center'} / cover no-repeat #000"></body>`);
                execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080',
                    '--allow-file-access-from-files', '--virtual-time-budget=5000', `--user-data-dir=${join(tmp, 'profile')}`,
                    `--screenshot=${png}`, pathToFileURL(html).href], { stdio: 'pipe' });
                const out = join(staged, `${key}.jpg`);
                execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', out], { stdio: 'pipe' });
                execFileSync('sips', ['-Z', '320', '-s', 'formatOptions', '78', out,
                    '--out', join(thumbDir, `${key}.jpg`)], { stdio: 'pipe' });
                catalog.push(entry(key, info.title || baseKey, credit(file)));
                console.log(`${key}.jpg  ${(statSync(out).size / 1024).toFixed(0)} KB`);
            }
        }

        // Render the entire batch before changing any existing assets.
        mkdirSync(join(outDir, 'thumbs'), { recursive: true });
        for (const file of assetFiles(staged)) {
            copyFileSync(file, join(outDir, relative(staged, file)));
        }
        writeFileSync(catalogFile, catalogScript(catalog, config.includeOriginals));
        if (mode !== 'add') {
            const retained = new Set(catalog.flatMap((item) =>
                [personalAssetPath(item.file), personalAssetPath(item.thumb)]));
            retained.add(catalogFile);
            for (const file of existingFiles) {
                if (!retained.has(file)) rmSync(file);
            }
            removeEmptyFolders(outDir);
        }
        console.log(`${mode}: ${catalog.length} personal wallpapers; originals ${config.includeOriginals ? 'shown' : 'hidden'}.`);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
});

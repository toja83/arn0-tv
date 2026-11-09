import { cpSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const personalDir = resolve(import.meta.dirname, '../.personal-wallpapers');

export function personalAssetPath(file) {
    return join(personalDir, file.slice('personal-wallpapers/'.length));
}

export function catalogScript(photos, includeOriginals) {
    return '/* Private generated wallpapers. Do not commit this directory. */\n' +
        'window.PERSONAL_WALLPAPERS = ' + JSON.stringify({ includeOriginals, photos }, null, 4) + ';\n' +
        'window.WALLPAPERS = (window.PERSONAL_WALLPAPERS.includeOriginals ? window.WALLPAPERS : [])' +
        '.concat(window.PERSONAL_WALLPAPERS.photos);\n';
}

export function ensurePersonalWallpapers() {
    const file = join(personalDir, 'catalog.js');
    if (!statSync(file, { throwIfNoEntry: false })) {
        mkdirSync(personalDir, { recursive: true });
        writeFileSync(file, catalogScript([], true), { flag: 'wx' });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    ensurePersonalWallpapers();
    if (process.argv[2]) {
        const stage = resolve(process.argv[2]);
        cpSync(resolve(import.meta.dirname, '../src'), stage, { recursive: true });
        cpSync(personalDir, join(stage, 'personal-wallpapers'), { recursive: true });
    }
}

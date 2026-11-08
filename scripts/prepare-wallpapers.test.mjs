import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('add preserves assets, replace removes extras, and restore recovers exactly the original set', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wallpaper-test-'));
    try {
        mkdirSync(join(fixture, 'scripts/assets'), { recursive: true });
        mkdirSync(join(fixture, 'src/js'), { recursive: true });
        mkdirSync(join(fixture, 'photos'));
        copyFileSync(join(root, 'scripts/prepare-wallpapers.mjs'), join(fixture, 'scripts/prepare-wallpapers.mjs'));
        cpSync(join(root, 'scripts/assets/original-wallpapers'), join(fixture, 'scripts/assets/original-wallpapers'), { recursive: true });
        const script = join(fixture, 'scripts/prepare-wallpapers.mjs');
        const assets = join(fixture, 'src/img/wallpapers');
        const catalogFile = join(fixture, 'src/js/wallpapers.js');
        const run = (...args) => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
        const catalog = () => JSON.parse(readFileSync(catalogFile, 'utf8').match(/window\.WALLPAPERS = (\[[\s\S]*\]);/)[1]);
        const snapshot = () => catalog().map((item) => [
            item, readFileSync(join(fixture, 'src', item.file)), readFileSync(join(fixture, 'src', item.thumb))
        ]);
        const fail = (...args) => assert.notEqual(spawnSync(process.execPath, [script, ...args], { stdio: 'pipe' }).status, 0);

        run('--mode', 'restore');
        const original = snapshot();
        assert.equal(original.length, 10);
        fail('--mode', 'replace', join(fixture, 'photos'));
        fail('--mode');
        fail('--mode', 'invalid');
        fail('--mode', 'add', join(fixture, 'missing'));
        fail();
        assert.deepEqual(snapshot(), original);

        writeFileSync(join(fixture, 'photos/broken.jpg'), 'not an image');
        fail('--mode', 'replace', join(fixture, 'photos'));
        assert.deepEqual(snapshot(), original);
        rmSync(join(fixture, 'photos/broken.jpg'));
        copyFileSync(join(assets, 'forest.jpg'), join(fixture, 'photos/forest.jpg'));
        copyFileSync(join(assets, 'forest.jpg'), join(fixture, 'photos/forest.png'));
        run(join(fixture, 'photos'), '--mode', 'add');
        assert.equal(catalog().length, 12);
        assert.deepEqual(catalog().slice(-2).map((item) => item.key), ['forest-2', 'forest-3']);
        assert.deepEqual(snapshot().slice(0, 10), original);
        const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(assets, 'forest-2.jpg')], { encoding: 'utf8' });
        assert.match(dimensions, /pixelWidth: 1920/);
        assert.match(dimensions, /pixelHeight: 1080/);
        const thumbnail = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(assets, 'thumbs/forest-2.jpg')], { encoding: 'utf8' });
        assert.match(thumbnail, /pixelWidth: 320/);
        assert.match(thumbnail, /pixelHeight: 180/);

        mkdirSync(join(assets, 'extras'));
        writeFileSync(join(assets, 'extras/unused.txt'), 'unused');
        run('--mode', 'replace', join(fixture, 'photos'));
        assert.deepEqual(catalog().map((item) => item.key), ['forest', 'forest-2']);
        assert.deepEqual(readdirSync(assets).sort(), ['forest-2.jpg', 'forest.jpg', 'thumbs']);
        assert.deepEqual(readdirSync(join(assets, 'thumbs')).sort(), ['forest-2.jpg', 'forest.jpg']);

        const replaced = snapshot();
        const missing = join(fixture, 'scripts/assets/original-wallpapers/forest.jpg');
        rmSync(missing);
        fail('--mode', 'restore');
        assert.deepEqual(snapshot(), replaced);
        copyFileSync(join(root, 'scripts/assets/original-wallpapers/forest.jpg'), missing);

        run('--mode', 'restore');
        assert.deepEqual(snapshot(), original);
        assert.equal(readdirSync(assets).length, 11);
        assert.equal(readdirSync(join(assets, 'thumbs')).length, 10);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});

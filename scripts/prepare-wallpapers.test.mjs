import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('personal collections stay private, load in preview/package, and never modify originals', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wallpaper-test-'));
    let server;
    try {
        mkdirSync(join(fixture, 'scripts'), { recursive: true });
        mkdirSync(join(fixture, 'src/js'), { recursive: true });
        mkdirSync(join(fixture, 'src/img'), { recursive: true });
        mkdirSync(join(fixture, 'photos'));
        for (const script of ['prepare-wallpapers.mjs', 'personal-wallpapers.mjs', 'serve.mjs']) {
            copyFileSync(join(root, 'scripts', script), join(fixture, 'scripts', script));
        }
        cpSync(join(root, 'src/img/wallpapers'), join(fixture, 'src/img/wallpapers'), { recursive: true });
        copyFileSync(join(root, 'src/js/wallpapers.js'), join(fixture, 'src/js/wallpapers.js'));
        copyFileSync(join(root, 'src/index.html'), join(fixture, 'src/index.html'));
        copyFileSync(join(root, '.gitignore'), join(fixture, '.gitignore'));
        const script = join(fixture, 'scripts/prepare-wallpapers.mjs');
        const assets = join(fixture, '.personal-wallpapers');
        const catalogFile = join(assets, 'catalog.js');
        const run = (...args) => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
        const catalog = () => {
            const window = {};
            runInNewContext(readFileSync(join(fixture, 'src/js/wallpapers.js'), 'utf8'), { window });
            runInNewContext(readFileSync(catalogFile, 'utf8'), { window });
            return JSON.parse(JSON.stringify(window.WALLPAPERS));
        };
        const files = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((file) => file.isDirectory() ? files(join(dir, file.name)) :
                [[join(dir, file.name), readFileSync(join(dir, file.name))]]);
        const originals = () => [
            readFileSync(join(fixture, 'src/js/wallpapers.js')),
            ...files(join(fixture, 'src/img/wallpapers'))
        ];
        const original = originals();
        const fail = (...args) => assert.notEqual(spawnSync(process.execPath, [script, ...args], { stdio: 'pipe' }).status, 0);

        execFileSync(process.execPath, [join(fixture, 'scripts/personal-wallpapers.mjs')]);
        const initial = catalog();
        assert.equal(initial.length, 10);
        fail('--mode', 'replace', join(fixture, 'photos'));
        fail('--mode');
        fail('--mode', 'invalid');
        fail('--mode', 'add', join(fixture, 'missing'));
        fail();
        writeFileSync(join(fixture, 'photos/broken.jpg'), 'not an image');
        fail('--mode', 'replace', join(fixture, 'photos'));
        assert.deepEqual(catalog(), initial);
        rmSync(join(fixture, 'photos/broken.jpg'));

        copyFileSync(join(fixture, 'src/img/wallpapers/forest.jpg'), join(fixture, 'photos/forest.jpg'));
        copyFileSync(join(fixture, 'photos/forest.jpg'), join(fixture, 'photos/forest.png'));
        run(join(fixture, 'photos'), '--mode', 'add');
        assert.equal(catalog().length, 12);
        assert.deepEqual(catalog().slice(-2).map((item) => item.key), ['forest-2', 'forest-3']);
        assert.deepEqual(catalog().slice(0, 10), initial);
        assert.deepEqual(originals(), original);
        for (const [file, width, height] of [['forest-2.jpg', 1920, 1080], ['thumbs/forest-2.jpg', 320, 180]]) {
            const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(assets, file)], { encoding: 'utf8' });
            assert.match(dimensions, new RegExp(`pixelWidth: ${width}`));
            assert.match(dimensions, new RegExp(`pixelHeight: ${height}`));
        }
        const added = files(assets);
        run(join(fixture, 'photos'), '--mode', 'add');
        assert.equal(catalog().length, 14);
        for (const [file, data] of added.filter(([file]) => file !== catalogFile)) {
            assert.deepEqual(readFileSync(file), data);
        }

        execFileSync('git', ['init', '-q', fixture]);
        for (const file of ['.personal-wallpapers/catalog.js', '.personal-wallpapers/forest-2.jpg',
            '.personal-wallpapers/thumbs/forest-2.jpg']) {
            execFileSync('git', ['check-ignore', '-q', file], { cwd: fixture });
        }
        const archive = join(fixture, 'preview-package.zip');
        const stage = join(fixture, 'staging');
        execFileSync(process.execPath, [join(fixture, 'scripts/personal-wallpapers.mjs'), stage]);
        assert.equal(existsSync(join(fixture, 'src/personal-wallpapers')), false);
        // Use the build's archive selection, without building/signing a TV package.
        execFileSync('zip', ['-q', '-r', '-X', archive, '.', '-x', '*.DS_Store', '-x', '.*', '-x', 'img/marks/*'],
            { cwd: stage });
        const archivedCatalog = execFileSync('unzip', ['-p', archive, 'personal-wallpapers/catalog.js']);
        assert.deepEqual(archivedCatalog, readFileSync(catalogFile));
        assert.deepEqual(execFileSync('unzip', ['-p', archive, 'personal-wallpapers/forest-2.jpg']),
            readFileSync(join(assets, 'forest-2.jpg')));
        assert.match(readFileSync(join(root, 'scripts/build.sh'), 'utf8'), /node scripts\/personal-wallpapers\.mjs/);

        const port = 20000 + Math.floor(Math.random() * 20000);
        server = spawn(process.execPath, [join(fixture, 'scripts/serve.mjs')], {
            env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
        });
        await Promise.race([
            once(server.stdout, 'data'),
            once(server, 'exit').then(([code]) => { throw new Error(`Preview exited: ${code}`); })
        ]);
        const base = `http://127.0.0.1:${port}`;
        assert.match(await (await fetch(base)).text(), /src="personal-wallpapers\/catalog.js"/);
        assert.equal(await (await fetch(`${base}/personal-wallpapers/catalog.js`)).text(), archivedCatalog.toString());
        const image = await fetch(`${base}/personal-wallpapers/forest-2.jpg`);
        assert.equal(image.status, 200);
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), readFileSync(join(assets, 'forest-2.jpg')));

        mkdirSync(join(assets, 'extras'));
        writeFileSync(join(assets, 'extras/unused.txt'), 'unused');
        run('--mode', 'replace', join(fixture, 'photos'));
        assert.deepEqual(catalog().map((item) => item.key), ['forest-2', 'forest-3']);
        assert.deepEqual(readdirSync(assets).sort(), ['catalog.js', 'forest-2.jpg', 'forest-3.jpg', 'thumbs']);
        assert.deepEqual(originals(), original);
        execFileSync(process.execPath, [join(fixture, 'scripts/personal-wallpapers.mjs')]);
        assert.equal(catalog().length, 2);
        run('--mode', 'add', join(fixture, 'photos'));
        assert.equal(catalog().length, 4);
        assert.ok(catalog().every((item) => item.file.startsWith('personal-wallpapers/')));
        const beforeFailure = files(assets);
        rmSync(join(assets, 'forest-2.jpg'));
        fail('--mode', 'add', join(fixture, 'photos'));
        copyFileSync(join(fixture, 'photos/forest.jpg'), join(assets, 'forest-2.jpg'));
        writeFileSync(catalogFile, 'invalid catalog');
        fail('--mode', 'add', join(fixture, 'photos'));
        writeFileSync(catalogFile, beforeFailure.find(([file]) => file === catalogFile)[1]);

        run('--mode', 'restore');
        assert.deepEqual(catalog(), initial);
        assert.deepEqual(readdirSync(assets), ['catalog.js']);
        assert.deepEqual(originals(), original);
    } finally {
        if (server && server.exitCode === null) {
            server.kill();
            await once(server, 'exit');
        }
        rmSync(fixture, { recursive: true, force: true });
    }
});

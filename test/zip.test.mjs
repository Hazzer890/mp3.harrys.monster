import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { zip } from '../js/zip.js';

test('zip: STORE archive of blobs, verified by unzip', async () => {
  const big = new Uint8Array(5 << 20).map((_, i) => i * 7 & 255);
  const out = await zip([{ name: 'a/one.mp3', blob: new Blob([big]) }, { name: 'twö.txt', blob: new Blob(['hello']) }]);
  assert.ok(out instanceof Blob);
  assert.equal(out.size, big.length + 5 + 2 * 30 + 2 * 46 + 22 + 2 * ('a/one.mp3'.length + 'twö.txt'.length + 1), 'STORE overhead only');
  const path = '/tmp/claude-1000/zip-test.zip';
  await writeFile(path, new Uint8Array(await out.arrayBuffer()));
  const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
  if (r.error) return; // unzip missing; size check above still ran
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No errors detected/);
  // unzip mangles UTF-8 names outside a UTF-8 locale; python reads the flag 0x800 name properly
  const py = spawnSync('python3', ['-c', `import zipfile; print(zipfile.ZipFile('${path}').read('twö.txt').decode(), end='')`], { encoding: 'utf8' });
  assert.equal(py.stdout, 'hello', py.stderr);
});

test('zip: refuses over 4 GB', async () => {
  const fake = { size: 0x100000000, slice: () => new Blob([]) };
  await assert.rejects(zip([{ name: 'x', blob: fake }]), /4 GB/);
});

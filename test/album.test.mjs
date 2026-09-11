import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, textFrame, apicFrame, parse, text } from '../js/id3.js';
import { load, group, defaults, numbers, diagnose, apply } from '../js/album.js';

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0]);
const file = (name, bytes) => new File([bytes], name);
const mk = (name, tags, extra = []) => load(file(name, build([...Object.entries(tags).map(([k, v]) => textFrame(k, v)), ...extra], AUDIO)));
const fixture = async name => file(name, await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const bytes = async blob => new Uint8Array(await blob.arrayBuffer());

test('load: info from frames', async () => {
  const t = await mk('01.mp3', { TIT2: 'S', TPE1: 'A', TALB: 'L', TPE2: 'AA', TYER: '1999', TRCK: '3/10', TCMP: '1' }, [apicFrame(new Uint8Array([9, 9]))]);
  assert.deepEqual(t.info, { title: 'S', artist: 'A', album: 'L', albumArtist: 'AA', year: '1999', track: 3, compilation: true, art: new Uint8Array([9, 9]), version: 3 });
  assert.equal((await mk('x.mp3', {})).info.track, null);
  assert.deepEqual(await bytes(t.audio), AUDIO, 'audio is a slice of the file after the tag');
});

test('group: by album ignoring case and space, natural order, Untitled', async () => {
  const g = group(await Promise.all([mk('10.mp3', { TALB: 'Alb ' }), mk('2.mp3', { TALB: 'alb' }), mk('1.mp3', { TALB: 'Alb' }), mk('z.mp3', { TIT2: 'lonely' })]));
  assert.deepEqual(g.map(x => x.label), ['Alb', 'Untitled']);
  assert.deepEqual(g[0].tracks.map(t => t.name), ['1.mp3', '2.mp3', '10.mp3']);
});

test('defaults: same artist keeps it, mixed gives Various Artists', async () => {
  const same = group(await Promise.all([mk('a.mp3', { TPE1: 'X', TALB: 'L', TYER: '2001' }), mk('b.mp3', { TPE1: 'X', TALB: 'L', TYER: '2001' }), mk('c.mp3', { TPE1: 'X', TALB: 'L', TDRC: '2002-01-01' })]))[0];
  assert.deepEqual(defaults(same), { album: 'L', albumArtist: 'X', year: '2001' });
  const mixed = group(await Promise.all([mk('a.mp3', { TPE1: 'X', TPE2: 'X' }), mk('b.mp3', { TPE1: 'Y', TPE2: 'X' })]))[0];
  assert.equal(defaults(mixed).albumArtist, 'Various Artists');
});

test('numbers: kept when complete, else by file order', async () => {
  assert.deepEqual(numbers(group(await Promise.all([mk('b.mp3', { TRCK: '2' }), mk('a.mp3', { TRCK: '1/2' })]))[0]), [1, 2]);
  assert.deepEqual(numbers(group(await Promise.all([mk('b.mp3', { TRCK: '7' }), mk('a.mp3', {})]))[0]), [1, 2]);
});

test('diagnose: lists causes from the input tags; cover comes from the form', async () => {
  const g = group(await Promise.all([mk('a.mp3', { TALB: 'Alb', TPE2: 'X', TCMP: '1' }), mk('b.mp3', { TALB: 'alb ', TRCK: '1' })]))[0];
  const d = diagnose(g, { album: '', albumArtist: '', year: '' });
  assert.ok(d.some(s => /spelling|case|space/i.test(s)));
  assert.ok(d.some(s => /album artist/i.test(s)));
  assert.ok(d.some(s => /compilation/i.test(s)));
  assert.ok(d.some(s => /cover/i.test(s)));
  assert.ok(d.some(s => /track number/i.test(s)));
  assert.ok(!diagnose(g, { cover: new Uint8Array([1]) }).some(s => /cover/i.test(s)));
  const v24 = group([await load(file('v.mp3', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb])))])[0];
  assert.ok(diagnose(v24, {}).some(s => /2\.4/.test(s)));
});

test('apply: writes form, TCMP rule, TRCK n/total, cover, verifies', async () => {
  const t = await mk('a.mp3', { TIT2: 'S', TALB: 'old', TPE2: 'old', TYER: '1990', TCMP: '1' });
  const out = parse(await bytes(apply(t, { album: 'New', albumArtist: 'Band', year: '2020' }, new Uint8Array([7]), 2, 9)));
  const get = id => { const f = out.frames.find(f => f.id === id); return f && text(f); };
  assert.equal(out.version, 3);
  assert.equal(get('TALB'), 'New'); assert.equal(get('TPE2'), 'Band'); assert.equal(get('TYER'), '2020'); assert.equal(get('TRCK'), '2/9');
  assert.equal(get('TCMP'), undefined);
  assert.equal(get('TIT2'), 'S');
  assert.ok(out.frames.find(f => f.id === 'APIC'));
  assert.deepEqual(out.audio, AUDIO);
  const va = parse(await bytes(apply(t, { album: 'New', albumArtist: 'Various Artists', year: '' }, null, 1, 1)));
  assert.equal(text(va.frames.find(f => f.id === 'TCMP')), '1');
  assert.ok(!va.frames.find(f => f.id === 'TYER'));
  assert.ok(!va.frames.find(f => f.id === 'APIC'));
});

test('apply: real fixtures keep audio', async () => {
  for (const name of ['v23.mp3', 'v24.mp3', 'v1.mp3', 'raw.mp3']) {
    const t = await load(await fixture(name));
    const out = parse(await bytes(apply(t, { album: 'A', albumArtist: 'B', year: '2000' }, null, 1, 1)));
    assert.deepEqual(out.audio, await bytes(t.audio), name);
    assert.ok(out.audio.length > 1000, name);
    assert.equal(out.version, 3, name);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, build, text, textFrame, encodeUtf16, normalise, apicFrame, decode, ORDER } from '../js/id3.js';

const ASCII = (b, s, e) => new TextDecoder('latin1').decode(b.subarray(s, e));
const fixture = async name => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const latin = s => new TextEncoder().encode(s);
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const be32 = n => new Uint8Array([n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
const ss32 = n => new Uint8Array([n >>> 21 & 127, n >>> 14 & 127, n >>> 7 & 127, n & 127]);
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

// Hand-rolled tag builders so tests do not depend on build() for reading.
const tag = (major, flags, body) => cat(latin('ID3'), new Uint8Array([major, 0, flags]), ss32(body.length), body);
const frame23 = (id, data) => cat(latin(id), be32(data.length), new Uint8Array([0, 0]), data);
const frame24 = (id, data, fflags = 0) => cat(latin(id), ss32(data.length), new Uint8Array([0, fflags]), data);
const frame22 = (id, data) => cat(latin(id), new Uint8Array([data.length >>> 16, data.length >>> 8 & 255, data.length & 255]), data);
const t = (s, enc = 0) => enc === 0 ? cat(new Uint8Array([0]), latin(s)) : enc === 3 ? cat(new Uint8Array([3]), new TextEncoder().encode(s)) : cat(new Uint8Array([1]), encodeUtf16(s));
const get = (frames, id) => frames.find(f => f.id === id);

test('parse: no tag', () => {
  const r = parse(AUDIO);
  assert.equal(r.version, 0);
  assert.deepEqual(r.frames, []);
  assert.deepEqual(r.audio, AUDIO);
});

test('parse: v2.3 text frames, latin1 and UTF-16', () => {
  const body = cat(frame23('TIT2', t('Hello')), frame23('TALB', t('Ålbum', 1)), new Uint8Array(20));
  const r = parse(cat(tag(3, 0, body), AUDIO));
  assert.equal(r.version, 3);
  assert.equal(text(get(r.frames, 'TIT2')), 'Hello');
  assert.equal(text(get(r.frames, 'TALB')), 'Ålbum');
  assert.equal(r.frames.length, 2, 'padding is not a frame');
  assert.deepEqual(r.audio, AUDIO);
});

test('parse: v2.3 tag-level unsync and extended header', () => {
  // Frame data contains FF E0 which unsync turns into FF 00 E0.
  const data = new Uint8Array([0, 0x41, 0xff, 0xe0, 0x42]);
  const rawFrame = frame23('TXXX', data);
  const unsynced = []; for (const b of cat(new Uint8Array([0, 0, 0, 6, 0, 0, 0, 0, 0, 0]), rawFrame)) { unsynced.push(b); if (b === 0xff) unsynced.push(0); }
  // extended header: size 6 (not syncsafe), 2 flag bytes, 4 padding-size bytes
  const r = parse(cat(tag(3, 0xc0, new Uint8Array(unsynced)), AUDIO));
  assert.deepEqual([...get(r.frames, 'TXXX').data], [...data]);
  assert.deepEqual(r.audio, AUDIO);
});

test('parse: v2.4 syncsafe sizes, UTF-8, frame unsync, data length indicator, footer', () => {
  const pic = new Uint8Array([0, 0xff, 0xe0, 7]);
  const picUnsynced = new Uint8Array([0, 0xff, 0, 0xe0, 7]);
  const body = cat(
    frame24('TIT2', t('Ünï', 3)),
    frame24('TDRC', t('2004-05-06', 3)),
    frame24('TPE1', cat(new Uint8Array([3]), new TextEncoder().encode('A\0B'))),
    frame24('APIC', cat(ss32(pic.length), picUnsynced), 0x03),
  );
  const footer = cat(latin('3DI'), new Uint8Array([4, 0, 0x10]), ss32(body.length));
  const r = parse(cat(tag(4, 0x10, body), footer, AUDIO));
  assert.equal(r.version, 4);
  assert.equal(text(get(r.frames, 'TIT2')), 'Ünï');
  assert.equal(text(get(r.frames, 'TDRC')), '2004-05-06');
  assert.equal(text(get(r.frames, 'TPE1')), 'A/B');
  assert.deepEqual([...get(r.frames, 'APIC').data], [...pic]);
  assert.deepEqual(r.audio, AUDIO);
});

test('parse: v2.2 ids are mapped, unknown dropped', () => {
  const body = cat(frame22('TT2', t('Old')), frame22('TAL', t('Rec')), frame22('ZZZ', t('x')));
  const r = parse(cat(tag(2, 0, body), AUDIO));
  assert.equal(r.version, 2);
  assert.equal(text(get(r.frames, 'TIT2')), 'Old');
  assert.equal(text(get(r.frames, 'TALB')), 'Rec');
  assert.equal(r.frames.length, 2);
});

test('parse: ID3v1 trailer is dropped, consecutive v2 tags skipped', () => {
  const v1 = cat(latin('TAG'), new Uint8Array(125));
  const r = parse(cat(tag(3, 0, frame23('TIT2', t('a'))), tag(3, 0, frame23('TIT2', t('b'))), AUDIO, v1));
  assert.deepEqual(r.audio, AUDIO);
  assert.equal(text(get(r.frames, 'TIT2')), 'a', 'first tag wins');
});

test('parse: real ffmpeg fixtures', async () => {
  const a = parse(await fixture('v23.mp3'));
  assert.equal(a.version, 3);
  assert.equal(text(get(a.frames, 'TIT2')), 'Track One');
  assert.equal(text(get(a.frames, 'TRCK')), '1');
  const b = parse(await fixture('v24.mp3'));
  assert.equal(b.version, 4);
  assert.equal(text(get(b.frames, 'TALB')), 'some album ');
  assert.ok(get(b.frames, 'TXXX'), 'ffmpeg stores comment= as TXXX');
  const c = parse(await fixture('v1.mp3'));
  assert.notEqual(new TextDecoder().decode(c.audio.slice(-128, -125)), 'TAG');
  const d = parse(await fixture('raw.mp3'));
  assert.equal(d.version, 0);
  assert.equal(d.audio[0], 0xff);
});

test('build: v2.3 header, fixed order, padding, round-trips', () => {
  const frames = [textFrame('TCON', 'Rock'), textFrame('TIT2', 'Song'), { id: 'TXXX', data: cat(new Uint8Array([0]), latin('k\0v')) }, textFrame('TALB', 'Alb')];
  const out = build(frames, AUDIO);
  assert.equal(ASCII(out, 0, 3), 'ID3');
  assert.equal(out[3], 3); assert.equal(out[5], 0);
  const r = parse(out);
  assert.equal(r.version, 3);
  assert.deepEqual(r.frames.map(f => f.id), ['TIT2', 'TALB', 'TCON', 'TXXX']);
  assert.equal(text(get(r.frames, 'TIT2')), 'Song');
  assert.equal(get(r.frames, 'TIT2').data[0], 1, 'UTF-16');
  assert.deepEqual(r.audio, AUDIO);
  const tagSize = out[6] << 21 | out[7] << 14 | out[8] << 7 | out[9];
  assert.ok(tagSize >= 1024, 'padding present');
  assert.ok(ORDER.includes('TIT2'));
});

test('normalise: drops junk, re-encodes text, TDRC to TYER', () => {
  const frames = [
    { id: 'COMM', data: t('x') }, { id: 'PRIV', data: t('x') }, { id: 'WXXX', data: t('x') }, { id: 'WOAR', data: t('x') },
    { id: 'UFID', data: t('x') }, { id: 'GEOB', data: t('x') }, { id: 'POPM', data: t('x') }, { id: 'MCDI', data: t('x') }, { id: 'APIC', data: t('x') },
    { id: 'TIT2', data: t('Latin', 0) }, { id: 'TPE1', data: t('Utf8 ü', 3) }, { id: 'TDRC', data: t('1999-12-31', 3) }, { id: 'TDRL', data: t('1999', 3) },
    { id: 'TXXX', data: cat(new Uint8Array([3]), new TextEncoder().encode('REPLAYGAIN\0-3.2 dB')) }, { id: 'USLT', data: t('lyrics') },
  ];
  const n = normalise(frames);
  assert.deepEqual(n.map(f => f.id), ['TIT2', 'TPE1', 'TYER', 'TXXX', 'USLT']);
  assert.equal(text(get(n, 'TIT2')), 'Latin');
  assert.equal(text(get(n, 'TPE1')), 'Utf8 ü');
  assert.equal(text(get(n, 'TYER')), '1999');
  const tx = get(n, 'TXXX').data;
  assert.equal(tx[0], 1);
  assert.equal(decode(tx.subarray(1), 1).split('\0')[0], 'REPLAYGAIN');
  assert.equal(decode(tx.subarray(1), 1).split('\0')[1].replace(/^﻿/, ''), '-3.2 dB');
  for (const f of n) if (f.id[0] === 'T') assert.equal(f.data[0], 1, `${f.id} is UTF-16`);
});

test('apicFrame: front cover jpeg', () => {
  const f = apicFrame(new Uint8Array([0xff, 0xd8, 1]));
  assert.equal(f.id, 'APIC');
  assert.equal(ASCII(f.data, 1, 11), 'image/jpeg');
  assert.equal(f.data[12], 3);
  assert.deepEqual([...f.data.subarray(-3)], [0xff, 0xd8, 1]);
});

test('build: real fixture round-trip keeps audio identical', async () => {
  const src = parse(await fixture('v24.mp3'));
  const out = parse(build([...normalise(src.frames), apicFrame(new Uint8Array([1]))], src.audio));
  assert.equal(out.version, 3);
  assert.deepEqual(out.audio, src.audio);
  assert.ok(get(out.frames, 'APIC'));
  assert.equal(out.frames.at(-1).id, 'APIC');
  assert.ok(!get(out.frames, 'COMM'));
});

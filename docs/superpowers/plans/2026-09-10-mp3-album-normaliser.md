# mp3.harrys.monster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static page at mp3.harrys.monster that rewrites an album's MP3 tags as clean ID3v2.3 with one cover so iTunes on Windows shows it as one album.

**Architecture:** Plain HTML/CSS/JS, no build step, copied styling from `../metadata.harrys.monster`. `js/id3.js` parses any ID3v2 tag and builds v2.3; `js/album.js` groups tracks, computes defaults and diagnosis, and applies the form; `js/art.js` resizes covers and searches iTunes; `js/app.js` does DOM and zip. Only the last two touch the browser.

**Tech Stack:** ES modules, `node --test` (Node 24), vendored `jszip.min.js`, Cloudflare Worker static assets via wrangler.

**Spec:** `docs/superpowers/specs/2026-09-10-mp3-album-normaliser-design.md`

## Global Constraints

- MP3 only. Never decode MPEG; audio bytes are copied unchanged.
- Output tag is always ID3v2.3, text frames UTF-16 with BOM, no unsync, no extended header, 1024 bytes padding.
- Drop frames: COMM, PRIV, W*, UFID, GEOB, POPM, MCDI, APIC. Keep all others.
- Album Artist exactly `Various Artists` writes TCMP=1; anything else removes TCMP.
- Cover: square centre-crop, longest side 1400 px, JPEG quality 0.9, APIC type 3 `image/jpeg`.
- TRCK always `n/total`; renumber from natural file-name order only if any track lacks a leading integer.
- Nothing leaves the browser except the iTunes search request.
- Zip per group named `<Album>.zip`; `albums.zip` with one folder per group when more than one group.
- Site lives in `/home/harry/Documents/harrys.monster-sites/mp3.harrys.monster`, its own git repo (already initialised, spec committed). Commit messages end with `Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX`.
- No new dependencies. No framework.

---

### Task 1: Scaffold from the metadata site

**Files:**
- Create: `package.json`, `.gitignore`, `.assetsignore`, `wrangler.jsonc`, `_headers`, `index.html`, `css/*`, `js/background.js`, `vendor/jszip.min.js`, `test/fixtures/make.sh`

**Interfaces:**
- Produces: the page shell with ids `dropzone`, `file-input`, `browse`, `cards`, `download-all`, `skipped`, and templates `card-tpl`, `row-tpl`, `art-tpl` that Task 6 fills.

- [ ] **Step 1: Copy shared assets**

```bash
cd /home/harry/Documents/harrys.monster-sites/mp3.harrys.monster
M=../metadata.harrys.monster
mkdir -p css js vendor test/fixtures
cp $M/css/*.css css/ && cp $M/js/background.js js/ && cp $M/vendor/jszip.min.js vendor/
cp $M/.gitignore $M/.assetsignore .
cat > package.json <<'EOF'
{
  "name": "mp3-harrys-monster",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": { "test": "node --test" }
}
EOF
cat > wrangler.jsonc <<'EOF'
{
  "name": "mp3",
  "compatibility_date": "2026-07-01",
  "assets": { "directory": "." },
  "routes": [{ "pattern": "mp3.harrys.monster", "custom_domain": true }]
}
EOF
```

- [ ] **Step 2: Write `_headers`**

Copy `$M/_headers` and change only the CSP: add `https://*.mzstatic.com` and `https://itunes.apple.com` to `connect-src`, add `blob:` and `https://*.mzstatic.com` to `img-src`. Result:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-uRJXG8QMWf4FHC1Ze7+fprkjML2qie/Av5xLCAafg3A='; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.mzstatic.com; connect-src 'self' https://analytics.harrys.monster https://itunes.apple.com https://*.mzstatic.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://analytics.harrys.monster
```

- [ ] **Step 3: Write `index.html`**

Copy `$M/index.html`. Keep the `<head>` verbatim (including the analytics inline script, byte for byte, its hash is in `_headers`) except: description meta `Fix the tags on an album's MP3s so iTunes shows one album with one cover. Runs in your browser, nothing is uploaded.`, canonical `https://mp3.harrys.monster/`, title `MP3 album fixer | Harry Cassidy`. Keep the SVG filter defs, background mount, header (nav-title `MP3 album fixer`) and footer. Replace `<main>` and the template with:

```html
  <main class="app container">
    <div class="intro">
      <h1>One album, one cover, in iTunes</h1>
      <p>iTunes on Windows splits an album when the tracks disagree about album artist, compilation flag or spelling, and drops art it can't read. Drop the album's MP3s, check three fields, pick a cover, download a zip that imports as one album.</p>
    </div>

    <div class="dropzone glass" id="dropzone">
      <input type="file" id="file-input" multiple accept=".mp3,audio/mpeg,image/*" hidden>
      <p>Drop MP3s (and a cover image) here, or <button type="button" class="btn btn-ghost" id="browse">browse</button></p>
      <p class="dropzone-hint">Tags are rewritten as ID3v2.3, the version iTunes on Windows reads reliably. Audio is untouched.</p>
    </div>

    <p class="skipped" id="skipped"></p>
    <div class="cards" id="cards" aria-live="polite"></div>
    <div class="card-actions"><button type="button" class="btn btn-primary" id="download-all" hidden>Download all albums</button></div>
  </main>

  <template id="card-tpl">
    <section class="card glass album">
      <div class="album-grid">
        <div class="art">
          <img class="art-img" alt="" hidden>
          <div class="art-empty">No cover</div>
          <div class="art-actions">
            <button type="button" class="btn btn-ghost art-file">Use file</button>
            <input type="file" class="art-input" accept="image/*" hidden>
            <button type="button" class="btn btn-ghost art-search">Search</button>
          </div>
          <div class="art-results"></div>
        </div>
        <div class="fields">
          <label>Album <input class="f-album" type="text"></label>
          <label>Album artist <input class="f-artist" type="text" list="artist-list"></label>
          <label>Year <input class="f-year" type="text" inputmode="numeric" maxlength="4"></label>
        </div>
      </div>
      <div class="meta-wrap">
        <table class="meta">
          <thead><tr><th scope="col">#</th><th scope="col">Title</th><th scope="col">Artist</th><th scope="col">Tag</th><th scope="col">Size</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <ul class="diagnosis"></ul>
      <div class="card-actions"><button type="button" class="btn btn-primary card-download">Download zip</button></div>
      <p class="card-note"></p>
      <p class="card-error" role="alert"></p>
    </section>
  </template>
  <datalist id="artist-list"><option value="Various Artists"></datalist>
```

Scripts at the end of body: `js/background.js` (defer), `vendor/jszip.min.js`, `js/app.js` (module).

- [ ] **Step 4: Append to `css/app.css`**

```css
.album-grid { display: grid; grid-template-columns: 300px 1fr; gap: 1.5rem; }
@media (max-width: 720px) { .album-grid { grid-template-columns: 1fr; } }
.art { display: grid; gap: .6rem; align-content: start; }
.art-img, .art-empty { width: 300px; max-width: 100%; aspect-ratio: 1; border-radius: 10px; object-fit: cover; }
.art-empty { display: grid; place-items: center; background: var(--surface-2); color: var(--ink-mute); font-family: var(--font-mono); }
.art-img:not([hidden]) + .art-empty { display: none; }
.art-actions { display: flex; gap: .5rem; }
.art-results { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; }
.art-results:empty { display: none; }
.art-results img { width: 100%; aspect-ratio: 1; border-radius: 6px; cursor: pointer; }
.fields { display: grid; gap: .8rem; align-content: start; }
.fields label { display: grid; gap: .3rem; font-size: .85rem; color: var(--ink-mute); }
.fields input { font: inherit; color: var(--ink); padding: .5rem .7rem; border-radius: 8px; border: 1px solid var(--glass-brd); background: var(--surface-2); }
.diagnosis { margin: .8rem 0 0; padding-left: 1.2em; color: var(--warn); font-size: .9rem; }
.diagnosis:empty { display: none; }
.diagnosis.is-ok { color: var(--ok); list-style: none; padding: 0; }
.meta td.is-error { color: var(--danger); }
.skipped { color: var(--ink-mute); font-size: .85rem; }
.skipped:empty { display: none; }
```

Check `var(--warn)`, `--ok`, `--danger`, `--surface-2`, `--glass-brd` exist in `css/variables.css` (they are used by metadata's app.css, so they do).

- [ ] **Step 5: Fixture script**

```bash
cat > test/fixtures/make.sh <<'EOF'
#!/bin/sh
# One-second silent MP3s with real tags in each ID3 version. Needs ffmpeg.
cd "$(dirname "$0")"
gen() { ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=22050:cl=mono -t 1 -c:a libmp3lame -b:a 32k "$@"; }
gen -id3v2_version 3 -metadata title="Track One" -metadata artist="Some Band" -metadata album="Some Album" -metadata date=2001 -metadata track=1 v23.mp3
gen -id3v2_version 4 -metadata title="Track Two" -metadata artist="Some Band" -metadata album="some album " -metadata date=2001 -metadata track=2 -metadata comment="ripped by x" v24.mp3
gen -id3v2_version 3 -metadata title="No Number" -metadata artist="Other Band" -metadata album="Some Album" nonum.mp3
gen -write_id3v1 1 -id3v2_version 3 -metadata title="Has V1" -metadata artist="Some Band" -metadata album="Some Album" v1.mp3
gen -write_id3v2 0 raw.mp3
ffmpeg -y -loglevel error -f lavfi -i color=c=red:s=800x500 -frames:v 1 cover.png
EOF
chmod +x test/fixtures/make.sh && ./test/fixtures/make.sh && ls -la test/fixtures
```

Expected: `v23.mp3 v24.mp3 nonum.mp3 v1.mp3 raw.mp3` each a few KB, and `cover.png` 800x500. Verify with `xxd test/fixtures/v24.mp3 | head -3` that byte 3 is `04`, and `tail -c 128 test/fixtures/v1.mp3 | head -c 3` prints `TAG`.

- [ ] **Step 6: Serve and check the shell renders**

```bash
python3 -m http.server 8000 >/dev/null 2>&1 &
```

Open http://localhost:8000. Expected: header, intro, dropzone, footer, background animating, no console errors except a 404 for `js/app.js` (not written yet). Kill the server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Scaffold mp3.harrys.monster from the metadata site

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 2: `id3.js` parse

**Files:**
- Create: `js/id3.js`
- Test: `test/id3.test.mjs`

**Interfaces:**
- Produces:
  - `parse(bytes: Uint8Array) -> { version: 2|3|4|0, frames: Frame[], audio: Uint8Array }` where `Frame = { id: string, data: Uint8Array }`, ids already mapped to v2.3 names, v2.4 frame-level unsync and data-length indicators removed. `version` 0 means no tag.
  - `text(frame) -> string` decodes a T*** frame (not TXXX) to a string, trailing nulls removed, v2.4 multi-values joined with `/`.
  - `decode(bytes, enc) -> string` and `encodeUtf16(str) -> Uint8Array` (BOM + LE) exported for tests and album.js.

- [ ] **Step 1: Write the failing tests**

```js
// test/id3.test.mjs
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
  assert.ok(get(b.frames, 'COMM'));
  const c = parse(await fixture('v1.mp3'));
  assert.notEqual(new TextDecoder().decode(c.audio.slice(-128, -125)), 'TAG');
  const d = parse(await fixture('raw.mp3'));
  assert.equal(d.version, 0);
  assert.equal(d.audio[0], 0xff);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/id3.test.mjs`
Expected: fails with cannot find module `../js/id3.js`.

- [ ] **Step 3: Write `js/id3.js` (parse half)**

```js
// ID3v2 reader (v2.2, v2.3, v2.4) and v2.3 writer. Pure functions over Uint8Array.

const ASCII = new TextDecoder('latin1');
const UTF8 = new TextDecoder('utf-8');

const V22 = { TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TP4: 'TPE4', TAL: 'TALB', TYE: 'TYER', TRK: 'TRCK', TPA: 'TPOS', TCO: 'TCON', TCM: 'TCOM', TBP: 'TBPM', TEN: 'TENC', TKE: 'TKEY', TLA: 'TLAN', TLE: 'TLEN', TOA: 'TOPE', TOT: 'TOAL', TPB: 'TPUB', TCP: 'TCMP', TS2: 'TSO2', TSA: 'TSOA', TSP: 'TSOP', TST: 'TSOT', TXX: 'TXXX', ULT: 'USLT', PIC: 'APIC', COM: 'COMM' };

const ss = (b, o) => (b[o] & 127) << 21 | (b[o + 1] & 127) << 14 | (b[o + 2] & 127) << 7 | (b[o + 3] & 127);
const be = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;

function deunsync(b) {
  const out = new Uint8Array(b.length); let n = 0;
  for (let i = 0; i < b.length; i++) { out[n++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0) i++; }
  return out.subarray(0, n);
}

function readTag(bytes, start) {
  const major = bytes[start + 3], flags = bytes[start + 5], size = ss(bytes, start + 6);
  const end = start + 10 + size + (major === 4 && flags & 0x10 ? 10 : 0);
  let body = bytes.subarray(start + 10, start + 10 + size);
  if (major === 2 && flags & 0x40) return { frames: [], end }; // compressed v2.2: unreadable
  if (major === 3 && flags & 0x80) body = deunsync(body);
  if (flags & 0x40 && major > 2) body = body.subarray(major === 4 ? ss(body, 0) : be(body, 0) + 4);
  const frames = [];
  const hdr = major === 2 ? 6 : 10;
  for (let o = 0; o + hdr <= body.length && body[o] !== 0;) {
    let id = ASCII.decode(body.subarray(o, o + (major === 2 ? 3 : 4)));
    const len = major === 2 ? body[o + 3] << 16 | body[o + 4] << 8 | body[o + 5] : major === 3 ? be(body, o + 4) : ss(body, o + 4);
    const fflags = major === 2 ? 0 : body[o + 9];
    let data = body.subarray(o + hdr, o + hdr + len);
    o += hdr + len;
    if (major === 2) id = V22[id];
    if (!id || (major === 4 && fflags & 0x0c)) continue; // unknown v2.2 id, or compressed/encrypted
    if (major === 4 && fflags & 0x01) data = data.subarray(4);
    if (major === 4 && (fflags & 0x02 || flags & 0x80)) data = deunsync(data);
    if (major === 3 && fflags & 0xc0) continue; // compressed/encrypted
    frames.push({ id, data: data.slice() });
  }
  return { frames, end };
}

export function parse(bytes) {
  let version = 0, frames = [], o = 0;
  while (bytes[o] === 0x49 && bytes[o + 1] === 0x44 && bytes[o + 2] === 0x33 && bytes[o + 3] < 0xff && bytes[o + 6] < 0x80) {
    const tag = readTag(bytes, o);
    if (!version) { version = bytes[o + 3]; frames = tag.frames; }
    o = tag.end;
  }
  let end = bytes.length;
  if (end - o >= 128 && ASCII.decode(bytes.subarray(end - 128, end - 125)) === 'TAG') end -= 128;
  return { version, frames, audio: bytes.subarray(o, end) };
}

export function decode(b, enc) {
  if (enc === 0) return ASCII.decode(b);
  if (enc === 3) return UTF8.decode(b);
  let le = enc === 1 && b[0] === 0xff && b[1] === 0xfe, o = 0;
  if (enc === 1 && (b[0] === 0xff || b[0] === 0xfe) && (b[1] === 0xff || b[1] === 0xfe)) o = 2;
  let s = '';
  for (; o + 1 < b.length; o += 2) s += String.fromCharCode(le ? b[o] | b[o + 1] << 8 : b[o] << 8 | b[o + 1]);
  return s;
}

export function text(frame) {
  return decode(frame.data.subarray(1), frame.data[0]).replace(/\0+$/, '').split('\0').join('/');
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/id3.test.mjs`
Expected: all `parse:` tests pass. (The import of `build`/`textFrame` resolves to `undefined` but nothing calls them yet, so no failure.) If `parse: v2.3 tag-level unsync` fails, check that the test's extended-header bytes are inside the unsynced body, which they are.

- [ ] **Step 5: Commit**

```bash
git add js/id3.js test/id3.test.mjs && git commit -m "id3: parse v2.2/2.3/2.4 tags

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 3: `id3.js` build

**Files:**
- Modify: `js/id3.js`
- Test: `test/id3.test.mjs`

**Interfaces:**
- Produces:
  - `textFrame(id, str) -> Frame` UTF-16 BOM LE, encoding byte 1.
  - `apicFrame(jpeg: Uint8Array) -> Frame` type 3 front cover, `image/jpeg`.
  - `normalise(frames: Frame[]) -> Frame[]` applies the drop list, re-encodes every T*** (including TXXX) as UTF-16, converts TDRC to TYER, drops TDRL/TDOR.
  - `build(frames: Frame[], audio: Uint8Array) -> Uint8Array` writes a v2.3 tag in the fixed order and 1024 bytes padding, then audio.
  - `ORDER` exported: `['TIT2','TPE1','TALB','TPE2','TYER','TRCK','TPOS','TCON','TCMP']`.

- [ ] **Step 1: Add failing tests**

Append to `test/id3.test.mjs`:

```js
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
  assert.equal(decode(tx.subarray(1), 1).split('\0')[1].replace(/^\uFEFF/, ''), '-3.2 dB');
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
```

The `ORDER` import is unused by the tests; it is there so a typo in the export name fails loudly.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/id3.test.mjs`
Expected: `build:` and `normalise:` tests fail, `build is not a function`.

- [ ] **Step 3: Append the writer to `js/id3.js`**

```js
export const ORDER = ['TIT2', 'TPE1', 'TALB', 'TPE2', 'TYER', 'TRCK', 'TPOS', 'TCON', 'TCMP'];
const DROP = /^(COMM|PRIV|W...|UFID|GEOB|POPM|MCDI|APIC|TDRL|TDOR)$/;

export function encodeUtf16(str) {
  const out = new Uint8Array(2 + str.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
}

const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export const textFrame = (id, str) => ({ id, data: join(new Uint8Array([1]), encodeUtf16(str)) });

export function apicFrame(jpeg) {
  return { id: 'APIC', data: join(new Uint8Array([0]), new TextEncoder().encode('image/jpeg\0'), new Uint8Array([3, 0]), jpeg) };
}

export function normalise(frames) {
  const out = [];
  for (let f of frames) {
    if (DROP.test(f.id)) continue;
    if (f.id === 'TDRC') f = textFrame('TYER', text(f).slice(0, 4));
    else if (f.id === 'TXXX') {
      const [desc = '', ...val] = decode(f.data.subarray(1), f.data[0]).split('\0');
      f = { id: 'TXXX', data: join(new Uint8Array([1]), encodeUtf16(desc), new Uint8Array([0, 0]), encodeUtf16(val.join('\0').replace(/\0+$/, ''))) };
    } else if (f.id[0] === 'T') f = textFrame(f.id, text(f));
    out.push(f);
  }
  return out;
}

export function build(frames, audio) {
  const rank = f => { const i = ORDER.indexOf(f.id); return f.id === 'APIC' ? 99 : i < 0 ? 50 : i; };
  const sorted = frames.map((f, i) => [rank(f), i, f]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  const body = join(...sorted.map(f => join(new TextEncoder().encode(f.id), new Uint8Array([f.data.length >>> 24, f.data.length >>> 16 & 255, f.data.length >>> 8 & 255, f.data.length & 255, 0, 0]), f.data)), new Uint8Array(1024));
  const n = body.length;
  return join(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, n >>> 21 & 127, n >>> 14 & 127, n >>> 7 & 127, n & 127]), body, audio);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/id3.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "id3: build v2.3 tags, normalise frames

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 4: `album.js` grouping, defaults, diagnosis, apply

**Files:**
- Create: `js/album.js`
- Test: `test/album.test.mjs`

**Interfaces:**
- Consumes: `parse, text, textFrame, apicFrame, normalise, build` from `js/id3.js`.
- Produces:
  - `load(name, bytes) -> Track` where `Track = { name, size, parsed, info }`, `info = { title, artist, album, albumArtist, year, track: number|null, compilation: boolean, art: Uint8Array|null, version }`. `track` is the leading integer of TRCK or null. `year` is the first four characters of TYER or TDRC. `art` is the first APIC's image bytes (after the null-terminated mime, type byte and null-terminated description; encoding byte 0 assumed for the description when parsing, UTF-16 handled by scanning for a double null).
  - `group(tracks) -> Group[]`, `Group = { label, tracks }`, keyed by trimmed lowercase album, label the most common trimmed album spelling or `Untitled`; tracks within a group in natural file-name order.
  - `defaults(group) -> { album, albumArtist, year }`.
  - `numbers(group) -> number[]` per track: existing if all present, else 1..n by position.
  - `diagnose(group, form) -> string[]` describes the input tags; only the cover line consults `form.cover`. The prefilled form fixes album and album artist by construction, so those lines describe what was wrong, not what is still wrong.
  - `apply(track, form, cover, n, total) -> Uint8Array` builds, re-parses, throws `Error('verification failed: <field>')` on mismatch.

- [ ] **Step 1: Write failing tests**

```js
// test/album.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, textFrame, apicFrame, parse, text } from '../js/id3.js';
import { load, group, defaults, numbers, diagnose, apply } from '../js/album.js';

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0]);
const mk = (name, tags, extra = []) => load(name, build([...Object.entries(tags).map(([k, v]) => textFrame(k, v)), ...extra], AUDIO));
const fixture = async name => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));

test('load: info from frames', () => {
  const t = mk('01.mp3', { TIT2: 'S', TPE1: 'A', TALB: 'L', TPE2: 'AA', TYER: '1999', TRCK: '3/10', TCMP: '1' }, [apicFrame(new Uint8Array([9, 9]))]);
  assert.deepEqual(t.info, { title: 'S', artist: 'A', album: 'L', albumArtist: 'AA', year: '1999', track: 3, compilation: true, art: new Uint8Array([9, 9]), version: 3 });
  assert.equal(mk('x.mp3', {}).info.track, null);
});

test('group: by album ignoring case and space, natural order, Untitled', () => {
  const g = group([mk('10.mp3', { TALB: 'Alb ' }), mk('2.mp3', { TALB: 'alb' }), mk('1.mp3', { TALB: 'Alb' }), mk('z.mp3', { TIT2: 'lonely' })]);
  assert.deepEqual(g.map(x => x.label), ['Alb', 'Untitled']);
  assert.deepEqual(g[0].tracks.map(t => t.name), ['1.mp3', '2.mp3', '10.mp3']);
});

test('defaults: same artist keeps it, mixed gives Various Artists', () => {
  const same = group([mk('a.mp3', { TPE1: 'X', TALB: 'L', TYER: '2001' }), mk('b.mp3', { TPE1: 'X', TALB: 'L', TYER: '2001' }), mk('c.mp3', { TPE1: 'X', TALB: 'L', TDRC: '2002-01-01' })])[0];
  assert.deepEqual(defaults(same), { album: 'L', albumArtist: 'X', year: '2001' });
  const mixed = group([mk('a.mp3', { TPE1: 'X', TPE2: 'X' }), mk('b.mp3', { TPE1: 'Y', TPE2: 'X' })])[0];
  assert.equal(defaults(mixed).albumArtist, 'Various Artists');
});

test('numbers: kept when complete, else by file order', () => {
  assert.deepEqual(numbers(group([mk('b.mp3', { TRCK: '2' }), mk('a.mp3', { TRCK: '1/2' })])[0]), [1, 2]);
  assert.deepEqual(numbers(group([mk('b.mp3', { TRCK: '7' }), mk('a.mp3', {})])[0]), [1, 2]);
});

test('diagnose: lists causes from the input tags; cover comes from the form', () => {
  const g = group([mk('a.mp3', { TALB: 'Alb', TPE2: 'X', TCMP: '1' }), mk('b.mp3', { TALB: 'alb ', TRCK: '1' })])[0];
  const d = diagnose(g, { album: '', albumArtist: '', year: '' });
  assert.ok(d.some(s => /spelling|case|space/i.test(s)));
  assert.ok(d.some(s => /album artist/i.test(s)));
  assert.ok(d.some(s => /compilation/i.test(s)));
  assert.ok(d.some(s => /cover/i.test(s)));
  assert.ok(d.some(s => /track number/i.test(s)));
  assert.ok(!diagnose(g, { cover: new Uint8Array([1]) }).some(s => /cover/i.test(s)));
  const v24 = group([load('v.mp3', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb]))])[0];
  assert.ok(diagnose(v24, {}).some(s => /2\.4/.test(s)));
});

test('apply: writes form, TCMP rule, TRCK n/total, cover, verifies', () => {
  const t = mk('a.mp3', { TIT2: 'S', TALB: 'old', TPE2: 'old', TYER: '1990', TCMP: '1' });
  const out = parse(apply(t, { album: 'New', albumArtist: 'Band', year: '2020' }, new Uint8Array([7]), 2, 9));
  const get = id => { const f = out.frames.find(f => f.id === id); return f && text(f); };
  assert.equal(out.version, 3);
  assert.equal(get('TALB'), 'New'); assert.equal(get('TPE2'), 'Band'); assert.equal(get('TYER'), '2020'); assert.equal(get('TRCK'), '2/9');
  assert.equal(get('TCMP'), undefined);
  assert.equal(get('TIT2'), 'S');
  assert.ok(out.frames.find(f => f.id === 'APIC'));
  const va = parse(apply(t, { album: 'New', albumArtist: 'Various Artists', year: '' }, null, 1, 1));
  assert.equal(text(va.frames.find(f => f.id === 'TCMP')), '1');
  assert.ok(!va.frames.find(f => f.id === 'TYER'));
  assert.ok(!va.frames.find(f => f.id === 'APIC'));
});

test('apply: real fixtures keep audio', async () => {
  for (const name of ['v23.mp3', 'v24.mp3', 'v1.mp3', 'raw.mp3']) {
    const t = load(name, await fixture(name));
    const out = parse(apply(t, { album: 'A', albumArtist: 'B', year: '2000' }, null, 1, 1));
    assert.deepEqual(out.audio, t.parsed.audio, name);
    assert.equal(out.version, 3, name);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/album.test.mjs`
Expected: cannot find `../js/album.js`.

- [ ] **Step 3: Write `js/album.js`**

```js
import { parse, text, textFrame, apicFrame, normalise, build } from './id3.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const key = s => (s || '').trim().toLowerCase();
const mode = xs => { const c = new Map(); for (const x of xs) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };

function artOf(frame) {
  if (!frame) return null;
  const d = frame.data, enc = d[0];
  let o = 1; while (d[o] !== 0) o++; o++;      // mime
  o++;                                         // picture type
  if (enc === 1 || enc === 2) { while (!(d[o] === 0 && d[o + 1] === 0)) o += 2; o += 2; } else { while (d[o] !== 0) o++; o++; }
  return d.slice(o);
}

export function load(name, bytes) {
  const parsed = parse(bytes);
  const f = id => parsed.frames.find(x => x.id === id);
  const s = id => { const x = f(id); return x ? text(x).trim() : ''; };
  const track = /^\s*(\d+)/.exec(s('TRCK'));
  return { name, size: bytes.length, parsed, info: {
    title: s('TIT2'), artist: s('TPE1'), album: s('TALB'), albumArtist: s('TPE2'),
    year: (s('TYER') || s('TDRC')).slice(0, 4), track: track ? +track[1] : null,
    compilation: s('TCMP') === '1', art: artOf(f('APIC')), version: parsed.version,
  } };
}

export function group(tracks) {
  const map = new Map();
  for (const t of tracks) { const k = key(t.info.album); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
  return [...map].map(([k, ts]) => ({
    label: k ? mode(ts.map(t => t.info.album.trim())) : 'Untitled',
    tracks: ts.sort((a, b) => collator.compare(a.name, b.name)),
  })).sort((a, b) => collator.compare(a.label, b.label));
}

export function defaults({ tracks }) {
  const artists = new Set(tracks.map(t => t.info.artist));
  return {
    album: mode(tracks.map(t => t.info.album.trim())),
    albumArtist: artists.size === 1 && tracks[0].info.artist ? tracks[0].info.artist : 'Various Artists',
    year: mode(tracks.map(t => t.info.year)),
  };
}

export function numbers({ tracks }) {
  return tracks.every(t => t.info.track !== null) ? tracks.map(t => t.info.track) : tracks.map((_, i) => i + 1);
}

export function diagnose({ tracks }, form) {
  const out = [], infos = tracks.map(t => t.info);
  const distinct = xs => new Set(xs).size > 1;
  const aa = infos.map(i => i.albumArtist);
  if (distinct(infos.map(i => i.album))) out.push('Album name differs between tracks by spelling, case or spacing.');
  if (distinct(aa) || (!aa.some(Boolean) && distinct(infos.map(i => i.artist)))) out.push('Album artist differs between tracks, or is missing while track artists differ.');
  if (distinct(infos.map(i => i.compilation))) out.push('Compilation flag is set on some tracks and not others.');
  if (infos.some(i => i.version === 4)) out.push(`${infos.filter(i => i.version === 4).length} track(s) carry ID3v2.4 tags, which iTunes on Windows reads poorly.`);
  if (!form.cover && !infos.some(i => i.art)) out.push('No cover on any track.');
  else if (!form.cover && distinct(infos.map(i => i.art ? i.art.length : 0))) out.push('Cover differs between tracks.');
  const nums = infos.map(i => i.track);
  if (nums.some(n => n === null)) out.push('Some tracks have no track number; all will be renumbered from file order.');
  else if (new Set(nums).size !== nums.length) out.push('Duplicate track numbers.');
  return out;
}

export function apply(track, form, cover, n, total) {
  const keep = normalise(track.parsed.frames).filter(f => !['TALB', 'TPE2', 'TYER', 'TRCK', 'TCMP'].includes(f.id));
  const set = [textFrame('TALB', form.album), textFrame('TPE2', form.albumArtist), textFrame('TRCK', `${n}/${total}`)];
  if (form.year) set.push(textFrame('TYER', form.year));
  if (form.albumArtist === 'Various Artists') set.push(textFrame('TCMP', '1'));
  if (cover) set.push(apicFrame(cover));
  const out = build([...keep, ...set], track.parsed.audio);
  const check = parse(out), got = id => { const f = check.frames.find(f => f.id === id); return f ? text(f) : ''; };
  if (check.version !== 3) throw new Error('verification failed: version');
  for (const [id, want] of [['TALB', form.album], ['TPE2', form.albumArtist], ['TYER', form.year], ['TRCK', `${n}/${total}`]])
    if (got(id) !== want) throw new Error(`verification failed: ${id}`);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all id3 and album tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "album: group, defaults, diagnosis, apply with verification

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 5: `art.js` cover encoding and iTunes search

**Files:**
- Create: `js/art.js`

**Interfaces:**
- Produces:
  - `toCover(src: Blob | Uint8Array) -> Promise<Uint8Array>` square centre-crop, side `min(1400, shorter side)`, JPEG 0.9.
  - `search(artist, album) -> Promise<{url, label}[]>` up to six, `url` is the 600x600 artwork.
  - `fetchCover(url) -> Promise<Uint8Array>` fetches and passes through `toCover`.

- [ ] **Step 1: Write `js/art.js`**

```js
export async function toCover(src) {
  const blob = src instanceof Blob ? src : new Blob([src]);
  const img = await createImageBitmap(blob);
  const side = Math.min(1400, img.width, img.height);
  const c = Object.assign(document.createElement('canvas'), { width: side, height: side });
  const s = Math.min(img.width, img.height);
  c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
  img.close();
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return new Uint8Array(await out.arrayBuffer());
}

export async function search(artist, album) {
  const term = encodeURIComponent(`${artist} ${album}`.trim());
  const res = await fetch(`https://itunes.apple.com/search?entity=album&limit=6&term=${term}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const { results } = await res.json();
  return results.map(r => ({ url: r.artworkUrl100.replace('100x100bb', '600x600bb'), label: `${r.collectionName} · ${r.artistName}` }));
}

export async function fetchCover(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cover download failed (${res.status})`);
  return toCover(await res.blob());
}
```

- [ ] **Step 2: Manual check in the browser console**

Serve with `python3 -m http.server 8000`, open the page, run in the console:

```js
const { search, fetchCover } = await import('/js/art.js');
const r = await search('Radiohead', 'OK Computer'); console.log(r.length, r[0]);
const c = await fetchCover(r[0].url); console.log(c.length, c[0] === 0xff && c[1] === 0xd8);
```

Expected: 6 results, first label includes `OK Computer`, cover bytes start `FF D8` and are under 300 KB.

- [ ] **Step 3: Commit**

```bash
git add js/art.js && git commit -m "art: cover resize and iTunes artwork search

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 6: `app.js` UI

**Files:**
- Create: `js/app.js`
- Modify: `index.html` only if a hook id turns out to be missing.

**Interfaces:**
- Consumes: `load, group, defaults, numbers, diagnose, apply` from `album.js`; `toCover, search, fetchCover` from `art.js`; global `JSZip`.

- [ ] **Step 1: Write `js/app.js`**

```js
import { load, group, defaults, numbers, diagnose, apply } from './album.js';
import { toCover, search, fetchCover } from './art.js';

const cards = document.getElementById('cards');
const tpl = document.getElementById('card-tpl');
const skipped = document.getElementById('skipped');
const allBtn = document.getElementById('download-all');
const state = { tracks: [], images: [], groups: [] }; // groups: [{ label, tracks, form, cover, card }]

const bytesToSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const safe = s => (s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'album');

function showCover(g) {
  const img = g.card.querySelector('.art-img');
  if (g.cover) { img.src = URL.createObjectURL(new Blob([g.cover], { type: 'image/jpeg' })); img.hidden = false; }
  else img.hidden = true;
}

function refresh(g) {
  const ul = g.card.querySelector('.diagnosis');
  const items = diagnose(g, { ...g.form, cover: g.cover });
  ul.classList.toggle('is-ok', items.length === 0);
  ul.replaceChildren(...(items.length ? items : ['Nothing wrong that iTunes would notice. Download anyway to get v2.3 and one cover.']).map(s => Object.assign(document.createElement('li'), { textContent: s })));
}

async function setCover(g, src) {
  try { g.cover = await toCover(src); showCover(g); refresh(g); }
  catch (err) { g.card.querySelector('.card-error').textContent = `Could not read image: ${err.message}`; }
}

function zipGroup(zip, g, folder) {
  const nums = numbers(g), rows = g.card.querySelectorAll('tbody tr');
  let ok = 0;
  g.tracks.forEach((t, i) => {
    try { (folder ? zip.folder(folder) : zip).file(t.name, apply(t, g.form, g.cover, nums[i], g.tracks.length)); rows[i].lastChild.classList.remove('is-error'); ok++; }
    catch (err) { rows[i].lastChild.textContent = err.message; rows[i].lastChild.classList.add('is-error'); }
  });
  return ok;
}

async function download(blobPromise, name, note) {
  const url = URL.createObjectURL(await blobPromise);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (note) note.textContent = `Downloaded ${name}.`;
}

function renderGroup(g) {
  const card = tpl.content.firstElementChild.cloneNode(true);
  g.card = card;
  const $ = s => card.querySelector(s);
  g.form = defaults(g);
  for (const [k, sel] of [['album', '.f-album'], ['albumArtist', '.f-artist'], ['year', '.f-year']]) {
    const input = $(sel);
    input.value = g.form[k];
    input.addEventListener('input', () => { g.form[k] = input.value.trim(); refresh(g); });
  }
  const nums = numbers(g);
  $('tbody').replaceChildren(...g.tracks.map((t, i) => {
    const tr = document.createElement('tr');
    for (const v of [nums[i], t.info.title || t.name, t.info.artist, t.info.version ? `v2.${t.info.version}` : 'none', bytesToSize(t.size)]) tr.append(Object.assign(document.createElement('td'), { textContent: v }));
    return tr;
  }));
  const embedded = g.tracks.find(t => t.info.art)?.info.art;
  if (embedded) setCover(g, embedded);
  else if (state.images.length === 1 || (state.images.length && state.groups.length === 1)) setCover(g, state.images[0]);
  else refresh(g);

  $('.art-file').addEventListener('click', () => $('.art-input').click());
  $('.art-input').addEventListener('change', () => { if ($('.art-input').files[0]) setCover(g, $('.art-input').files[0]); });
  card.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) e.preventDefault(); });
  card.addEventListener('drop', e => { const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (f) { e.preventDefault(); e.stopPropagation(); setCover(g, f); } });
  $('.art-search').addEventListener('click', async () => {
    const box = $('.art-results'); box.textContent = '';
    try {
      const results = await search(g.form.albumArtist === 'Various Artists' ? '' : g.form.albumArtist, g.form.album);
      if (!results.length) $('.card-error').textContent = 'No artwork found.';
      box.replaceChildren(...results.map(r => {
        const img = Object.assign(document.createElement('img'), { src: r.url, alt: r.label, title: r.label });
        img.addEventListener('click', async () => { try { g.cover = await fetchCover(r.url); showCover(g); refresh(g); box.textContent = ''; } catch (err) { $('.card-error').textContent = err.message; } });
        return img;
      }));
    } catch (err) { $('.card-error').textContent = err.message; }
  });
  $('.card-download').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const zip = new JSZip();
      const ok = zipGroup(zip, g);
      if (ok) await download(zip.generateAsync({ type: 'blob' }), `${safe(g.form.album || g.label)}.zip`, $('.card-note'));
      window.track?.('download', { tracks: ok });
    } finally { e.target.disabled = false; }
  });
  return card;
}

function render() {
  state.groups = group(state.tracks);
  cards.replaceChildren(...state.groups.map(renderGroup));
  allBtn.hidden = state.groups.length < 2;
}

async function add(files) {
  const skip = [];
  for (const f of files) {
    if (f.type.startsWith('image/')) state.images.push(f);
    else if (/\.mp3$/i.test(f.name) || f.type === 'audio/mpeg') {
      try { state.tracks.push(load(f.name, new Uint8Array(await f.arrayBuffer()))); }
      catch (err) { skip.push(`${f.name} (${err.message})`); }
    } else skip.push(f.name);
  }
  skipped.textContent = skip.length ? `Skipped: ${skip.join(', ')}` : '';
  render();
  window.track?.('add', { tracks: state.tracks.length });
}

allBtn.addEventListener('click', async () => {
  allBtn.disabled = true;
  try {
    const zip = new JSZip();
    for (const g of state.groups) zipGroup(zip, g, safe(g.form.album || g.label));
    await download(zip.generateAsync({ type: 'blob' }), 'albums.zip');
  } finally { allBtn.disabled = false; }
});

const zone = document.getElementById('dropzone');
const input = document.getElementById('file-input');
document.getElementById('browse').addEventListener('click', () => input.click());
input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
  zone.classList.remove('is-over');
}));
zone.addEventListener('drop', e => add([...e.dataTransfer.files]));
document.getElementById('year').textContent = new Date().getFullYear();
```

- [ ] **Step 2: Drive it in a browser with the fixtures**

Serve with `python3 -m http.server 8000`. Use the `webapp-testing` skill (Playwright) or do it by hand. Upload `test/fixtures/v23.mp3`, `v24.mp3`, `nonum.mp3`, `cover.png` through the file input (`page.setInputFiles('#file-input', [...])`).

Expected:
- Two cards: `Some Album` (v23, nonum) and `some album` (v24)? No: grouping keys are trimmed lowercase, so all three are ONE card labelled `Some Album` (mode of trimmed spellings: two `Some Album`, one `some album`). Tracks in natural name order: `nonum.mp3`, `v23.mp3`, `v24.mp3`, numbered 1, 2, 3 because `nonum` has no number.
- Album Artist prefilled `Various Artists` (Some Band vs Other Band). Year `2001`.
- Cover from `cover.png` shown (single image, single group). Diagnosis lists: album spelling, album artist, one v2.4 track, renumbering. No cover line.
- Click Download zip: a file `Some Album.zip` downloads. Unzip it and run:

```bash
cd /tmp/claude-1000 && unzip -o ~/Downloads/"Some Album.zip" -d out && for f in out/*.mp3; do ffprobe -v error -show_entries format_tags -of default=nw=1 "$f"; ffprobe -v error -select_streams v -show_entries stream=codec_name,width,height -of csv=p=0 "$f"; done
```

Expected per file: `TAG:album=Some Album`, `TAG:album_artist=Various Artists`, `TAG:compilation=1`, `TAG:date=2001`, `TAG:track=N/3`, no `comment`, and a `mjpeg` stream of 500x500 (the 800x500 PNG centre-cropped). Also `xxd out/v24.mp3 | head -1` shows `4944 3303` (v2.3).

- [ ] **Step 3: Multi-group check**

Add another MP3 with a different album (make one: `ffmpeg -y -loglevel error -f lavfi -i anullsrc -t 1 -id3v2_version 3 -metadata album=Other -metadata artist=Z /tmp/claude-1000/other.mp3`), upload with the others. Expected: two cards and the "Download all albums" button; `albums.zip` contains two folders.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "app: drop, group cards, cover controls, zip download

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

---

### Task 7: README, deploy docs, deploy

**Files:**
- Create: `README.md`, `docs/DEPLOY.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# MP3 album fixer

Drop the MP3s of an album, check Album, Album Artist and Year, pick a cover, download a zip that iTunes on Windows imports as one album with one cover.

Everything runs client-side. The only network request is the optional artwork search, which sends the artist and album text to the iTunes Search API.

## What it does

- Rewrites every tag as ID3v2.3 with UTF-16 text. iTunes on Windows reads v2.4 and UTF-8 unreliably.
- Sets Album, Album Artist and Year on every track. `Various Artists` also sets the iTunes compilation flag; anything else clears it.
- Writes one front cover: square centre crop, up to 1400 px, JPEG. Sources: the cover already in a track, an image you drop, or an iTunes search.
- Track numbers become `n/total`. If any track has no number, all are renumbered from file-name order.
- Drops comments, private frames, URLs, ratings, file ids, general objects, CD ids and old covers. Every other tag is kept. An ID3v1 trailer is removed.
- Audio bytes are never touched.
- Files are grouped by their existing album tag, so a mixed drop becomes one card per album.

## Stack

Plain HTML, CSS and JavaScript, no build step. `js/id3.js` reads ID3v2.2 to 2.4 and writes 2.3; `js/album.js` is grouping, defaults, diagnosis and the write rules. CSS, background and `jszip` copied from `metadata.harrys.monster`.

## Developing

```bash
python3 -m http.server      # open http://localhost:8000
npm test                    # node --test over id3.js and album.js
test/fixtures/make.sh       # regenerate fixtures (needs ffmpeg)
```

## Deployment

Cloudflare Worker with static assets, custom domain in `wrangler.jsonc`. `npx wrangler deploy`; details in `docs/DEPLOY.md`.
```

- [ ] **Step 2: Write `docs/DEPLOY.md`**

Copy `../metadata.harrys.monster/docs/DEPLOY.md`, replace `metadata` with `mp3` throughout, and replace the CSP paragraph with: "The CSP adds `https://itunes.apple.com` and `https://*.mzstatic.com` to `connect-src` and `https://*.mzstatic.com` plus `blob:` to `img-src` for the artwork search and the cover preview."

- [ ] **Step 3: Deploy**

```bash
cd /home/harry/Documents/harrys.monster-sites/mp3.harrys.monster
npx wrangler deploy
```

If it times out on the API, use the resolver workaround from `docs/DEPLOY.md`:

```bash
RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1) npx wrangler deploy
```

Then:

```bash
curl -sI https://mp3.harrys.monster | grep -i "content-security-policy\|HTTP/"
```

Expected: 200 and the CSP from Task 1. Load https://mp3.harrys.monster, drop the fixtures, search artwork, download. No CSP errors in the console.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Docs and deploy config for mp3.harrys.monster

Claude-Session: https://claude.ai/code/session_015oSyhidnpSiFPKmZ5PjYfX"
```

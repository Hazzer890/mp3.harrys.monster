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

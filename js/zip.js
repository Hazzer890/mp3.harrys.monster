// STORE-only zip writer over Blobs. The result is a Blob composed of small
// header arrays and the input blobs, so nothing is copied into memory; the
// only pass over the data is a chunked CRC32.
// ponytail: no zip64, so 4 GB total is the ceiling; add zip64 records if an album ever exceeds it.

const CRC = new Int32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n; });

async function crc32(blob) {
  let c = -1;
  for (let o = 0; o < blob.size; o += 1 << 22) {
    const b = new Uint8Array(await blob.slice(o, o + (1 << 22)).arrayBuffer());
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ c >>> 8;
  }
  return ~c >>> 0;
}

export async function zip(entries) {
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date();
  const time = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
  const date = (now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate();
  let offset = 0;
  const rec = (sig, fields, name) => {
    const b = new Uint8Array(fields.reduce((n, [, w]) => n + w, 4) + name.length), v = new DataView(b.buffer);
    v.setUint32(0, sig, true);
    let o = 4;
    for (const [val, w] of fields) { w === 2 ? v.setUint16(o, val, true) : v.setUint32(o, val, true); o += w; }
    b.set(name, o);
    return b;
  };
  for (const { name, blob } of entries) {
    const n = enc.encode(name), size = blob.size, crc = await crc32(blob);
    if (offset + size + 30 + n.length > 0xffffffff) throw new Error('Album is over 4 GB, too big for one zip');
    const common = [[20, 2], [0x800, 2], [0, 2], [time, 2], [date, 2], [crc, 4], [size, 4], [size, 4], [n.length, 2]];
    const local = rec(0x04034b50, [...common, [0, 2]], n);
    central.push(rec(0x02014b50, [[20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]], n));
    parts.push(local, blob);
    offset += local.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = rec(0x06054b50, [[0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [cdSize, 4], [offset, 4], [0, 2]], new Uint8Array(0));
  return new Blob([...parts, ...central, end]);
}

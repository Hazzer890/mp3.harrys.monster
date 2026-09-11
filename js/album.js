import { parse, text, textFrame, apicFrame, normalise, buildTag } from './id3.js';

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

const read = async (file, a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());

// Reads only the ID3 tag(s) at the front and the 128-byte trailer; the audio
// stays on disk as a Blob slice so a 250-track album never sits in memory.
export async function load(file) {
  let end = 0;
  for (;;) {
    const h = await read(file, end, end + 10);
    if (!(h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33 && h[3] < 0xff && h[6] < 0x80)) break;
    end += 10 + ((h[6] & 127) << 21 | (h[7] & 127) << 14 | (h[8] & 127) << 7 | (h[9] & 127)) + (h[3] === 4 && h[5] & 0x10 ? 10 : 0);
  }
  const parsed = parse(await read(file, 0, end));
  const tail = file.size - end >= 128 ? await read(file, file.size - 128, file.size - 125) : null;
  const audioEnd = tail && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47 ? file.size - 128 : file.size;
  const f = id => parsed.frames.find(x => x.id === id);
  const s = id => { const x = f(id); return x ? text(x).trim() : ''; };
  const track = /^\s*(\d+)/.exec(s('TRCK'));
  return { name: file.name, size: file.size, parsed, audio: file.slice(end, audioEnd), info: {
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
  const tag = buildTag([...keep, ...set]);
  const check = parse(tag), got = id => { const f = check.frames.find(f => f.id === id); return f ? text(f) : ''; };
  if (check.version !== 3) throw new Error('verification failed: version');
  for (const [id, want] of [['TALB', form.album], ['TPE2', form.albumArtist], ['TYER', form.year], ['TRCK', `${n}/${total}`]])
    if (got(id) !== want) throw new Error(`verification failed: ${id}`);
  return new Blob([tag, track.audio]);
}

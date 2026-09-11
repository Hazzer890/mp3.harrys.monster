import { load, group, defaults, numbers, diagnose, apply } from './album.js';
import { toCover, search, fetchCover } from './art.js';
import { zip } from './zip.js';

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

function entries(g, folder = '') {
  const nums = numbers(g), rows = g.card.querySelectorAll('tbody tr'), out = [];
  g.tracks.forEach((t, i) => {
    try { out.push({ name: folder + t.name, blob: apply(t, g.form, g.cover, nums[i], g.tracks.length) }); rows[i].lastChild.classList.remove('is-error'); }
    catch (err) { rows[i].lastChild.textContent = err.message; rows[i].lastChild.classList.add('is-error'); }
  });
  return out;
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
      const list = entries(g);
      if (list.length) await download(zip(list), `${safe(g.form.album || g.label)}.zip`, $('.card-note'));
      window.track?.('download', { tracks: list.length });
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
      try { state.tracks.push(await load(f)); }
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
    await download(zip(state.groups.flatMap(g => entries(g, safe(g.form.album || g.label) + '/'))), 'albums.zip');
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

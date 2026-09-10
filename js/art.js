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

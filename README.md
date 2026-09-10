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

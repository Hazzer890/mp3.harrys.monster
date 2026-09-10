# mp3.harrys.monster: album normaliser for iTunes

Drop the MP3s of an album, fix the three tags that make iTunes on Windows split
or lose it, pick a cover, download a zip. Everything runs in the browser.
Nothing is uploaded except the artist and album text sent to the artwork search.

## Problem

The user's MP3s already carry decent tags, but iTunes on Windows still shows one
album as several, or without artwork. Causes: album artist differing between
tracks, the compilation flag set on some tracks and not others, album names that
differ by case or whitespace, ID3v2.4 tags with UTF-8 text that iTunes reads
badly, and covers that are missing, non-baseline JPEG, PNG, or duplicated.

## Scope

- MP3 only. No M4A, FLAC, or transcoding.
- Mostly one album per session; a drop containing several albums is split into
  groups by existing album tag and each group is handled identically.
- Editable per group: Album, Album Artist, Year, cover art. Nothing per track.
- Output: one zip per group, original file names. Optional single zip of all
  groups, one folder each, when more than one group exists.

## Normalisation rules

Read:
- Parse an ID3v2.2, v2.3 or v2.4 tag at the start of the file. Handle tag-level
  unsynchronisation (v2.3) and frame-level (v2.4). Skip the extended header.
  v2.2 three-letter ids map to v2.3 names via a table of common frames; unknown
  v2.2 ids are dropped. Files with no ID3v2 tag are treated as having no frames.
- Bytes after the tag are audio and are copied unchanged. MPEG is never decoded.
- An ID3v1 tag at the end of the file (last 128 bytes starting `TAG`) is dropped.

Frame filter:
- Drop: COMM, PRIV, all W* URL frames, UFID, GEOB, POPM, MCDI, every APIC.
- Keep everything else. Text frames re-encoded as UTF-16 with BOM. v2.4 TDRC
  collapses to v2.3 TYER (first four characters). TDRL/TDOR dropped.

Set on every track in a group, from the form:
- TALB, TPE2, TYER from Album, Album Artist, Year. Empty Year removes TYER.
- TCMP = "1" when Album Artist is exactly "Various Artists", otherwise TCMP is
  removed.
- One APIC (type 3, front cover, image/jpeg): the chosen cover resized to a
  square, longest side capped at 1400 px, encoded via canvas as JPEG at 0.9.
  If no cover is chosen, no APIC is written and the diagnosis lists it.
- TRCK = `n/total`, total = group size. If any track lacks a parsable leading
  integer in TRCK, every track is renumbered from file name order (natural
  sort, case-insensitive). Otherwise existing numbers are kept and only the
  total is added.

Defaults for the form:
- Album: most common existing TALB after trim, else empty.
- Album Artist: if every track's TPE1 (trimmed) is identical, that value; else
  "Various Artists". Existing TPE2 is ignored for the default because it is
  usually the thing that is wrong.
- Year: most common existing TYER/TDRC year.
- Cover: first APIC found in the group, in file order.

Write:
- ID3v2.3 header, no flags, no extended header. Frames in a fixed order: TIT2,
  TPE1, TALB, TPE2, TYER, TRCK, TPOS, TCON, TCMP, then remaining kept frames in
  read order, APIC last. 1024 bytes of padding. Then the original audio bytes.
- Before zipping, the output is re-parsed. If version is not 2.3 or any of
  TALB, TPE2, TYER, TRCK read back differently from what was set, the file is
  marked errored and excluded from the zip.

## Diagnosis

Per group, a list of reasons iTunes would split or misdisplay the album, computed
from the tags as read and recomputed as the form changes:
- album names differ by case or whitespace across tracks
- album artist differs across tracks, or is set on some and not others
- compilation flag set on some tracks and not others
- one or more tracks are v2.4
- no cover on any track, or covers differ between tracks
- missing or duplicate track numbers

Purely informational. It tells the user whether the batch needed fixing.

## UI

One page, styling, fonts, background canvas and analytics snippet copied from
metadata.harrys.monster. No build step, no framework.

- Drop zone accepts MP3s and images together, by drop or picker. Other files are
  listed as skipped. MP3s are grouped by TALB compared after trim and lowercase;
  files without TALB form one group labelled Untitled. Dropped images are offered
  as the cover of the single group if only one exists, otherwise attached to no
  group and shown as available covers on every card.
- One card per group. Cover at 300 px square on the left. Album, Album Artist,
  Year inputs on the right, prefilled per Defaults. Below: read-only track table
  with number, title, artist, tag version, size. Below that: diagnosis list.
- Cover controls: "Use file" (picker or image dropped on the card), "Search"
  (iTunes Search API, `https://itunes.apple.com/search?entity=album&term=`
  with artist and album, up to six results, 100 px thumbnail rewritten to
  600x600 for the fetch), and the embedded cover as the initial choice. All
  three paths call one function that loads, resizes and encodes.
- Download button per card produces `<Album>.zip` (file-name-safe). When more
  than one group exists, a "Download all" button produces `albums.zip` with one
  folder per group.
- A file that fails to parse shows the error inline in its row and is excluded.
  A failed artwork search shows one line on the card.

Nothing leaves the browser except the artwork search request.

## Files

```
mp3.harrys.monster/
  index.html
  css/                 copied from metadata.harrys.monster
  js/id3.js            parse(Uint8Array) -> {version, frames:[{id,data}], audio:Uint8Array}
                       build(frames, audio) -> Uint8Array; text(frame)/textFrame(id, str) helpers
  js/album.js          group(files), defaults(group), diagnose(group, form), apply(track, form, cover, n, total)
  js/art.js            toCover(Blob) -> Uint8Array JPEG; search(artist, album) -> [{url, label}]
  js/app.js            DOM, state, zip download
  js/background.js     copied
  vendor/jszip.min.js  copied
  test/id3.test.mjs    node --test: round-trip v2.2/2.3/2.4, unsync, filter, ID3v1 drop
  test/album.test.mjs  grouping, defaults, renumbering, diagnosis
  wrangler.jsonc, _headers, .assetsignore, README.md, docs/DEPLOY.md
```

id3.js and album.js are pure functions over Uint8Array and plain objects so they
run under node --test with synthetic tags and dummy audio bytes. Only art.js and
app.js touch the DOM.

## Deploy

Cloudflare Worker with static assets, custom domain `mp3.harrys.monster`, config
copied from metadata.harrys.monster. `_headers` CSP additionally allows
`connect-src https://itunes.apple.com` and `img-src https://*.mzstatic.com`
for artwork search, plus `blob:` in img-src for the chosen cover preview.
The resolver workaround in metadata's DEPLOY.md applies.

## Out of scope

Per-track editing, reordering, file renaming, other audio formats, ID3v1
output, lyrics, ReplayGain calculation.

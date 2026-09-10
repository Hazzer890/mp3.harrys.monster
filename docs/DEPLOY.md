# Deploying mp3.harrys.monster

A Cloudflare Worker that serves this directory as static assets, the same
pattern as timetable.harrys.monster. `wrangler.jsonc` names the worker
`mp3`, points assets at `.`, and declares `mp3.harrys.monster` as a
custom domain, so a deploy also creates the DNS record and certificate.
`.assetsignore` keeps tests, docs and config out of the upload.

```bash
npx wrangler deploy
```

`_headers` is applied by Workers static assets exactly as it would be on
Pages. Check after a deploy:

```bash
curl -sI https://mp3.harrys.monster | grep -i content-security-policy
```

The CSP adds `https://itunes.apple.com` and `https://*.mzstatic.com` to
`connect-src`, and `https://*.mzstatic.com` plus `blob:` to `img-src`, for the
artwork search and the cover preview.

The analytics snippet in `index.html` is byte-identical to
`analytics.harrys.monster/snippet.html`; its hash is already in `_headers`.
If the snippet changes, recompute per `analytics.harrys.monster/SNIPPET.md`.

## If wrangler reports "The request to Cloudflare's API timed out"

On Harry's desktop the first nameserver in `/etc/resolv.conf` does not answer,
so each lookup waits about 3 s before the second one is tried, and wrangler's
account lookup gives up. Either fix the resolver or run:

```bash
RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=<account id from wrangler whoami> npx wrangler deploy
```

To check the CSP locally, serve the directory with something that applies
`_headers` (python's http.server does not), load the page, and drop a file
while watching the console.

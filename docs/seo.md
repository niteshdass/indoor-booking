# Search engines and share previews

The web app is a single-page app, so every URL serves the same `index.html`. That file carries a meta description and a site-wide share card, and each page sets its own tab title (`apps/web/src/lib/useDocumentTitle.ts`). Google runs the JavaScript and sees those titles. Link-preview bots (WhatsApp, Facebook, Telegram and others) do not run it, so the API renders the venue card for them.

## What the API serves

These routes sit at the API's root, not under `/api/v1`, so the host can pass the request through without changing the path. Every URL in them is built from `APP_URL`.

| Path | Content |
|---|---|
| `GET /robots.txt` | Allows player pages, blocks the owner and admin portals, checkout and personal pages, and links the sitemap. |
| `GET /sitemap.xml` | The home page, `/search`, and every published venue whose owner is active, with `lastmod`. |
| `GET /venues/:slug` | A small HTML page with Open Graph and Twitter tags: venue name, address, rating and the first `https` photo. Hidden or unknown venues get a generic `404` card, so nothing leaks. |

All three are cached for 10 minutes (`Cache-Control: public, max-age=600`).

## Routing on the host

Send `/robots.txt` and `/sitemap.xml` to the API for everyone. Send `/venues/:slug` to the API **only for link-preview bots**. People and Googlebot must still get the app.

On Vercel (Build Output API, `scripts/vercel-build.mjs`), add these before `{ handle: 'filesystem' }`:

```js
{ src: '^/(robots\\.txt|sitemap\\.xml)$', dest: '/api' },
{
  src: '^/venues/[^/]+/?$',
  has: [
    {
      type: 'header',
      key: 'user-agent',
      value: '(?i).*(facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|vkshare|skypeuripreview|pinterest|redditbot|applebot).*',
    },
  ],
  dest: '/api',
},
```

Behind nginx or another proxy, match the same paths and user agents and proxy them to the API.

## Checking it

- `curl -A facebookexternalhit https://<site>/venues/<slug>` should return the venue's `og:` tags.
- `curl https://<site>/venues/<slug>` should return the app's `index.html`.
- Paste a venue link into the [Facebook sharing debugger](https://developers.facebook.com/tools/debug/) or a Telegram chat.
- Submit `https://<site>/sitemap.xml` in Google Search Console.

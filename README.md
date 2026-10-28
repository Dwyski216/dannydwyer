# DP Portfolio Site

A lightweight, no-database portfolio site for a Director of Photography /
Cinematographer, built with [Astro](https://astro.build). Video content lives
as flat markdown files and renders as YouTube or Vimeo embeds — no native
video hosting, no storage bill — with search + tag filtering on the work
page and a still-image gallery on each video's own page. There's a small
custom admin panel for adding and editing content without touching code.

**Ongoing cost: $0/month.** Static hosting on Cloudflare's free tier, using a
domain you already own.

---

## 1. What's in here

```
src/
  content/
    videos/*.md        ← one file per video (title, platform, video ID, tags, stills, etc.)
    pages/contact.md    ← Contact page copy
    pages/work.md       ← Work page heading + description
  data/
    site.json           ← global settings (name, bio, socials, email)
    categories.ts       ← Work category buttons/pages (Documentary, Commercial, Music Videos)
  layouts/Layout.astro   ← SEO meta tags + JSON-LD structured data
  components/            ← VideoPlayer, SeriesPlayer, VideoCard, SocialIcons,
                            header/footer, WorkPage (shared by /work and the
                            category pages), and sections/ (page pieces)
  pages/
    index.astro          ← Home (main reel + intro + featured work)
    work/index.astro      ← Video grid with search + tag filtering (WorkPage)
    [category].astro      ← /documentary, /commercial, /music-videos (WorkPage, pre-filtered)
    work/[slug].astro     ← Individual video pages (embed, description, stills gallery)
    contact.astro         ← Contact page
    admin/index.astro     ← Content admin panel (see section 5)
    llms.txt.ts           ← Plain-text site index for AI answer engines (GEO)
worker/
  index.ts               ← Cloudflare Worker: guards /admin and handles the admin's
                            /api/* endpoints (videos, reorder, settings, SEO, tags,
                            thumbnail uploads); everything else is served as a
                            static file from dist/
wrangler.jsonc            ← Cloudflare Worker + static-assets config
brand-assets/             ← style guide, monogram variations, spare fonts (saved here, not published)
```

### Video content model

Each file in `src/content/videos/` has this frontmatter shape:

```yaml
---
title: "Midnight Harbor"
summary: "150-160 character summary used for meta description and AI snippets."
cardLine: "80-100 character line shown in full under the title on every video card."
platform: "youtube"       # or "vimeo"
videoId: "dQw4w9WgXcQ"    # YouTube's video ID, or Vimeo's numeric ID
thumbnailUrl: ""           # optional; YouTube/Vimeo thumbnails are looked up automatically
customThumbnail: ""        # set by "Upload Thumbnail" in the admin; falls back to the platform thumbnail
series: []                 # extra videos (thumbnail strip under the player), e.g. [{"title":"Part 2","platform":"vimeo","videoId":"311786362","thumbnail":"/images/thumbnails/x.webp"}]
role: "Director of Photography"
client: "Independent"
projectName: "Midnight Harbor (short film)"
uploadDate: "2026-03-14"
durationISO: "PT8M12S"     # ISO 8601 duration, optional
tags: ["narrative", "35mm", "noir", "night exterior"]
urlSlug: "midnight-harbor"
featured: true
order: 10                  # position on the Work page (lower = earlier); set by dragging in the admin
categoryOrder: {"commercial": 40}  # optional: its own position on a category page
stills:                    # optional — renders as a gallery under the description
  - src: "/images/videos/midnight-harbor/01.jpg"
    alt: "Dock lamps lighting the wide shot"
    caption: "Night one, camera A"
---

Free-text description / body copy goes here as markdown.
```

Tags are freeform — add as many as are useful (format, genre, technique,
gear, location type). They power both the tag-chip filter and the search box
on `/work`, and prospective clients land on `/work` from search engines
or AI answer engines that have indexed a specific tag combination.

To add still images: drop the files under `public/images/videos/<slug>/` and
reference them by that path in the `stills` list, either by hand-editing the
markdown or through the admin panel's "Still images" field (one per line, as
`image URL | alt text | caption`).

## 2. Local preview

You already have Claude Code and can ask it to run these for you, or run them
yourself from a terminal in this folder:

```bash
npm install
npm run dev
```

Visit `http://localhost:4321`.

## 3. Before your first deploy

1. Open `astro.config.mjs` and replace `SITE_URL` with your real domain
   (e.g. `https://www.yourname.com`). This is used for the sitemap and
   canonical URLs.
2. The default link-preview image (shown when the site is shared on social
   media or texted) is `public/images/og-monogram.jpg`, 1200×630px. Video
   pages use their own thumbnail instead; any page can override it in the
   admin's SEO tab.
3. Edit `src/data/site.json` with your real name, bio, email, and social
   links.
4. Replace the two sample entries in `src/content/videos/` with your own, or
   leave them as a reference for the file format and delete them once you've
   added real ones through the admin panel.

## 4. Deploy: GitHub + Cloudflare

This repo is already on GitHub. Cloudflare's dashboard has moved away from
the old "Pages" product name — new git-connected sites now go through
**Workers**, deployed as a Worker with static assets (that's what
`wrangler.jsonc` and `worker/index.ts` in this repo are for). Functionally
it's the same free static hosting; only the dashboard labels changed.

**Connect the repo**

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → click
   **Create application** (or **Compute (Workers)** → **Create**) →
   **Import a repository** / **Connect to Git**.
2. Select the `dannydwyer` repo.
3. On the **Set up your application** screen:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy` (this is the default — leave
     it as-is; `wrangler.jsonc` tells it to serve `dist/` as static assets
     and route `/api/*` to `worker/index.ts`)
4. Click **Deploy**. Cloudflare gives you a temporary `*.workers.dev` URL —
   check that it works before moving on.

## 5. Point your GoDaddy domain at Cloudflare

You keep the domain at GoDaddy — you're only changing where its DNS is
managed, which is free.

1. In the Cloudflare dashboard, click **Add a site**, enter your domain, and
   choose the **Free** plan.
2. Cloudflare will show you two nameservers (something like
   `ana.ns.cloudflare.com` / `bob.ns.cloudflare.com`).
3. In GoDaddy: **My Products** → your domain → **DNS** → **Nameservers** →
   **Change** → **Enter my own nameservers** → paste in Cloudflare's two
   nameservers. Save.
4. This can take anywhere from a few minutes to a few hours to propagate.
   Cloudflare's dashboard will show the domain as "Active" once it's done.
5. Back in your Worker's project page → **Settings** → **Domains & Routes**
   → add your domain (and `www` if you want both). Cloudflare issues free
   SSL automatically.

## 6. Set up the admin panel

The admin panel at `/admin` commits changes directly to your GitHub repo,
which triggers an automatic redeploy (live in about a minute). It's gated by
a single shared password behind a signed session cookie, enforced by the
Worker itself (`worker/index.ts`) — not by anything you have to configure in
the Cloudflare dashboard, so it's protected the moment secrets are set,
before you've touched Zero Trust at all.

**a. Create a GitHub token so the admin panel can write files**

1. On GitHub: **Settings** → **Developer settings** → **Personal access
   tokens** → **Fine-grained tokens** → **Generate new token**.
2. Scope it to only the `dannydwyer` repo, with **Contents: Read and
   write** permission. Nothing else.
3. Copy the token — you won't see it again.

**b. Add environment variables to the Worker**

In your Worker's project → **Settings** → **Variables and Secrets**, add:

| Variable | Value | Type |
|---|---|---|
| `GITHUB_TOKEN` | the token from step (a) | Secret |
| `GITHUB_REPO` | `Dwyski216/dannydwyer` | Secret |
| `GITHUB_BRANCH` | `main` | Secret |
| `ADMIN_PASSWORD` | a password only you know | Secret |
| `SESSION_SECRET` | a long random string (e.g. `openssl rand -hex 32`) — never reuse this anywhere else | Secret |

Add all five as **Secret**, even the two that aren't sensitive: every
git-triggered deploy runs `wrangler deploy`, which wipes plain-text
dashboard variables that aren't in `wrangler.jsonc`, while secrets survive.

Redeploy after saving so `worker/index.ts` picks up the new variables. Once
they're set, visiting `/admin` redirects to `/admin/login`; entering
`ADMIN_PASSWORD` there sets a 7-day HttpOnly session cookie and unlocks both
`/admin` and the `/api/videos` / `/api/settings` write endpoints it calls. A
**Log Out** button on the admin page clears the session immediately.

If `ADMIN_PASSWORD` or `SESSION_SECRET` is missing, `/admin` still redirects
to the login page, but logging in will fail — so nothing is ever
accidentally left open.

**c. (Optional) add Cloudflare Access as a second layer**

The password gate above is enough on its own for a single admin. If you
later want a second layer — e.g. to share access with someone without
sharing the password, or to require an email-verified login in addition to
it — you can still put **Cloudflare Access** (free for up to 50 users) in
front of the same paths:

1. **Zero Trust** → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.
2. Application domain: your domain, path `/admin*`.
3. Add a second application (or extend the path) covering `/api/*`, same
   policy.
4. Under **Policies**, allow exactly the email addresses you want to grant
   access.

This is additive, not required — the app-level login works whether or not
Access is configured.

## 7. Using the admin panel day to day

- **Home**: the hero reel, the bio title and intro copy (pasting is plain
  text only, so other apps' formatting never comes along), and which videos
  appear under Featured Work.
- **Work**: add, edit, reorder, hide or delete videos. Saving creates or
  updates a markdown file in `src/content/videos/` and commits it — the site
  rebuilds automatically, no code changes required. Each video has a
  **Card Line** (shown on its gallery card) and a separate **SEO Short
  Summary** (only used for Google and link previews). Select several videos
  to add or remove a tag on all of them in one save.
- **Moved pages**: changing a video's URL slug gives it a new address; add
  the old one to `REDIRECTS` in `worker/index.ts` so shared links forward.
- **Contact**: edit the Contact page copy.
- **Tags**: rename or delete a tag everywhere it's used.
- **SEO**: per-page title, description and share-image overrides.
- **Settings**: name, email, location, and social links (Instagram,
  LinkedIn, IMDb, Vimeo, YouTube) — writes to `src/data/site.json`. The
  footer icons update from these.

Every save is a real Git commit, so your GitHub repo's history is a full
changelog of every content edit — and if anything ever looks wrong, you can
always revert a commit.

## 8. SEO / GEO / LLM notes

This site is built to be legible to three audiences at once: search engines,
AI answer engines (ChatGPT, Perplexity, Google AI Overviews), and human
visitors.

- Keep each video's **summary** field to 150–160 characters — that's what
  shows up in search results and is what AI answer engines tend to quote.
- Fill in **role**, **client**, and **project name** on every video where you
  have them — these become concrete, extractable facts in the page's
  `VideoObject` structured data, which is what helps AI tools describe your
  work accurately instead of guessing.
- Every page carries JSON-LD: a site-wide `Person` schema (who you are),
  `VideoObject` schema per video, an `ItemList` on `/work` (the full
  catalog, in one machine-readable block), and a `BreadcrumbList` on each
  video page.
- `/llms.txt` is generated at build time from the same content as the site —
  a plain-text summary + full video list in the emerging
  [llms.txt](https://llmstxt.org) convention that AI crawlers check the way
  search engines check `robots.txt`. Nothing to maintain separately; it
  updates whenever you add a video.
- Tag pages are reachable at `/work?tag=<tag>` and pre-populate the filter
  and URL, so you can link directly to a filtered view (e.g. from an email
  signature or a client-specific page) and it stays crawlable.
- After your first deploy, submit your sitemap
  (`yourdomain.com/sitemap-index.xml`) to
  [Google Search Console](https://search.google.com/search-console) and
  [Bing Webmaster Tools](https://www.bing.com/webmasters) (Bing's index feeds
  ChatGPT's web results).

## Work categories

The Work page's category buttons (Documentary, Commercial, Music Videos) are
defined in `src/data/categories.ts`. Each is also its own page
(`/documentary`, `/commercial`, `/music-videos`): the Work gallery
pre-filtered to that tag, with its own title and description. A video shows
up in a category when it has the category's tag (`documentary`,
`commercial`, `music video`) in the admin.

Each category page has its own order, separate from the Work page: in the
admin's Work list, pick the page under **Order for**, drag its videos into
place and click Save Order. Videos never placed in a category's order show
at the end of that page, in the Work page order.

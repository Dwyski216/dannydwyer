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
  data/
    site.json           ← global settings (name, bio, socials, email)
  layouts/Layout.astro   ← SEO meta tags + JSON-LD structured data
  components/            ← VideoPlayer (YouTube/Vimeo), VideoRow, header/footer
  pages/
    index.astro          ← Home (main reel + intro)
    videos/index.astro    ← Video grid with search + tag filtering
    videos/[slug].astro   ← Individual video pages (embed, description, stills gallery)
    contact.astro         ← Contact page
    admin/index.astro     ← Content admin panel (see section 5)
    llms.txt.ts           ← Plain-text site index for AI answer engines (GEO)
worker/
  index.ts               ← Cloudflare Worker: handles /api/videos and /api/settings
                            (the admin panel's write endpoints); everything else is
                            served as a static file from dist/ automatically
wrangler.jsonc            ← Cloudflare Worker + static-assets config
```

### Video content model

Each file in `src/content/videos/` has this frontmatter shape:

```yaml
---
title: "Midnight Harbor"
summary: "150-160 character summary used for meta description and AI snippets."
platform: "youtube"       # or "vimeo"
videoId: "dQw4w9WgXcQ"    # YouTube's video ID, or Vimeo's numeric ID
thumbnailUrl: ""           # required for Vimeo; optional override for YouTube
role: "Director of Photography"
client: "Independent"
projectName: "Midnight Harbor (short film)"
uploadDate: "2026-03-14"
durationISO: "PT8M12S"     # ISO 8601 duration, optional
tags: ["narrative", "35mm", "noir", "night exterior"]
urlSlug: "midnight-harbor"
featured: true
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
2. Add a real Open Graph preview image at `public/images/og-default.jpg`
   (1200×630px works well) — this is what shows up when your site link is
   shared on social media or texted.
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
| `GITHUB_REPO` | `Dwyski216/dannydwyer` | Text |
| `GITHUB_BRANCH` | `main` | Text |
| `ADMIN_PASSWORD` | a password only you know | Secret |
| `SESSION_SECRET` | a long random string (e.g. `openssl rand -hex 32`) — never reuse this anywhere else | Secret |

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

- **Add Video**: fill in the form (title, platform + video ID, summary,
  description, tags, stills, date, etc.) and click Publish. This creates a
  new markdown file in `src/content/videos/` and commits it — the site
  rebuilds automatically. At 51+ videos, this is the fastest path to adding
  new ones — no code changes required.
- **Edit Video**: pick an existing video from the dropdown, edit the raw
  markdown, save.
- **Site Settings**: edit your name, bio, intro copy, email, and social
  links — writes to `src/data/site.json`.
- **Contact Page**: edit the Contact page's markdown body directly.

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

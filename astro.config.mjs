import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE_URL = 'https://dannydwyer.sarujump.workers.dev';

// The sitemap integration only sees final URLs, not content collection data,
// so hidden work items (drafts, placeholders, old temp reels) and admin
// pages are read straight from the content files here to build an exclude
// set — otherwise they'd keep shipping in sitemap-0.xml even though they're
// noindex'd (work/[slug].astro) or deliberately kept out of every on-site
// list. A page can still be reached directly by URL; it's just never
// submitted to search engines as something worth crawling/indexing.
const videosDir = fileURLToPath(new URL('./src/content/videos', import.meta.url));
const videoFrontmatter = readdirSync(videosDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => readFileSync(`${videosDir}/${f}`, 'utf-8'));

const hiddenSlugs = new Set(
  videoFrontmatter
    .filter((raw) => /^hidden: true$/m.test(raw))
    .map((raw) => raw.match(/^urlSlug: "(.*)"$/m)?.[1])
    .filter(Boolean)
);

const uploadDateBySlug = new Map(
  videoFrontmatter.map((raw) => [
    raw.match(/^urlSlug: "(.*)"$/m)?.[1],
    raw.match(/^uploadDate: "(.*)"$/m)?.[1],
  ])
);

const excludedPaths = new Set(['/admin/', '/admin/login/', ...[...hiddenSlugs].map((s) => `/work/${s}/`)]);

export default defineConfig({
  site: SITE_URL,
  integrations: [
    sitemap({
      filter: (page) => !excludedPaths.has(new URL(page).pathname),
      serialize: (item) => {
        const slug = new URL(item.url).pathname.match(/^\/work\/(.+)\/$/)?.[1];
        const lastmod = slug ? uploadDateBySlug.get(slug) : undefined;
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  output: 'static',
});

// Thin typed wrapper around seo.json — the admin's "SEO" tab writes to it
// directly (via the GitHub API), same pattern as site.ts/layout.ts. Every
// field is an *override*: an empty string means "use the page's own smart
// default" (e.g. Work's description already includes a live video count),
// so this file only ever needs to hold what someone actually typed.
import raw from './seo.json';

export type SeoPageKey = 'home' | 'work' | 'contact';

export interface SeoOverride {
  title: string;
  description: string;
  ogImage: string;
}

const seoData = raw as Record<string, SeoOverride | undefined>;

const EMPTY: SeoOverride = { title: '', description: '', ogImage: '' };

export function getSeoOverride(page: SeoPageKey): SeoOverride {
  return seoData[page] ?? EMPTY;
}

// Thin typed wrapper around layout.json — the admin's "Layout" tab writes to
// it directly (via the GitHub API), same pattern as site.ts/site.json. It
// controls section visibility and order only, never content: what each
// section shows still comes from Home/Work/Contact/Settings, same as today.
import raw from './layout.json';

export type PageKey = 'home' | 'work' | 'contact';
export type SectionId = HomeSectionId | WorkSectionId | ContactSectionId;
export type HomeSectionId = 'hero' | 'intro' | 'featured';
export type WorkSectionId = 'banner' | 'controls' | 'grid';
export type ContactSectionId = 'title' | 'body';

interface SectionEntry {
  type: string;
  enabled: boolean;
}

const layoutData = raw as Record<string, SectionEntry[] | undefined>;

// The canonical section list per page, in default order — the source of
// truth for "what sections exist at all." layout.json only ever reorders or
// toggles these; it can't introduce new section types. Used both as the
// fallback when a page is missing from layout.json (e.g. a fresh deploy
// before the admin has touched Layout at all) and to silently drop any
// stored entry whose type no longer matches a real section (e.g. after a
// future code change retires one).
const DEFAULTS: Record<PageKey, SectionId[]> = {
  home: ['hero', 'intro', 'featured'],
  work: ['banner', 'controls', 'grid'],
  contact: ['title', 'body'],
};

// Returns the enabled section ids for a page, in display order. Falls back
// to that page's full default list (all enabled, default order) if
// layout.json has nothing stored for it yet.
export function getEnabledSections<K extends PageKey>(page: K): SectionId[] {
  const stored = layoutData[page];
  if (!stored || stored.length === 0) return DEFAULTS[page];
  const valid = new Set(DEFAULTS[page]);
  return stored.filter((s): s is SectionEntry & { type: SectionId } => s.enabled && valid.has(s.type as SectionId)).map((s) => s.type);
}

// Returns every section for a page (enabled or not), in stored order, for
// the admin's Layout tab — falls back to the full default list (all
// enabled) the same way getEnabledSections does.
export function getAllSections(page: PageKey): { type: SectionId; enabled: boolean }[] {
  const stored = layoutData[page];
  const valid = new Set(DEFAULTS[page]);
  if (!stored || stored.length === 0) return DEFAULTS[page].map((type) => ({ type, enabled: true }));
  const filtered = stored.filter((s): s is SectionEntry & { type: SectionId } => valid.has(s.type as SectionId));
  // Any default section missing from the stored list (e.g. added by a code
  // change after the admin last saved Layout) is appended as enabled, so it
  // doesn't silently disappear until someone visits the Layout tab.
  const present = new Set(filtered.map((s) => s.type));
  const missing = DEFAULTS[page].filter((t) => !present.has(t)).map((type) => ({ type, enabled: true }));
  return [...filtered, ...missing];
}

export const SECTION_LABELS: Record<SectionId, string> = {
  hero: 'Hero video',
  intro: 'Intro / bio',
  featured: 'Featured Work grid',
  banner: 'Title + description',
  controls: 'Filters + search',
  grid: 'Video grid',
  title: 'Page title',
  body: 'Photo, copy & contact button',
};

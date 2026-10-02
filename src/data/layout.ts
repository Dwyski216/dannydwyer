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

export interface SectionEntry {
  type: string;
  enabled: boolean;
}

const layoutData = raw as Record<string, SectionEntry[] | undefined>;

// The canonical section list per page, in default order — the single source
// of truth for "what sections exist at all." layout.json only ever reorders
// or toggles these; it can't introduce new section types. Exported (not just
// used internally) so the admin's Layout tab can build its page/section list
// from the same data this module normalizes against, instead of keeping its
// own hand-written copy that could silently drift from this one.
export const DEFAULTS: Record<PageKey, SectionId[]> = {
  home: ['hero', 'intro', 'featured'],
  work: ['banner', 'controls', 'grid'],
  contact: ['title', 'body'],
};

export const PAGE_KEYS = Object.keys(DEFAULTS) as PageKey[];

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

// The actual normalization rule — "drop any stored entry whose type isn't
// real, append any real section missing from storage (as enabled)" — lives
// here ONCE, as a pure function over whatever section list is handed to it.
// Both getAllSections below (the statically-imported, build-time data) and
// the admin's Layout tab (live data fetched from GET /api/layout) call this
// same function, so there's no second copy of the rule to fall out of sync.
export function normalizeSections<K extends PageKey>(page: K, stored: SectionEntry[] | undefined): { type: SectionId; enabled: boolean }[] {
  const valid = new Set(DEFAULTS[page]);
  const filtered = (stored ?? []).filter((s): s is SectionEntry & { type: SectionId } => valid.has(s.type as SectionId));
  const present = new Set(filtered.map((s) => s.type));
  const missing = DEFAULTS[page].filter((t) => !present.has(t)).map((type) => ({ type, enabled: true }));
  return [...filtered, ...missing];
}

// Returns the enabled section ids for a page, in display order. Falls back
// to that page's full default list (all enabled, default order) if
// layout.json has nothing stored for it yet.
export function getEnabledSections<K extends PageKey>(page: K): SectionId[] {
  return getAllSections(page)
    .filter((s) => s.enabled)
    .map((s) => s.type);
}

// Returns every section for a page (enabled or not), in stored order, for
// the admin's Layout tab.
export function getAllSections<K extends PageKey>(page: K): { type: SectionId; enabled: boolean }[] {
  return normalizeSections(page, layoutData[page]);
}

// Thin typed wrapper around layout.json, which fixes the order (and on/off
// state) of each page's sections. It controls arrangement only, never
// content: what each section shows comes from Home/Work/Contact/Settings.
// The admin no longer edits it; change layout.json by hand if a page's
// section order ever needs to move.
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

// The canonical section list per page, in default order — the single source
// of truth for "what sections exist at all." layout.json only ever reorders
// or toggles these; it can't introduce new section types.
const DEFAULTS: Record<PageKey, SectionId[]> = {
  home: ['hero', 'intro', 'featured'],
  work: ['banner', 'controls', 'grid'],
  contact: ['title', 'body'],
};

// Drop any stored entry whose type isn't real, and append any real section
// missing from storage (as enabled).
function normalizeSections<K extends PageKey>(page: K, stored: SectionEntry[] | undefined): { type: SectionId; enabled: boolean }[] {
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
  return normalizeSections(page, layoutData[page])
    .filter((s) => s.enabled)
    .map((s) => s.type);
}

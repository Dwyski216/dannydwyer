// Thin typed wrapper around site.json. The admin panel writes to site.json
// directly (via the GitHub API), so keep this file's shape in sync with it.
import raw from './site.json';

export const site = raw as {
  name: string;
  role: string;
  tagline: string;
  introCopy: string; // HTML, edited via the admin panel's rich text field
  email: string;
  location: string;
  socials: Record<string, string>;
  heroVideo: { platform: 'youtube' | 'vimeo'; videoId: string } | null;
  featuredSlugs: string[]; // urlSlugs of videos shown in the home page's Featured Work row
};

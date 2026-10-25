// The Work page's category buttons. Each one is also its own page
// (/documentary, /commercial, /music-videos): the Work page pre-filtered to
// that tag, with its own title and description for Google and link
// previews. Videos land in a category by having its tag in the admin.
export interface Category {
  slug: string; // URL: dannydwyer.com/<slug>
  tag: string; // the video tag it shows (lowercase)
  label: string; // button text
  title: string; // browser tab / Google / link-preview title
  noun: string; // used in the generated description
}

export const CATEGORIES: Category[] = [
  { slug: 'documentary', tag: 'documentary', label: 'Documentary', title: 'Danny Dwyer | Documentary Cinematographer & Director', noun: 'documentary films and branded docs' },
  { slug: 'commercial', tag: 'commercial', label: 'Commercial', title: 'Commercial | Danny Dwyer', noun: 'commercials and brand campaigns' },
  { slug: 'music-videos', tag: 'music video', label: 'Music Videos', title: 'Music Videos | Danny Dwyer', noun: 'music videos' },
];

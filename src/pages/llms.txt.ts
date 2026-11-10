// llms.txt — a plain-text index of the site for AI crawlers and answer
// engines (ChatGPT, Perplexity, Claude, Google AI Overviews) that increasingly
// check for this file the way search engines check robots.txt/sitemap.xml.
// See https://llmstxt.org. Generated at build time from live content so it
// never drifts from the actual video list.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../data/site';
import { byDisplayOrder } from '../lib/video';

// The bio is stored as HTML (the admin's rich text editor); this file is
// plain text, so paragraphs become blank lines and the tags come out.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const GET: APIRoute = async ({ site: astroSite }) => {
  const videos = (await getCollection('videos', (v) => !v.data.hidden)).sort((a, b) => byDisplayOrder(a.data, b.data));
  const base = astroSite?.toString().replace(/\/$/, '') ?? '';

  const lines = [
    `# ${site.name}`,
    '',
    `> ${site.tagline}`,
    '',
    htmlToText(site.introCopy),
    '',
    `${site.name} is a ${site.role} based in ${site.location}. Contact: ${site.email}.`,
    '',
    '## Work',
    '',
    `Full catalog of ${videos.length} video projects, filterable by tag at ${base}/work/.`,
    '',
    ...videos.map((v) => {
      const facts = [
        v.data.projectName ? `Project: ${v.data.projectName}` : null,
        v.data.client ? `Client: ${v.data.client}` : null,
        v.data.credits.length ? `Credits: ${v.data.credits.map((c) => [c.role, c.name].filter(Boolean).join(': ')).join(', ')}` : null,
        v.data.equipment.length ? `Equipment: ${v.data.equipment.map((e) => [e.category, e.item].filter(Boolean).join(': ')).join(', ')}` : null,
        `Tags: ${v.data.tags.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · ');
      return `- [${v.data.title}](${base}/work/${v.data.urlSlug}/): ${v.data.summary} (${facts})`;
    }),
    '',
    '## Pages',
    '',
    `- [Contact](${base}/contact/)`,
    `- [Sitemap](${base}/sitemap-index.xml)`,
  ];

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

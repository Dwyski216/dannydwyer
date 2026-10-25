// robots.txt, built so its sitemap link always uses the site's address
// (SITE_URL in astro.config.mjs).
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /api',
      '',
      `Sitemap: ${new URL('/sitemap-index.xml', site)}`,
      '',
      '# AI answer engines: see /llms.txt for a plain-text index of this site.',
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );

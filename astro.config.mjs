import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://dannydwyer.sarujump.workers.dev';

export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
  output: 'static',
});

// Cloudflare Worker — handles the admin panel's write endpoints and its
// login gate.
//
// wrangler.jsonc sets `run_worker_first: true`, so every request reaches
// this Worker before Cloudflare's static asset handling — that's what lets
// it gate /admin* itself, not just the /api/* write endpoints. Anything not
// explicitly handled below falls through to env.ASSETS.fetch() at the
// bottom, which serves the static build from dist/ exactly as before.
//
// Auth is a single shared password (ADMIN_PASSWORD, a Worker secret) behind
// an HMAC-signed, HttpOnly session cookie (SESSION_SECRET, another Worker
// secret) — this is a one-admin portfolio site, not a multi-user app, so a
// full accounts system would be overkill. GITHUB_TOKEN is a third secret;
// none of the three are ever exposed to the browser.

export interface Env {
  ASSETS: Fetcher;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // e.g. "hamburgersandfries/dannydwyer"
  GITHUB_BRANCH: string; // e.g. "main"
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

async function hmac(env: Env, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [expiryStr, sig] = token.split('.');
  if (!expiryStr || !sig) return false;
  const expected = await hmac(env, expiryStr);
  if (!timingSafeEqual(sig, expected)) return false;
  const expiry = Number(expiryStr);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

async function sessionCookieHeader(env: Env): Promise<string> {
  const expiry = Date.now() + SESSION_TTL_MS;
  const sig = await hmac(env, String(expiry));
  return `${SESSION_COOKIE}=${expiry}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const VIDEOS_DIR = 'src/content/videos';
const INDEX_PATH = 'src/data/work-index.json';

interface WorkIndexItem {
  slug: string;
  title: string;
  tags: string[];
  uploadDate: string;
  hidden: boolean;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      // JSON is a valid subset of YAML flow style, so this round-trips cleanly
      // through both the astro:content YAML parser and the admin panel's own
      // JSON.parse-based raw editor.
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const [, fm, body] = match;
  const data: Record<string, any> = {};
  fm.split('\n').forEach((line) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value.startsWith('[') || value.startsWith('{')) {
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = value.startsWith('[') ? [] : {};
      }
    } else if (value === 'true' || value === 'false') {
      data[key] = value === 'true';
    } else if (value.startsWith('"') && value.endsWith('"')) {
      // toFrontmatter writes strings via JSON.stringify, so this is valid
      // JSON string syntax — parse it properly instead of just trimming the
      // outer quotes, or an escaped character like \" survives as a literal
      // backslash instead of becoming the quote it represents.
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = value.replace(/^"|"$/g, '');
      }
    } else {
      data[key] = value;
    }
  });
  return { data, body: body.trim() };
}

async function githubRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dannydwyer-admin',
      ...(init.headers ?? {}),
    },
  });
}

async function getFile(env: Env, path: string) {
  const res = await githubRequest(env, `${path}?ref=${env.GITHUB_BRANCH}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; sha: string };
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  return { content, sha: data.sha };
}

async function putFile(env: Env, path: string, content: string, sha: string | undefined, message: string) {
  return githubRequest(env, path, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'ADMIN_PASSWORD is not configured on this deployment.' }, 500);
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const password = body.password ?? '';
  if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return json({ error: 'Incorrect password.' }, 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookieHeader(env) });
}

function handleLogout(): Response {
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookieHeader() });
}

async function listVideoSlugs(env: Env): Promise<{ slugs: string[] } | { error: string }> {
  const res = await githubRequest(env, `${VIDEOS_DIR}?ref=${env.GITHUB_BRANCH}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub API returned ${res.status} listing ${VIDEOS_DIR}${detail ? `: ${detail}` : ''}` };
  }
  const files = (await res.json()) as { name: string }[];
  return { slugs: files.filter((f) => f.name.endsWith('.md')).map((f) => f.name.replace(/\.md$/, '')) };
}

// The lightweight index (src/data/work-index.json) is a derived cache of
// title/tags/date/hidden for every video, kept in sync on every write path
// below. It exists so the admin's Work list, Featured Work picker, and tag
// manager cost a single GitHub API call regardless of catalog size — the
// old approach fetched every video file individually on every page load,
// which scales linearly and eventually exceeds the Worker's subrequest cap
// per invocation. The video markdown files remain the actual source of
// truth; this index can always be rebuilt from them via /api/videos/reindex.
async function readIndex(env: Env): Promise<{ items: WorkIndexItem[]; sha: string | undefined } | { error: string }> {
  const res = await githubRequest(env, `${INDEX_PATH}?ref=${env.GITHUB_BRANCH}`);
  // A real 404 means the index hasn't been built yet — that's a legitimate
  // empty starting state (the first write will create the file). Any other
  // failure (bad credentials, wrong repo, a network hiccup, ...) must NOT
  // be treated the same way, or a real error would silently look like "no
  // items" instead of surfacing as the failure it actually is.
  if (res.status === 404) return { items: [], sha: undefined };
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub API returned ${res.status} reading ${INDEX_PATH}${detail ? `: ${detail}` : ''}` };
  }
  const data = (await res.json()) as { content: string; sha: string };
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  try {
    return { items: JSON.parse(content) as WorkIndexItem[], sha: data.sha };
  } catch {
    return { error: `${INDEX_PATH} contains invalid JSON. Use "Rebuild Index" to regenerate it.` };
  }
}

async function writeIndex(env: Env, items: WorkIndexItem[], sha: string | undefined, message: string) {
  return putFile(env, INDEX_PATH, JSON.stringify(items, null, 2) + '\n', sha, message);
}

async function handleVideosGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (slug) {
    const res = await githubRequest(env, `${VIDEOS_DIR}/${slug}.md?ref=${env.GITHUB_BRANCH}`);
    if (!res.ok) return json({ error: 'Video not found' }, 404);
    const data = (await res.json()) as { content: string };
    const raw = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return json({ slug, raw });
  }

  if (url.searchParams.get('full') === '1') {
    const index = await readIndex(env);
    if ('error' in index) return json({ error: index.error }, 502);
    return json({ items: index.items });
  }

  const listing = await listVideoSlugs(env);
  if ('error' in listing) return json({ error: listing.error }, 502);
  return json({ slugs: listing.slugs });
}

async function handleVideosDelete(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return json({ error: 'Missing slug' }, 400);

  const filePath = `${VIDEOS_DIR}/${slug}.md`;
  const existing = await githubRequest(env, `${filePath}?ref=${env.GITHUB_BRANCH}`);
  if (!existing.ok) return json({ error: 'Video not found' }, 404);
  const { sha } = (await existing.json()) as { sha: string };

  const res = await githubRequest(env, filePath, {
    method: 'DELETE',
    body: JSON.stringify({ message: `Delete video: ${slug}`, sha, branch: env.GITHUB_BRANCH }),
  });
  if (!res.ok) {
    const err = await res.text();
    return json({ error: 'GitHub delete failed', details: err }, 502);
  }

  const index = await readIndex(env);
  let indexWarning: string | undefined;
  if ('error' in index) {
    indexWarning = index.error;
  } else {
    const updateRes = await writeIndex(
      env,
      index.items.filter((it) => it.slug !== slug),
      index.sha,
      `Remove ${slug} from work index`
    );
    if (!updateRes.ok) indexWarning = 'Video deleted, but the Work index could not be updated — use "Rebuild Index".';
  }

  return json({ ok: true, slug, ...(indexWarning ? { indexWarning } : {}) });
}

async function handleTagsPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'rename' | 'delete';
    tag?: string;
    newTag?: string;
  };
  if (!body.tag || (body.action !== 'rename' && body.action !== 'delete')) {
    return json({ error: 'Expects { action: "rename"|"delete", tag, newTag? }' }, 400);
  }
  if (body.action === 'rename' && !body.newTag?.trim()) {
    return json({ error: 'newTag is required for rename' }, 400);
  }

  const index = await readIndex(env);
  if ('error' in index) return json({ error: index.error }, 502);

  // The index already knows which slugs have this tag, so only those files
  // need to be touched at all — no need to read (or even list) every video
  // in the catalog just to check membership.
  const affectedSlugs = index.items.filter((it) => it.tags.includes(body.tag)).map((it) => it.slug);

  const updated: string[] = [];
  const failed: string[] = [];

  // Sequential, not parallel: each match is its own commit to the same
  // directory, and doing them one at a time avoids racing GitHub's API.
  for (const slug of affectedSlugs) {
    const filePath = `${VIDEOS_DIR}/${slug}.md`;
    const fileRes = await githubRequest(env, `${filePath}?ref=${env.GITHUB_BRANCH}`);
    if (!fileRes.ok) {
      failed.push(slug);
      continue;
    }
    const fileData = (await fileRes.json()) as { content: string; sha: string };
    const raw = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
    const { data, body: mdBody } = parseFrontmatter(raw);
    const tags: string[] = Array.isArray(data.tags) ? data.tags : [];

    const newTags =
      body.action === 'delete' ? tags.filter((t) => t !== body.tag) : tags.map((t) => (t === body.tag ? body.newTag : t));

    const frontmatter = toFrontmatter({ ...data, tags: newTags });
    const fileContent = `${frontmatter}\n\n${mdBody}\n`;
    const message =
      body.action === 'delete' ? `Remove tag "${body.tag}" from ${slug}` : `Rename tag "${body.tag}" to "${body.newTag}" on ${slug}`;
    const res = await putFile(env, filePath, fileContent, fileData.sha, message);
    if (res.ok) updated.push(slug);
    else failed.push(slug);
  }

  // Update the index's cached tags for every item that actually got
  // updated (skip ones that failed, so the index doesn't drift ahead of
  // what's actually committed).
  const newIndexItems = index.items.map((it) => {
    if (!updated.includes(it.slug)) return it;
    const newTags =
      body.action === 'delete' ? it.tags.filter((t) => t !== body.tag) : it.tags.map((t) => (t === body.tag ? body.newTag! : t));
    return { ...it, tags: newTags };
  });
  const indexRes = await writeIndex(
    env,
    newIndexItems,
    index.sha,
    body.action === 'delete' ? `Remove tag "${body.tag}" from work index` : `Rename tag "${body.tag}" to "${body.newTag}" in work index`
  );
  const indexWarning = !indexRes.ok ? 'Tags updated, but the Work index could not be updated — use "Rebuild Index".' : undefined;

  return json({ ok: true, updated, failed, ...(indexWarning ? { indexWarning } : {}) });
}

async function handleVideosPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Record<string, any>;
  const slug = slugify(body.slug || body.title);
  const filePath = `${VIDEOS_DIR}/${slug}.md`;

  const frontmatter = toFrontmatter({
    title: body.title,
    summary: body.summary,
    platform: body.platform === 'vimeo' ? 'vimeo' : 'youtube',
    videoId: body.videoId,
    thumbnailUrl: body.thumbnailUrl || undefined,
    role: body.role || 'Director of Photography',
    client: body.client || undefined,
    projectName: body.projectName || undefined,
    uploadDate: body.uploadDate,
    durationISO: body.durationISO || undefined,
    tags: body.tags || [],
    stills: body.stills || [],
    urlSlug: slug,
    hidden: !!body.hidden,
  });

  const fileContent = `${frontmatter}\n\n${body.description || ''}\n`;
  const existing = await githubRequest(env, `${filePath}?ref=${env.GITHUB_BRANCH}`);
  const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;

  const commitRes = await putFile(
    env,
    filePath,
    fileContent,
    sha,
    sha ? `Update video: ${body.title}` : `Add video: ${body.title}`
  );

  if (!commitRes.ok) {
    const err = await commitRes.text();
    return json({ error: 'GitHub commit failed', details: err }, 502);
  }

  const index = await readIndex(env);
  let indexWarning: string | undefined;
  if ('error' in index) {
    indexWarning = index.error;
  } else {
    const originalSlug = typeof body.originalSlug === 'string' ? body.originalSlug : '';
    const items = index.items.filter((it) => it.slug !== slug && it.slug !== originalSlug);
    items.push({
      slug,
      title: body.title,
      tags: Array.isArray(body.tags) ? body.tags : [],
      uploadDate: body.uploadDate || '',
      hidden: !!body.hidden,
    });
    const updateRes = await writeIndex(env, items, index.sha, `Update work index for ${slug}`);
    if (!updateRes.ok) indexWarning = 'Video saved, but the Work index could not be updated — use "Rebuild Index".';
  }

  return json({ ok: true, slug, ...(indexWarning ? { indexWarning } : {}) });
}

// Rebuilds work-index.json from scratch by reading every video file — an
// explicit, admin-triggered repair action for when the index has drifted
// (e.g. a prior write's index update failed). Unlike the old per-page-load
// listing this replaced, this is rare enough that scanning every file in
// small batches is an acceptable cost.
async function handleVideosReindex(_request: Request, env: Env): Promise<Response> {
  const listing = await listVideoSlugs(env);
  if ('error' in listing) return json({ error: listing.error }, 502);

  const BATCH_SIZE = 10;
  const items: WorkIndexItem[] = [];
  for (let i = 0; i < listing.slugs.length; i += BATCH_SIZE) {
    const batch = listing.slugs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (s): Promise<WorkIndexItem | null> => {
        const fileRes = await githubRequest(env, `${VIDEOS_DIR}/${s}.md?ref=${env.GITHUB_BRANCH}`);
        if (!fileRes.ok) return null;
        const fileData = (await fileRes.json()) as { content: string };
        const raw = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
        const { data } = parseFrontmatter(raw);
        return {
          slug: s,
          title: data.title ?? s,
          tags: Array.isArray(data.tags) ? data.tags : [],
          uploadDate: data.uploadDate ?? '',
          hidden: !!data.hidden,
        };
      })
    );
    items.push(...batchResults.filter((it): it is WorkIndexItem => it !== null));
  }

  const existing = await getFile(env, INDEX_PATH);
  const res = await writeIndex(env, items, existing?.sha, 'Rebuild work index');
  if (!res.ok) {
    const err = await res.text();
    return json({ error: 'Failed to write rebuilt index', details: err }, 502);
  }

  return json({ ok: true, count: items.length });
}

async function handleSettingsGet(_request: Request, env: Env): Promise<Response> {
  const settingsRes = await githubRequest(env, `src/data/site.json?ref=${env.GITHUB_BRANCH}`);
  const contactRes = await githubRequest(env, `src/content/pages/contact.md?ref=${env.GITHUB_BRANCH}`);

  if (!settingsRes.ok || !contactRes.ok) {
    const failed = !settingsRes.ok ? settingsRes : contactRes;
    const detail = await failed.text().catch(() => '');
    return json(
      {
        settings: null,
        contact: null,
        error: `GitHub API returned ${failed.status} reading site settings${detail ? `: ${detail}` : ''}`,
      },
      502
    );
  }

  const settingsData = (await settingsRes.json()) as { content: string };
  const contactData = (await contactRes.json()) as { content: string };
  const settingsContent = decodeURIComponent(escape(atob(settingsData.content.replace(/\n/g, ''))));
  const contactContent = decodeURIComponent(escape(atob(contactData.content.replace(/\n/g, ''))));
  const contactParsed = parseFrontmatter(contactContent);

  return json({
    settings: JSON.parse(settingsContent),
    contact: { title: contactParsed.data.title ?? '', summary: contactParsed.data.summary ?? '', body: contactParsed.body },
  });
}

async function handleSettingsPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    settings?: Record<string, any>;
    contact?: { title?: string; summary?: string; body?: string };
  };

  if (body.settings) {
    const existing = await getFile(env, 'src/data/site.json');
    const res = await putFile(
      env,
      'src/data/site.json',
      JSON.stringify(body.settings, null, 2) + '\n',
      existing?.sha,
      'Update site settings'
    );
    if (!res.ok) return json({ error: 'Failed to update settings' }, 502);
  }

  if (body.contact) {
    const frontmatter = toFrontmatter({
      title: body.contact.title || 'Contact',
      summary: body.contact.summary || undefined,
    });
    const fileContent = `${frontmatter}\n\n${body.contact.body || ''}\n`;
    const existing = await getFile(env, 'src/content/pages/contact.md');
    const res = await putFile(env, 'src/content/pages/contact.md', fileContent, existing?.sha, 'Update contact page');
    if (!res.ok) return json({ error: 'Failed to update contact page' }, 502);
  }

  return json({ ok: true });
}

async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env);
  if (pathname === '/api/logout' && request.method === 'POST') return handleLogout();

  const isLoginPage = pathname === '/admin/login' || pathname === '/admin/login/';
  const isAdminPage = !isLoginPage && (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/'));
  const isProtectedApi =
    pathname === '/api/videos' || pathname === '/api/videos/reindex' || pathname === '/api/settings' || pathname === '/api/tags';

  if (isAdminPage || isProtectedApi) {
    const authed = await isAuthenticated(request, env);
    if (!authed) {
      if (isProtectedApi) return json({ error: 'Unauthorized' }, 401);
      return Response.redirect(`${url.origin}/admin/login`, 302);
    }
  }

  if (pathname === '/api/videos') {
    if (request.method === 'GET') return handleVideosGet(request, env);
    if (request.method === 'POST') return handleVideosPost(request, env);
    if (request.method === 'DELETE') return handleVideosDelete(request, env);
  }

  if (pathname === '/api/videos/reindex' && request.method === 'POST') {
    return handleVideosReindex(request, env);
  }

  if (pathname === '/api/settings') {
    if (request.method === 'GET') return handleSettingsGet(request, env);
    if (request.method === 'POST') return handleSettingsPost(request, env);
  }

  if (pathname === '/api/tags' && request.method === 'POST') {
    return handleTagsPost(request, env);
  }

  // Everything else — every static page, image, and the login page
  // itself — is served straight from the build.
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await router(request, env);
    } catch (err) {
      // Anything uncaught here (a thrown exception mid-handler, hitting the
      // Worker's subrequest cap, etc.) would otherwise surface as
      // Cloudflare's own generic HTML error page — which breaks every
      // admin panel fetch() call expecting JSON with a confusing
      // "Unexpected token '<'" parse error. Always answer API routes with
      // JSON so failures are diagnosable from the admin UI itself.
      const isApi = new URL(request.url).pathname.startsWith('/api/');
      if (isApi) {
        return json({ error: `Worker error: ${err instanceof Error ? err.message : String(err)}` }, 500);
      }
      throw err;
    }
  },
};

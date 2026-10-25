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

import { CATEGORIES } from '../src/data/categories';

export interface Env {
  ASSETS: Fetcher;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // e.g. "Dwyski216/dannydwyer"
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
  order: number;
  categoryOrder?: CategoryOrder;
}

// A video's own position on each category page (/documentary, ...), keyed
// by the category's tag; a category without one falls back to `order`.
type CategoryOrder = Record<string, number>;
const CATEGORY_TAGS = CATEGORIES.map((c) => c.tag);

// Keeps only real category tags with numeric positions; undefined when
// nothing is left, so the frontmatter line is left out entirely.
function cleanCategoryOrder(value: unknown): CategoryOrder | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: CategoryOrder = {};
  for (const [tag, n] of Object.entries(value)) {
    if (CATEGORY_TAGS.includes(tag) && typeof n === 'number' && Number.isFinite(n)) out[tag] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Every endpoint that takes a slug from the client (query param or body)
// and interpolates it into a GitHub Contents API path validates it against
// this first — slugify()'s own output always matches it, so this only ever
// rejects something that didn't come from slugify (a hand-crafted request,
// a stray "../"), not a real slug a save produced.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
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
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      // toFrontmatter writes numbers bare (e.g. `order: 220`); read them back
      // as numbers, or a patch that only touches tags re-saves them quoted
      // and the content schema (order: number) fails the whole site build.
      data[key] = Number(value);
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

// Reads one video's frontmatter, lets the caller transform it, and commits
// the result — the single shared "patch a video file" primitive behind
// every endpoint that edits one or more videos without replacing their
// whole content (reorder, tag rename/delete, bulk tag edit). Each of those
// endpoints still owns its own index.json read/write: a patch here only
// ever touches the one video file, on purpose, so callers that need to
// patch many videos can batch (e.g. Promise.all) these calls freely and
// settle the shared index exactly once afterward, rather than once per
// video.
async function patchVideoFrontmatter(
  env: Env,
  slug: string,
  patch: (data: Record<string, any>) => Record<string, any>,
  message: string
): Promise<boolean> {
  const file = await getFile(env, `${VIDEOS_DIR}/${slug}.md`);
  if (!file) return false;
  const { data, body: mdBody } = parseFrontmatter(file.content);
  const frontmatter = toFrontmatter(patch(data));
  const fileContent = `${frontmatter}\n\n${mdBody}\n`;
  const res = await putFile(env, `${VIDEOS_DIR}/${slug}.md`, fileContent, file.sha, message);
  return res.ok;
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
    if (!isValidSlug(slug)) return json({ error: 'Invalid slug' }, 400);
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
  if (!isValidSlug(slug)) return json({ error: 'Invalid slug' }, 400);

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

// Reordering (the admin's up/down move) swaps the `order` value of two
// adjacent items, which means patching two video files — both moves must
// land in a single request with a single work-index.json read/write.
// Sending them as two separate requests was tried first and had a real
// race: each one independently reads the index's current sha, so two
// concurrent writes could both read the same pre-move sha and one would
// lose GitHub's optimistic-concurrency check and fail (silently, since
// nothing surfaced it) — see the per-move loop below, which patches every
// video file first (safe to do concurrently; each touches a different file
// with its own sha) and only then does the index's one read-then-write.
// Commits several files to the branch as ONE commit (Git Data API), so a
// change touching many videos lands as a single commit and a single
// Cloudflare deploy, instead of a burst of parallel commits that can race
// each other. Retries once if the branch moved underneath it (e.g. another
// admin save landed at the same moment).
async function commitFiles(env: Env, files: { path: string; content: string }[], message: string): Promise<boolean> {
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dannydwyer-admin',
        ...(init.headers ?? {}),
      },
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const refRes = await api(`git/ref/heads/${env.GITHUB_BRANCH}`);
    if (!refRes.ok) return false;
    const headSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
    const commitRes = await api(`git/commits/${headSha}`);
    if (!commitRes.ok) return false;
    const baseTree = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;
    const treeRes = await api('git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
    });
    if (!treeRes.ok) return false;
    const treeSha = ((await treeRes.json()) as { sha: string }).sha;
    const newCommitRes = await api('git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: treeSha, parents: [headSha] }),
    });
    if (!newCommitRes.ok) return false;
    const newSha = ((await newCommitRes.json()) as { sha: string }).sha;
    const updateRes = await api(`git/refs/heads/${env.GITHUB_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newSha, force: false }),
    });
    if (updateRes.ok) return true;
    if (updateRes.status !== 422) return false; // 422 = branch moved; rebuild on the new head
  }
  return false;
}

// Saves a new Work order: every moved video's `order` plus the Work index,
// all in one commit (see commitFiles). All or nothing. With a `category`
// (a category's tag), it saves that category page's own order instead.
async function handleVideosReorder(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { category?: string; moves?: { slug?: string; order?: number }[] };
  const category = body.category;
  if (category !== undefined && !CATEGORY_TAGS.includes(category)) return json({ error: `Unknown category: ${category}` }, 400);
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (moves.length === 0) return json({ error: 'Expects { moves: [{ slug, order }, ...] }' }, 400);
  for (const m of moves) {
    if (!m.slug || typeof m.order !== 'number') return json({ error: 'Each move needs a slug and a numeric order' }, 400);
    if (!isValidSlug(m.slug)) return json({ error: `Invalid slug: ${m.slug}` }, 400);
  }
  // Cloudflare allows 50 subrequests per call: one read per video, plus the
  // index and the commit's handful. The admin sends batches of 25.
  if (moves.length > 30) return json({ error: 'Too many videos in one save; send at most 30 at a time.' }, 400);
  const validMoves = moves as { slug: string; order: number }[];

  const files = await Promise.all(validMoves.map((m) => getFile(env, `${VIDEOS_DIR}/${m.slug}.md`)));
  const missing = validMoves.filter((_, i) => !files[i]).map((m) => m.slug);
  if (missing.length) return json({ error: `Could not read: ${missing.join(', ')}` }, 502);

  // The new position goes in `order`, or in the category's slot.
  const withMove = <T extends { order?: unknown; categoryOrder?: unknown }>(item: T, order: number): T =>
    category
      ? { ...item, categoryOrder: { ...(cleanCategoryOrder(item.categoryOrder) ?? {}), [category]: order } }
      : { ...item, order };

  const changes = validMoves.map((m, i) => {
    const { data, body: mdBody } = parseFrontmatter(files[i]!.content);
    return { path: `${VIDEOS_DIR}/${m.slug}.md`, content: `${toFrontmatter(withMove(data, m.order))}\n\n${mdBody}\n` };
  });

  const orderBySlug = new Map(validMoves.map((m) => [m.slug, m.order]));
  const index = await readIndex(env);
  let indexWarning: string | undefined;
  if ('error' in index) {
    indexWarning = index.error;
  } else {
    const items = index.items.map((it) => (orderBySlug.has(it.slug) ? withMove(it, orderBySlug.get(it.slug)!) : it));
    changes.push({ path: INDEX_PATH, content: JSON.stringify(items, null, 2) + '\n' });
  }

  const label = category ? (CATEGORIES.find((c) => c.tag === category)?.label ?? category) : 'Work';
  const ok = await commitFiles(env, changes, `Reorder ${label} (${validMoves.length} item${validMoves.length === 1 ? '' : 's'})`);
  if (!ok) return json({ error: 'GitHub commit failed; nothing was changed. Try again.' }, 502);
  return json({ ok: true, ...(indexWarning ? { indexWarning } : {}) });
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
  const tag = body.tag; // narrowed to string above; re-bound so closures below see that

  const index = await readIndex(env);
  if ('error' in index) return json({ error: index.error }, 502);

  // The index already knows which slugs have this tag, so only those files
  // need to be touched at all — no need to read (or even list) every video
  // in the catalog just to check membership.
  const affectedSlugs = index.items.filter((it) => it.tags.includes(tag)).map((it) => it.slug);

  const newTagsFor = (tags: string[]) =>
    body.action === 'delete' ? tags.filter((t) => t !== tag) : tags.map((t) => (t === tag ? body.newTag! : t));

  const updated: string[] = [];
  const failed: string[] = [];

  // Sequential, not parallel: each match is its own commit to the same
  // directory, and doing them one at a time avoids racing GitHub's API.
  for (const slug of affectedSlugs) {
    const message =
      body.action === 'delete' ? `Remove tag "${tag}" from ${slug}` : `Rename tag "${tag}" to "${body.newTag}" on ${slug}`;
    const ok = await patchVideoFrontmatter(env, slug, (data) => ({ ...data, tags: newTagsFor(Array.isArray(data.tags) ? data.tags : []) }), message);
    (ok ? updated : failed).push(slug);
  }

  // Update the index's cached tags for every item that actually got
  // updated (skip ones that failed, so the index doesn't drift ahead of
  // what's actually committed).
  const newIndexItems = index.items.map((it) => (updated.includes(it.slug) ? { ...it, tags: newTagsFor(it.tags) } : it));
  const indexRes = await writeIndex(
    env,
    newIndexItems,
    index.sha,
    body.action === 'delete' ? `Remove tag "${tag}" from work index` : `Rename tag "${tag}" to "${body.newTag}" in work index`
  );
  const indexWarning = !indexRes.ok ? 'Tags updated, but the Work index could not be updated — use "Rebuild Index".' : undefined;

  return json({ ok: true, updated, failed, ...(indexWarning ? { indexWarning } : {}) });
}

// Bulk tag edit: apply the same add/remove tag sets to an explicit list of
// selected videos in one action (the admin's Work list multi-select), as
// opposed to handleTagsPost's rename/delete which acts on every video that
// already carries a given tag.
async function handleTagsBulkPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    slugs?: string[];
    add?: string[];
    remove?: string[];
  };
  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s) => typeof s === 'string' && isValidSlug(s)) : [];
  const add = Array.isArray(body.add) ? body.add.filter((t) => typeof t === 'string' && t.trim()) : [];
  const remove = Array.isArray(body.remove) ? body.remove.filter((t) => typeof t === 'string' && t.trim()) : [];
  if (slugs.length === 0) return json({ error: 'slugs must be a non-empty array' }, 400);
  if (add.length === 0 && remove.length === 0) return json({ error: 'Provide at least one tag to add or remove' }, 400);

  const index = await readIndex(env);
  if ('error' in index) return json({ error: index.error }, 502);

  const newTagsFor = (tags: string[]) => [...new Set([...tags.filter((t) => !remove.includes(t)), ...add])];

  // Each slug's read+patch+write only ever touches that one video file, so
  // these are safe to run concurrently (in batches, to stay well under the
  // Worker's per-invocation subrequest cap) — unlike the shared index
  // below, which this does exactly once, after every file is settled.
  const BATCH_SIZE = 10;
  const updated: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((slug) =>
        patchVideoFrontmatter(
          env,
          slug,
          (data) => ({ ...data, tags: newTagsFor(Array.isArray(data.tags) ? data.tags : []) }),
          `Bulk tag update: ${slug}`
        )
      )
    );
    batch.forEach((slug, idx) => (results[idx] ? updated : failed).push(slug));
  }

  const newIndexItems = index.items.map((it) => (updated.includes(it.slug) ? { ...it, tags: newTagsFor(it.tags) } : it));
  const indexRes = await writeIndex(env, newIndexItems, index.sha, `Bulk tag update for ${updated.length} video(s)`);
  const indexWarning = !indexRes.ok ? 'Tags updated, but the Work index could not be updated — use "Rebuild Index".' : undefined;

  return json({ ok: true, updated, failed, ...(indexWarning ? { indexWarning } : {}) });
}

// The admin's text boxes are plain text: each line typed is meant as its own
// paragraph, but Markdown only starts a new paragraph after a blank line and
// would run single-spaced lines together. Turn every single line break into
// a paragraph break.
function linesToParagraphs(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().replace(/([^\n])\n(?=[^\n])/g, '$1\n\n');
}

async function handleVideosPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Record<string, any>;
  if (typeof body.title === 'string') body.title = body.title.trim();
  if (!body.slug && !body.title) return json({ error: 'A title or slug is required' }, 400);
  const slug = slugify(body.slug || body.title);
  if (!slug) return json({ error: 'Could not derive a valid slug from the title/slug given' }, 400);
  const filePath = `${VIDEOS_DIR}/${slug}.md`;

  const frontmatter = toFrontmatter({
    title: body.title,
    pageTitle: body.pageTitle || undefined,
    summary: body.summary,
    platform: body.platform === 'vimeo' ? 'vimeo' : 'youtube',
    videoId: body.videoId,
    thumbnailUrl: body.thumbnailUrl || undefined,
    customThumbnail: body.customThumbnail || undefined,
    credits: Array.isArray(body.credits)
      ? body.credits
          .filter((c: any) => c && (c.role || c.name))
          .map((c: any) => ({ role: String(c.role || ''), name: String(c.name || '') }))
      : [],
    equipment: Array.isArray(body.equipment)
      ? body.equipment
          .filter((e: any) => e && (e.category || e.item))
          .map((e: any) => ({ category: String(e.category || ''), item: String(e.item || '') }))
      : [],
    series: Array.isArray(body.series)
      ? body.series
          .filter((v: any) => v && v.videoId)
          .map((v: any) => ({
            title: String(v.title || ''),
            platform: v.platform === 'youtube' ? 'youtube' : 'vimeo',
            videoId: String(v.videoId),
            ...(typeof v.thumbnail === 'string' && v.thumbnail ? { thumbnail: v.thumbnail } : {}),
          }))
      : [],
    client: body.client || undefined,
    projectName: body.projectName || undefined,
    uploadDate: body.uploadDate || new Date().toISOString().slice(0, 10),
    durationISO: body.durationISO || undefined,
    tags: body.tags || [],
    stills: body.stills || [],
    urlSlug: slug,
    hidden: !!body.hidden,
    order: typeof body.order === 'number' ? body.order : 0,
    categoryOrder: cleanCategoryOrder(body.categoryOrder),
  });

  const fileContent = `${frontmatter}\n\n${linesToParagraphs(body.description || '')}\n`;
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
      order: typeof body.order === 'number' ? body.order : 0,
      ...(cleanCategoryOrder(body.categoryOrder) ? { categoryOrder: cleanCategoryOrder(body.categoryOrder) } : {}),
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
          order: typeof data.order === 'number' ? data.order : 0,
          ...(cleanCategoryOrder(data.categoryOrder) ? { categoryOrder: cleanCategoryOrder(data.categoryOrder) } : {}),
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
  const [settingsRes, contactRes, workRes] = await Promise.all([
    githubRequest(env, `src/data/site.json?ref=${env.GITHUB_BRANCH}`),
    githubRequest(env, `src/content/pages/contact.md?ref=${env.GITHUB_BRANCH}`),
    githubRequest(env, `src/content/pages/work.md?ref=${env.GITHUB_BRANCH}`),
  ]);

  if (!settingsRes.ok || !contactRes.ok || !workRes.ok) {
    const failed = !settingsRes.ok ? settingsRes : !contactRes.ok ? contactRes : workRes;
    const detail = await failed.text().catch(() => '');
    return json(
      {
        settings: null,
        contact: null,
        work: null,
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
  const workData = (await workRes.json()) as { content: string };
  const workParsed = parseFrontmatter(decodeURIComponent(escape(atob(workData.content.replace(/\n/g, '')))));

  return json({
    settings: JSON.parse(settingsContent),
    contact: { title: contactParsed.data.title ?? '', summary: contactParsed.data.summary ?? '', body: contactParsed.body },
    work: { title: workParsed.data.title ?? '', body: workParsed.body },
  });
}

async function handleSettingsPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    settings?: Record<string, any>;
    contact?: { title?: string; summary?: string; body?: string };
    work?: { title?: string; body?: string };
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
    const fileContent = `${frontmatter}\n\n${linesToParagraphs(body.contact.body || '')}\n`;
    const existing = await getFile(env, 'src/content/pages/contact.md');
    const res = await putFile(env, 'src/content/pages/contact.md', fileContent, existing?.sha, 'Update contact page');
    if (!res.ok) return json({ error: 'Failed to update contact page' }, 502);
  }

  if (body.work) {
    const frontmatter = toFrontmatter({ title: body.work.title || 'Work' });
    const fileContent = `${frontmatter}\n\n${linesToParagraphs(body.work.body || '')}\n`;
    const existing = await getFile(env, 'src/content/pages/work.md');
    const res = await putFile(env, 'src/content/pages/work.md', fileContent, existing?.sha, 'Update work page');
    if (!res.ok) return json({ error: 'Failed to update work page' }, 502);
  }

  return json({ ok: true });
}

// Reads and JSON-parses a small admin-managed data file (seo.json,
// ...), distinguishing "doesn't exist yet" (a legitimate blank
// starting state — same convention as readIndex for work-index.json) from
// a real failure (bad credentials, wrong repo, invalid JSON), which must
// surface as an error rather than silently looking like "nothing saved".
async function readJsonFile<T>(env: Env, path: string, fallback: T): Promise<{ value: T } | { error: string }> {
  const res = await githubRequest(env, `${path}?ref=${env.GITHUB_BRANCH}`);
  if (res.status === 404) return { value: fallback };
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `GitHub API returned ${res.status} reading ${path}${detail ? `: ${detail}` : ''}` };
  }
  const data = (await res.json()) as { content: string };
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  try {
    return { value: JSON.parse(content) as T };
  } catch {
    return { error: `${path} contains invalid JSON.` };
  }
}

const SEO_PATH = 'src/data/seo.json';

async function handleSeoGet(_request: Request, env: Env): Promise<Response> {
  const result = await readJsonFile(env, SEO_PATH, {});
  if ('error' in result) return json({ error: result.error }, 502);
  return json({ seo: result.value });
}

async function handleSeoPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    seo?: Record<string, { title: string; description: string; ogImage: string }>;
  };
  if (!body.seo) return json({ error: 'Expects { seo }' }, 400);

  const existing = await getFile(env, SEO_PATH);
  const res = await putFile(env, SEO_PATH, JSON.stringify(body.seo, null, 2) + '\n', existing?.sha, 'Update page SEO metadata');
  if (!res.ok) return json({ error: 'Failed to update SEO metadata' }, 502);

  return json({ ok: true });
}

// Uploaded Work thumbnails. The admin resizes and converts each image to
// WebP in the browser first, so only small WebP files are accepted here.
// Every upload gets a new, timestamped name, so a replaced thumbnail never
// lingers in anyone's browser cache.
const THUMBNAILS_DIR = 'public/images/thumbnails';
const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;

async function handleThumbnailPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { name?: string; data?: string };
  if (typeof body.data !== 'string' || !body.data) return json({ error: 'Expects { name, data } (base64 WebP)' }, 400);

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: 'Image data is not valid base64' }, 400);
  }
  if (bytes.length > MAX_THUMBNAIL_BYTES) return json({ error: 'Image is too large (3 MB max after resizing)' }, 413);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return json({ error: 'Only WebP images are accepted' }, 400);

  const base = slugify(body.name || '') || 'thumbnail';
  const fileName = `${base}-${Date.now()}.webp`;
  const res = await githubRequest(env, `${THUMBNAILS_DIR}/${fileName}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `Upload thumbnail ${fileName}`, content: body.data, branch: env.GITHUB_BRANCH }),
  });
  if (!res.ok) return json({ error: `GitHub API returned ${res.status} saving the thumbnail` }, 502);

  return json({ ok: true, path: `/images/thumbnails/${fileName}` });
}

async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env);
  if (pathname === '/api/logout' && request.method === 'POST') return handleLogout();

  const isLoginPage = pathname === '/admin/login' || pathname === '/admin/login/';
  const isAdminPage = !isLoginPage && (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/'));
  const isProtectedApi =
    pathname === '/api/videos' ||
    pathname === '/api/videos/reindex' ||
    pathname === '/api/videos/reorder' ||
    pathname === '/api/settings' ||
    pathname === '/api/tags' ||
    pathname === '/api/tags/bulk' ||
    pathname === '/api/seo' ||
    pathname === '/api/thumbnail';

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

  if (pathname === '/api/videos/reorder' && request.method === 'POST') {
    return handleVideosReorder(request, env);
  }

  if (pathname === '/api/settings') {
    if (request.method === 'GET') return handleSettingsGet(request, env);
    if (request.method === 'POST') return handleSettingsPost(request, env);
  }

  if (pathname === '/api/tags' && request.method === 'POST') {
    return handleTagsPost(request, env);
  }

  if (pathname === '/api/tags/bulk' && request.method === 'POST') {
    return handleTagsBulkPost(request, env);
  }

  if (pathname === '/api/thumbnail' && request.method === 'POST') {
    return handleThumbnailPost(request, env);
  }

  if (pathname === '/api/seo') {
    if (request.method === 'GET') return handleSeoGet(request, env);
    if (request.method === 'POST') return handleSeoPost(request, env);
  }

  // The admin pages are never kept in the browser's cache, so a deploy's
  // new admin features show up on the next visit instead of an old copy.
  if (isAdminPage || isLoginPage) {
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  // Everything else — every static page and image — is served straight
  // from the build.
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

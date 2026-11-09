# Notes for Claude

## Deploying changes

Cloudflare builds and deploys the live site from `main` on every push.
The site owner wants code changes to go live without a manual pull request:

- After making and verifying a change (`npm run build` passes), commit it
  and push it straight to `main`. Don't open a pull request unless asked.
- The admin panel (`/admin`) also commits content edits directly to `main`,
  so always `git fetch origin main` and merge it in before pushing; never
  force-push `main`.
- If a session is assigned a working branch, push there too to keep it
  in sync, but `main` is what ships.

## How we work (set by the site owner)

- **No shortcuts.** If a shortcut ever seems worth taking, present it to the
  owner first, with the possible risk, and let them decide.
- **"Live" means verified live.** A push, a passing local build, or a green
  check on GitHub is not proof. Before telling the owner a change is live,
  load the live site (https://dannydwyer.com) and confirm the change is
  actually there.
  Builds can be skipped or queued (as in the Cloudflare build-delay incident
  of Oct 2026), and a check run may be for a preview branch, not production.
- **Say what you can't see.** If something can't be verified from here (the
  Cloudflare dashboard, the owner's browser), say so plainly instead of
  sounding certain.

## Domain

- https://dannydwyer.com is the live site: a Cloudflare custom domain on this
  Worker since Nov 2026. The old Squarespace site is gone.
  www.dannydwyer.com redirects to dannydwyer.com (plain, no www, is the
  canonical address; `SITE_URL` in `astro.config.mjs`).
- https://dannydwyer.rough-water-4697.workers.dev serves the same deploy
  (pushing `main` updates both at once; it is not a separate preview stage).
  The Worker marks everything there noindex (see `noindexTestSite`).
- Old Squarespace URLs that are still in Google forward via `REDIRECTS` in
  `worker/index.ts`.
- Vimeo videos set to "Specific domains" must allow `dannydwyer.com`, or the
  embed shows "Sorry, because of its privacy settings…" / "Hey There!".

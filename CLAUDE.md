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
  load the live site (https://dannydwyer.rough-water-4697.workers.dev, later
  https://www.dannydwyer.com) and confirm the change is actually there.
  Builds can be skipped or queued (as in the Cloudflare build-delay incident
  of Oct 2026), and a check run may be for a preview branch, not production.
- **Say what you can't see.** If something can't be verified from here (the
  Cloudflare dashboard, the owner's browser), say so plainly instead of
  sounding certain.

## Before switching to dannydwyer.com (remind the site owner)

When the owner is ready to move the domain off Squarespace, walk through this first:

1. **Vimeo embed domains**: every Vimeo video set to "Specific domains" must allow
   `dannydwyer.com` (and `dannydwyer.rough-water-4697.workers.dev` until the move is
   done), or it shows "Sorry, because of its privacy settings…" / "Hey There!".
   Known: the Lady Gaga series and the Jelly Roll series. Check the rest too.
2. **Email DNS**: screenshot the domain's MX/TXT records at Squarespace before
   changing nameservers (contact@dannydwyer.com must keep working).
3. `SITE_URL` in `astro.config.mjs` is already `https://www.dannydwyer.com`
   (www is the canonical address), and the Worker marks everything on the
   workers.dev test address noindex. After the domain is attached in
   Cloudflare: add dannydwyer.com → www and dwyski.com → www redirects, map
   obvious old Squarespace paths (/about, /contact, ...) to the new pages (the
   owner wants nothing else kept; other old URLs may 404), then re-run full QA.
4. Only then cancel the Squarespace website plan (not the domain).

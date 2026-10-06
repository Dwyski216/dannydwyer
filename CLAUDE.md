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

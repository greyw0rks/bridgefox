# Hosted studio

Public app: https://bridgefox.vercel.app. The Next.js studio runs on Vercel; Convex stores temporary project records, source JSON, uploads, and exports. No uploaded extension code runs on either service.

Use `npm ci`, then `npx convex dev --once` to configure a Convex project and generate its API bindings. Set a long random `BRIDGEFOX_STORAGE_SECRET` in the Convex dashboard and keep the matching value in the Next.js server environment. Deploy the Convex functions with `npx convex deploy` when using a production deployment.

Configure these server variables in Vercel:

- `CONVEX_URL`: the selected Convex deployment's cloud URL.
- `BRIDGEFOX_STORAGE_SECRET`: the same private value configured in Convex.
- `BRIDGEFOX_PUBLIC_ORIGIN`: the exact canonical HTTPS app origin.
- `BRIDGEFOX_PUBLIC_DEMO=1`: allow import, local migration, review, and export without a password.
- `BRIDGEFOX_ACCESS_TOKEN`: a long random password, still required for Otari execution. Enter it in Workspace settings.
- The Otari model, API, and budget settings described in `.env.example` and `OTARI.md`. Attach a gateway spend ceiling to the key separately.

Deploy with `vercel deploy --prod`. `.vercelignore` excludes private environment files, local artifacts, and the demo-video project from uploads. Keep access passwords, API keys, and voice references out of Git and submission copy.

Browser ZIP uploads go directly to Convex storage. API import receives a storage reference rather than the ZIP body, so archives above Vercel's request limit can still be imported. Exports also download from Convex storage. Four projects and 512 MiB of expanded source are retained across this workspace; projects expire after 30 minutes of inactivity or eviction. Abandoned uploads and exports are cleaned automatically.

Run `BRIDGEFOX_TEST_URL=https://your-app.example node --import tsx scripts/check-hosted.ts` to check direct upload, shared project recall, local migration, exact source preservation, export, and rejected anonymous Otari/foreign-origin requests. It makes no paid Otari calls. `scripts/check-ui.ts` checks the actual browser workflow and responsive layouts.

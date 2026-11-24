# Sparrow access control (SPAR-55)

Date: 2026-11-24. Status: draft, awaiting approval.
Parent: `crow/docs/superpowers/specs/2026-11-23-access-control-design.md` (Project 4). Crow is the pattern.

## Intent

Andrew lets a few known people use sparrow. They run their own projects, share projects with each other, and see the feedback they sent from crow. Andrew is the only admin and sees everything.

## Goals

- Sparrow sits behind Caddy `forward_auth` to Authentik, like crow.
- Projects have an owner and members. Users see only projects they belong to.
- Crow feedback keeps working, and a reporter sees their own feedback tasks.
- Storage limit per user for attachments.
- The CLI (`pnpm ship`, agents) keeps working with a per-user token.

## Non-goals

- Public sign-up, multiple admins, billing.
- Per-project columns. Columns stay global, like today.
- Fine-grained member roles beyond owner and member.

## Anti-goals

- Any task, title, attachment, link, or live update of a project leaking to a non-member.
- A user forging identity headers or a comment author.
- Sparrow locking everyone out on deploy.

## Approaches

- **A. Filter the in-memory index per request (chosen, Claude's call).** Sparrow keeps one global index in memory. Each read and each SSE event is filtered by the caller's identity. Each write checks membership.
- **B. Query the DB per user.** More code, slower, no gain at this data size. Rejected.
- **C. One DB per user or project.** Breaks sharing and cross-project links; big migration. Rejected.

## Identity (Andrew agreed)

- Caddy (hawk `AUTH=authentik`) sends `X-Authentik-Username`, `X-Authentik-Groups` (split on `|`), and `X-Sparrow-Proxy-Secret`.
- Sparrow trusts the headers only with a matching `SPARROW_PROXY_SECRET` (timing-safe compare). Copy `crow/src/lib/auth.ts`.
- Role: `admin` if group `sparrow-admin`. `user` if `sparrow-user`. Neither: 403.
- Username must match `^[a-z0-9-]+$`, else 403.
- Production without the secret (or `change-me`): every request fails 401 "server misconfigured". Dev without the secret: user `SPARROW_DEV_USER` (default `dev`), admin.
- `/api/version` stays open.
- Service callers come to `127.0.0.1:3417` with `Authorization: Bearer <token>` and no proxy secret. One token per caller (Andrew agreed):
  - `SPARROW_SERVICE_TOKEN` is identity `crow`. It may only create tasks in `CROW`, set `reporter`, and upload attachments to `CROW` tasks.
  - `SPARROW_HAWK_TOKEN` is identity `hawk`. It may only `addComment` and `setStatus` on any task (deploy linking in `hawk/platform/src/tasks.ts`, which sends no auth today). Hawk must send it from its env. This hawk change ships before sparrow's auth.
  - Anything else from a service: 403.
- A request with both a proxy secret and a bearer header is a user request (the bearer belongs to Authentik).

## Users table (Andrew agreed)

- `users (username PRIMARY KEY, first_seen, last_seen, quota_bytes NULL)`.
- Upsert on each user request (throttle `last_seen` writes, builder's call).
- The add-member picker lists these users. A person must sign in once before they can be added.

## Projects and members (Andrew agreed)

- `projects.owner TEXT`. New table `members (project, username, PRIMARY KEY (project, username))`.
- Migration: existing projects get owner `andrew`.
- The creator of a project is its owner. Any user can create projects. Keys stay global (a taken key says "already exists"; accepted).
- Owner (and admin): rename, recolor, delete project, add and remove members. Members: everything with tasks in the project.
- The owner cannot be removed as a member. Changing owner: admin only (Claude's call).
- UI: project page gets a members section (owner and admin can edit). CLI: `sparrow project members <KEY>`, `... add <KEY> <user>`, `... remove <KEY> <user>` (exact shape builder's call).

## What a user sees (Andrew agreed)

- Visible tasks: tasks in projects where the user is owner or member, plus `CROW` tasks where `extra.reporter` is the user.
- A reporter can read, comment on, and edit the description of their `CROW` tasks. They cannot move, delete, change status, or upload to them.
- A reporter sees the task only while it is in `CROW` (Andrew's call). Moved to a project they are not a member of: it disappears for them (SSE `remove`). A crow retry on that task id then gets 404, which crow already shows as an error.
- Admin sees all.
- Filter every read path: `GET /api/tasks`, the SSE snapshot, each SSE `upsert` and `remove`, `GET /api/tasks/[id]`, attachment downloads, history, `projects` in the index.
- Hidden tasks: links, backlinks, children, `moved` entries, and mention backlinks to tasks the user cannot see are dropped from the view. `[[KEY-1]]` in text stays as plain text.
- SSE: a task that stops being visible (moved out, member removed) sends `remove` to that user. A project membership change sends that user a fresh snapshot.
- ETag and SSE `rev` must differ per user (for example `rev + ':' + username`) so a 304 never serves another user's view.
- Hidden task or project: 404, same as "does not exist".

## Writes

- Every op, create, delete, and attachment call checks that the user may write the task's project.
- `setProject`: the user must be able to write both projects.
- `addLink`, `setParent`: the target task must be visible to the user.
- Title and description (`setTitle`, `setBody`): anyone who can see the task (Andrew's call). The existing `baseHash` check still stops lost updates.
- Comments are fixed once posted. `editComment`: only the comment's author, or admin (Andrew's call).
- Comment author: always the identity's username (services: `crow`, `hawk`). The server overrides any author the client sends. Drop `Tailscale-User-Login` and `config.user` as author sources.

## Storage (Andrew agreed)

- `attachments.uploader TEXT`. Migration: existing rows get `andrew`.
- Usage: sum of `size` of the uploader's live attachments.
- Default limit 500 MB. Per-user override in `users.quota_bytes`, set by admin (CLI `sparrow user quota <user> <MB>`, builder's call on shape).
- Check `Content-Length` first, then the real size, before saving. Over limit: 413 with "storage limit reached (used/limit)".
- Service uploads count to the reporter if set, else to `crow`. Admin is not exempt but can raise their own limit.

## Reporter (Andrew agreed)

- `POST /api/tasks` accepts `reporter` only from the service caller. Stored in `extra.reporter`.
- Task page and `sparrow show` show `reporter` when set.
- Attachment mime list accepts `video/mp4`, `video/webm`, `video/quicktime` (check `src/core/mime.ts`).
- Project `CROW` exists, owner `andrew`.

## CLI token (Andrew agreed)

- First build step: spike. Make an Authentik app password or token for Andrew. Check that `curl -H "Authorization: Bearer <token>"` (or Basic) to `https://sparrow.andrewminghanjiang.com/api/tasks` passes Caddy and that sparrow sees `X-Authentik-Username`. Crow's plan had the same spike; check its result first.
- If it passes: the CLI sends `SPARROW_TOKEN` in that header.
- If not: sparrow keeps its own tokens. Table `tokens (hash, username, created, last_used)`, sha256 hash only. `sparrow token create` (from a signed-in browser or admin) and `sparrow token revoke`. Caddy then lets a request with a sparrow token past `forward_auth` (hawk change needed). Tell Andrew before building this branch.
- The CLI prints "not signed in. Set SPARROW_TOKEN" on 401 or 403.
- `sparrow upgrade` and the `/cli/sparrow.js` download send the token too.
- The dev server's prod forwarding (`src/proxy.ts`, `scripts/dev.sh`) adds the token.
- Update `src/core/agents-md.ts` text about comment signing.

## Deploy order

0. Hawk: `linkTasks` sends `Authorization: Bearer $SPARROW_HAWK_TOKEN`. Put `SPARROW_HAWK_TOKEN` in `/etc/hawk/hawk.env`. Ship this first (sparrow ignores it until it checks).
1. Ship sparrow with auth code. In production with no secret set yet it would fail closed, so ship the code and set `SPARROW_PROXY_SECRET`, `SPARROW_SERVICE_TOKEN`, and `SPARROW_HAWK_TOKEN` (same value as hawk's) in `/etc/sparrow/sparrow.env` in the same deploy. `deploy/sparrow.service` gets `EnvironmentFile=/etc/sparrow/sparrow.env`.
2. Authentik: application for sparrow (proxy provider, forward auth single application, external host `https://sparrow.andrewminghanjiang.com`), bind `sparrow-admin` and `sparrow-user`, add to the embedded outpost.
3. Add `SPARROW_PROXY_SECRET` to `/etc/caddy/caddy.env`. Merge hawk `AUTH=authentik` in `hawk/apps/sparrow.env`.
4. Set `SPARROW_TOKEN` on Andrew's machines. Run `sparrow ls` and `pnpm ship` dry check.

Never do step 3 before step 2. Between step 1 and step 3, Caddy does not send the secret, so sparrow is locked. Builder decides how to shorten that gap (for example do 1 to 3 in one sitting, or ship step 1 with a temporary allow flag).

## Left to the builder

- Exact Authentik setup, Caddy snippet (hawk already has it from HAWK-16).
- UI layout for members and the quota display.
- Proxy matcher paths. Everything except `/api/version` and static Next assets must pass the identity check.
- How the filter is structured in code (one `visibleIndex(index, identity)` plus a per-task check is the expected shape).
- Error texts.

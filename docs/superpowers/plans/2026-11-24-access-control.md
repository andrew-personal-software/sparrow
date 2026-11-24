# Sparrow Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put sparrow behind Authentik. Users see and change only projects they own or belong to, plus their own crow feedback.

**Architecture:** Caddy `forward_auth` sends `X-Authentik-*` headers and `X-Sparrow-Proxy-Secret`. `src/server/auth.ts` turns headers into an `Identity`. `src/core/access.ts` holds pure rules: it filters the one in-memory `Index` per identity and checks each write. Every route calls both.

**Tech Stack:** Next.js 16 route handlers and `src/proxy.ts`, `node:sqlite`, vitest, tsup CLI.

**Spec:** `docs/superpowers/specs/2026-11-24-access-control-design.md`

## Global Constraints

- Headers: `X-Authentik-Username`, `X-Authentik-Groups` (split on `|`), `X-Sparrow-Proxy-Secret`. Groups `sparrow-admin`, `sparrow-user`.
- Env: `SPARROW_PROXY_SECRET`, `SPARROW_SERVICE_TOKEN` (identity `crow`), `SPARROW_HAWK_TOKEN` (identity `hawk`), `SPARROW_DEV_USER` (default `dev`), CLI `SPARROW_TOKEN`.
- Production without `SPARROW_PROXY_SECRET`, or with `change-me`: 401 "server misconfigured: set SPARROW_PROXY_SECRET".
- Username `^[a-z0-9-]+$`, else 403.
- `/api/version` stays open.
- Existing projects and attachments belong to `andrew`.
- Default quota 500 MB (`500 * 1024 * 1024`).
- Hidden task or project: 404, same text as "not found".
- Commits: conventional, scope optional. Code comments minimal.

## Review Focus

- A task moved from a shared project to a private one must vanish from other users' live view (SSE `remove`). Test in Task 5.
- One user's `ETag`/`rev` must never give another user a 304 or `unchanged`. Test in Task 5.
- A hidden task that mentions or links a visible task must not show as a backlink. Test in Task 4.
- A request with the proxy secret and a `Bearer` header is a user, never a service. Test in Task 3.
- An old CLI with no token, after cutover, gets Authentik's 302 to a login page. It must print "not signed in. Set SPARROW_TOKEN", not a JSON parse error. Test in Task 10.

---

### Task 1: Token spike (manual, no code)

- [ ] **Step 1:** Check crow first: `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CROW_TOKEN" https://crow.andrewminghanjiang.com/api/canvas`. Expected: `200`.
- [ ] **Step 2:** If not `200`, try Basic: `curl -s -o /dev/null -w '%{http_code}\n' -u "andrew:$CROW_TOKEN" .../api/canvas`. Note which form works.
- [ ] **Step 3:** If neither works, stop and tell Andrew. Task 10 then needs the sparrow-owned token fallback from the spec, which needs a new plan task.
- [ ] **Step 4:** Write the result (header form) as a comment on SPAR-55: `sparrow comment SPAR-55 --body "token spike: <form> works"`.

### Task 2: Hawk sends its token (hawk repo)

**Files:**
- Modify: `../hawk/platform/src/tasks.ts` (`linkTasks` `send`)
- Test: the existing test next to it

- [ ] **Step 1:** Failing test: with `process.env.SPARROW_HAWK_TOKEN = 't'`, the request `linkTasks` sends has header `authorization: Bearer t`. With it unset, no `authorization` header.
- [ ] **Step 2:** Run hawk's tests. Expected: FAIL.
- [ ] **Step 3:** Add the header in `send`.
- [ ] **Step 4:** Run hawk's tests. Expected: PASS.
- [ ] **Step 5:** Add `SPARROW_HAWK_TOKEN=` to hawk's env example. Commit `fix: send SPARROW_HAWK_TOKEN on sparrow task calls`. Ship with hawk's flow. Andrew puts the value in `/etc/hawk/sparrow-hawk-token` (see hawk's README).

### Task 3: Schema, errors, identity

**Files:**
- Modify: `src/core/db.ts` (append one migration), `src/core/errors.ts`, `src/server/state.ts` (`STATUS`), `src/core/types.ts`, `src/core/projects.ts`, `src/proxy.ts`
- Create: `src/core/users.ts`, `src/server/auth.ts`, `src/server/auth.test.ts`
- Test: `src/core/users.test.ts`

**Interfaces:**
- Produces:
  - `ErrorCode` adds `'unauthorized' | 'forbidden' | 'too_large'`. HTTP 401, 403, 413. `EXIT` 7, 8, 9.
  - `Project = { key; name; color; owner: string; members: string[] }` (`members` excludes the owner).
  - `Identity = { kind: 'user'; username: string; admin: boolean } | { kind: 'service'; name: 'crow' | 'hawk' }` exported from `src/core/types.ts`.
  - `identityFrom(h: Headers): Identity` in `src/server/auth.ts`. Throws `KbError('unauthorized' | 'forbidden', ...)`.
  - `requireIdentity(req: Request): Identity` calls `identityFrom`, and for users calls `touchUser`.
  - `touchUser(db, username, now = new Date()): void`, `listUsers(db): string[]` in `src/core/users.ts`.
  - `createProject(db, input, owner: string)`.

- [ ] **Step 1: Migration.** One function migration: `CREATE TABLE users (username TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, quota_bytes INTEGER)`; `CREATE TABLE members (project TEXT NOT NULL, username TEXT NOT NULL, PRIMARY KEY (project, username))`; `ALTER TABLE projects ADD COLUMN owner TEXT NOT NULL DEFAULT 'andrew'`; `ALTER TABLE attachments ADD COLUMN uploader TEXT NOT NULL DEFAULT 'andrew'`; `INSERT OR IGNORE INTO projects (key, name, color, next_number, owner) VALUES ('CROW', 'Crow feedback', <a palette color>, 1, 'andrew')`.
- [ ] **Step 2: Failing tests** in `src/server/auth.test.ts`, with `SPARROW_PROXY_SECRET=s` and `NODE_ENV=production`:
  - no secret header → `unauthorized`
  - secret ok, username `bob`, groups `sparrow-user` → `{ kind: 'user', username: 'bob', admin: false }`
  - groups `a|sparrow-admin` → `admin: true`
  - groups `crow-user` only → `forbidden`
  - username `../x` → `forbidden`
  - no secret header, `authorization: Bearer <SPARROW_SERVICE_TOKEN>` → `{ kind: 'service', name: 'crow' }`; same with `SPARROW_HAWK_TOKEN` → `hawk`
  - secret ok + `authorization: Bearer <SPARROW_SERVICE_TOKEN>` + username `bob` → user `bob`
  - wrong bearer → `unauthorized`
  - `SPARROW_PROXY_SECRET` unset in production → `unauthorized`, message contains `server misconfigured`; unset in development → user `dev`, admin
- [ ] **Step 3:** `src/core/users.test.ts`: `touchUser` twice keeps `first_seen`, updates `last_seen`; `listUsers` is sorted.
- [ ] **Step 4:** `pnpm test`. Expected: FAIL.
- [ ] **Step 5:** Implement. Copy the shape of `crow/src/lib/auth.ts` (timing-safe compare). Empty service tokens never match. `loadProjects` reads `owner` and `members`. In `src/proxy.ts`, call `identityFrom` for every path except `/api/version`, `/_next/static/*`, `/_next/image`, icons, `manifest.webmanifest`, `sw.js`; on `KbError` answer `{ error: { code, message } }` with its status. Keep the version check and dev forwarding. Widen `config.matcher` to match.
- [ ] **Step 6:** `pnpm test && pnpm typecheck`. Expected: PASS (fix existing tests that call `createProject` or build `Project`).
- [ ] **Step 7:** Commit `feat: read user identity from Authentik headers`.

### Task 4: Access rules

**Files:**
- Create: `src/core/access.ts`, `src/core/access.test.ts`
- Modify: `src/core/indexer.ts` (`Index` gets `me?: { username: string; admin: boolean }`), `src/core/index.ts` (export)

**Interfaces:**
- Consumes: `Identity`, `Project.owner/members` (Task 3).
- Produces (all pure, `index` is the full index):
  - `canSee(index: Index, id: Identity, task: Task): boolean`. Admin: all. User: member or owner of `task.project`, or `task.project === 'CROW' && task.extra.reporter === username`. `crow`: `CROW` tasks. `hawk`: all.
  - `canWrite(index, id, task): boolean`. Admin: all. User: member or owner. Services: false.
  - `canManageProject(index, id, key: string): boolean`. Admin or owner.
  - `checkOp(index, id, task: Task, op: Op): void`. Throws `forbidden`. Rules:
    - `setTitle`, `setBody`: `canSee`.
    - `addComment`: `canSee`.
    - `editComment`: the comment at `op.index` has `author === username`, or admin.
    - `hawk`: only `addComment` and `setStatus`.
    - `setProject`: `canWrite` on both projects.
    - `addLink`, `setParent`: the target must pass `canSee`.
    - everything else: `canWrite`.
  - `checkCreate(index, id, input: CreateInput & { reporter?: string }): void`. User: `canWrite` on the project (and the parent if given). `crow`: project must be `CROW`. `hawk`: forbidden. `reporter` from a user: forbidden.
  - `visibleIndex(index: Index, id: Identity & { kind: 'user' }): Index`. Keeps tasks passing `canSee`. Keeps projects the user owns or belongs to, plus a project entry for any visible task's project. From each kept task, drops `links`, `backlinks`, `children` entries and `parent` pointing at hidden tasks. Drops `moved` entries whose target is hidden. Keeps `blocked` and `progress` as computed (they name no hidden task; Claude's call). Sets `me`.

- [ ] **Step 1: Failing tests** in `src/core/access.test.ts`. Build an index with `buildIndex` on a temp DB. Projects `A` (owner `ann`, member `bob`), `B` (owner `cat`), `CROW`. Tasks `A-1`, `B-1` (body mentions `[[A-1]]`, links `blocks A-1`), `CROW-1` (`extra.reporter: 'bob'`).
  - `visibleIndex(bob)` task ids are `['A-1', 'CROW-1']` (sorted); `A-1.backlinks` is `[]`; `projects` keys include `A` and `CROW`, not `B`.
  - `visibleIndex(admin)` has all 3 tasks.
  - `checkOp(bob, CROW-1, setBody)` passes; `setStatus` throws `forbidden`.
  - `checkOp(bob, A-1, editComment)` on a comment by `ann` throws; on a comment by `bob` passes; admin passes.
  - `checkOp(bob, A-1, setProject B)` throws.
  - `checkOp(bob, A-1, addLink to B-1)` throws.
  - `checkOp(hawk, B-1, addComment)` passes; `setBody` throws.
  - `checkCreate(crow, { project: 'A' })` throws; `{ project: 'CROW', reporter: 'bob' }` passes; `checkCreate(bob, { reporter: 'x' })` throws.
- [ ] **Step 2:** `pnpm test src/core/access.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test src/core/access.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: add access rules`.

### Task 5: Filter every read

**Files:**
- Modify: `src/app/api/tasks/route.ts` (GET), `src/app/api/events/route.ts`, `src/app/api/tasks/[id]/route.ts` (GET), `src/app/api/tasks/[id]/attachments/[attId]/route.ts` (GET)
- Test: `src/app/api/routes.test.ts`

**Interfaces:**
- Consumes: `requireIdentity` (Task 3), `visibleIndex`, `canSee` (Task 4).
- Produces: `userRev(rev: string, username: string): string` (`${rev}:${username}`) in `src/server/state.ts`.

- [ ] **Step 1: Failing tests.** Helper `as(user, groups)` builds headers with the proxy secret.
  - `GET /api/tasks` as `bob` lists only visible tasks.
  - `GET /api/tasks` as `bob` with `if-none-match` set to `ann`'s ETag → 200, not 304.
  - `GET /api/tasks/B-1` as `bob` → 404 with the same message as a missing key.
  - attachment GET on `B-1` as `bob` → 404.
  - SSE as `bob`: read the first event (snapshot has only visible tasks). Then `applyOp(B-1 → setBody)` + `refresh` sends nothing to `bob`. Then move `A-1` to `B` + `refresh` sends `{ type: 'remove', id: 'A-1' }` to `bob`.
- [ ] **Step 2:** `pnpm test src/app/api/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. SSE keeps a per-connection `Set` of task ids it sent. On `upsert`: if `canSee`, send the filtered task (`visibleIndex` of a one-task view is fine) and add it to the set. If not, but the id is in the set, send `remove` and delete it. `snapshot`: send `visibleIndex`. `rev` and `unchanged`: use `userRev`. Services get 403 on these reads, except `hawk` and `crow` on `GET /api/tasks/[id]`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: show each user only their projects`.

### Task 6: Check every write

**Files:**
- Modify: `src/app/api/tasks/route.ts` (POST), `src/app/api/tasks/[id]/route.ts` (POST, DELETE), `src/app/api/tasks/[id]/attachments/route.ts`, `src/app/api/tasks/[id]/attachments/[attId]/route.ts` (DELETE), `src/app/api/projects/route.ts`, `src/app/api/projects/[key]/route.ts`, `src/core/ops.ts` (`createTask` stores `reporter` in `extra.reporter`)
- Test: `src/app/api/routes.test.ts`

- [ ] **Step 1: Failing tests.**
  - `bob` `setStatus` on `B-1` → 404 (hidden), on `CROW-1` → 403.
  - `bob` `addComment` with `author: 'ann'` → stored author is `bob`. `hawk` comment → author `hawk`. `crow` → `crow`.
  - `crow` `POST /api/tasks` `{ project: 'CROW', reporter: 'bob' }` → `extra.reporter === 'bob'`. `bob` posting `reporter` → 403.
  - `bob` `POST /api/projects { key: 'NEW' }` → owner `bob`. `bob` `PATCH /api/projects/A` → 403 (owner is `ann`).
  - No proxy secret and no bearer → 401 on POST.
- [ ] **Step 2:** `pnpm test src/app/api/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Order in each route: `requireIdentity`, load the task (`viewTask` on the full index), `canSee` else `not_found`, `checkOp`/`checkCreate`, then write. Always set `op.author` from the identity. Remove the `Tailscale-User-Login` and `config.user` fallbacks. There is no delete-project route today, so there is nothing to gate there.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: check access on every write`.

### Task 7: Members and users (API, CLI, UI)

**Files:**
- Create: `src/core/members.ts`, `src/app/api/users/route.ts`, `src/app/api/projects/[key]/members/route.ts`
- Modify: `src/app/api/projects/[key]/route.ts` (PATCH accepts `owner`, admin only), `src/cli/commands.ts` (`project`), `src/cli/index.ts` (print), `src/components/project/ProjectPage.tsx`, `src/components/detail/TaskDetail.tsx` (comment author from `index.me`)
- Test: `src/core/members.test.ts`, `src/app/api/routes.test.ts`

**Interfaces:**
- Produces:
  - `addMember(db, key, username): void` (throws `invalid` if the user is not in `users`), `removeMember(db, key, username): void` (throws `invalid` for the owner), `setOwner(db, key, username): void` (the old owner becomes a member).
  - `GET /api/users` → `string[]` (any signed-in user). `POST /api/projects/[key]/members { username }`, `DELETE /api/projects/[key]/members { username }`. Both need `canManageProject`.
  - CLI: `sparrow project members <KEY>`, `sparrow project add-member <KEY> <user>`, `sparrow project remove-member <KEY> <user>`.

- [ ] **Step 1: Failing tests.** `addMember` of an unknown user throws; `removeMember` of the owner throws; `setOwner` keeps the old owner as a member. Route: `bob` (member, not owner) adds `cat` to `A` → 403; `ann` adds `bob` to `A` → 200; admin adds `bob` to `B` → `bob`'s `GET /api/tasks` now has `B-1`.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement core and routes. CLI subcommands. UI: a members list on the project page; owner and admin see add (picker from `GET /api/users`) and remove buttons. The comment box uses `index.me.username` for the optimistic author.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS. Manual: `pnpm dev`, set `SPARROW_DEV_USER`, add a member from the project page.
- [ ] **Step 5:** Commit `feat: share projects with members`.

### Task 8: Storage limit and video types

**Files:**
- Modify: `src/core/users.ts`, `src/core/attachments.ts` (`addAttachment` takes `uploader`), `src/core/mime.ts`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/app/api/users/route.ts` (add `src/app/api/users/[name]/route.ts` PATCH), `src/cli/commands.ts`
- Test: `src/core/users.test.ts`, `src/app/api/routes.test.ts`

**Interfaces:**
- Produces: `DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024`, `usageOf(db, username): number` (live attachments only), `quotaOf(db, username): number`, `setQuota(db, username, bytes: number | null)`, `assertRoom(db, username, bytes): void` throws `too_large` "storage limit reached (<used> MB of <limit> MB)". `PATCH /api/users/[name] { quotaMb: number | null }` admin only. CLI `sparrow user quota <user> <MB|default>`.

- [ ] **Step 1: Failing tests.** With `setQuota(bob, 1 MB)`: a 2 MB upload by `bob` → 413, nothing saved. Removing an attachment frees usage. `crow` upload on `CROW-1` (reporter `bob`) counts to `bob`; with no reporter it counts to `crow`. `mimeFor('a.mp4')` is `video/mp4`; `.webm` → `video/webm`; `.mov` → `video/quicktime`.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Check `Content-Length` with `assertRoom` before reading the body, then again with the real size.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: limit attachment storage per user`.

### Task 9: Show the reporter

**Files:**
- Modify: `src/components/detail/TaskDetail.tsx`, `src/cli/index.ts` (`show` output)

- [ ] **Step 1:** Task page shows "Reported by <name>" near the title when `task.extra.reporter` is set. `sparrow show` human output prints `reporter: <name>`. JSON output already includes `extra`.
- [ ] **Step 2:** `pnpm typecheck`. Manual check in `pnpm dev` with a task that has `extra.reporter`.
- [ ] **Step 3:** Commit `feat: show the feedback reporter`.

### Task 10: CLI token

**Files:**
- Modify: `src/cli/http.ts`, `src/proxy.ts` (dev forwarding), `src/core/agents-md.ts`, `README.md` (one line on `SPARROW_TOKEN`)
- Test: `src/cli/http.test.ts`

**Interfaces:**
- Consumes: the header form from Task 1.
- Produces: every CLI request (`request` and the `raw` path in `call`) sends the token when `SPARROW_TOKEN` is set. Requests use `redirect: 'manual'`.

- [ ] **Step 1: Failing tests** (mock `fetch`): with `SPARROW_TOKEN=t`, the request has the Task 1 header. A 401, 403, or any 3xx response throws `KbError('unauthorized', 'not signed in. Set SPARROW_TOKEN')`.
- [ ] **Step 2:** `pnpm test src/cli/http.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Map `unauthorized`/`forbidden` from the server to the same message only when `SPARROW_TOKEN` is unset; otherwise show the server's message. Dev forwarding to prod adds the same header from the dev server's `SPARROW_TOKEN`. In `agents-md.ts`, say comments are signed with your Authentik username.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: send SPARROW_TOKEN from the CLI (SPAR-55)`.
- [ ] **Step 6: Ship this task alone, before the server tasks.** Do it on its own branch from `main`, with `pnpm ship` and no `--task`. Today's server ignores the header, so this is safe. Every machine then has a CLI that can pass Authentik before the cutover. Rebase the main branch on `main` afterwards.

### Task 11: Deploy files and cutover

**Files:**
- Modify: `deploy/sparrow.service` (`EnvironmentFile=/etc/sparrow/sparrow.env`), `deploy/hawk-setup.sh` (create `/etc/sparrow/sparrow.env` mode 600 with empty keys if missing, owner root), `README.md`

- [ ] **Step 1:** Edit the files. `/etc/sparrow/sparrow.env` keys: `SPARROW_PROXY_SECRET`, `SPARROW_SERVICE_TOKEN`, `SPARROW_HAWK_TOKEN`.
- [ ] **Step 2:** `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 3:** Commit `feat(deploy): load sparrow secrets from /etc/sparrow/sparrow.env`.
- [ ] **Step 4: Cutover with Andrew, in one sitting, in this order.** Stop if any check fails.
  Caddy goes first: today's sparrow works fine behind Authentik, because it ignores the headers. So nobody is locked out at any step.
  1. Task 2 is shipped and `/etc/hawk/sparrow-hawk-token` has the token. Task 10 and the deploy files are shipped together as release 1 (branch `feat/spar-55-cli-token`). Then `sudo hawk setup sparrow` installs the new unit and makes an empty `/etc/sparrow/sparrow.env`. Run `sparrow upgrade` on every machine now: an older CLI's upgrade would follow Authentik's redirect after step 4 and save the login page over itself.
  2. Authentik: application `sparrow`, proxy provider, forward auth (single application), external host `https://sparrow.andrewminghanjiang.com`, bind `sparrow-admin` and `sparrow-user`, add to the embedded outpost.
  3. Fill `/etc/sparrow/sparrow.env`. Add `SPARROW_PROXY_SECRET` (same value) to `/etc/caddy/caddy.env`. Crow's `/etc/crow/crow.env` `SPARROW_SERVICE_TOKEN` must match.
  4. Hawk PR: `AUTH=authentik` in `hawk/apps/sparrow.env` with the comment `# Behind Authentik: needs SPARROW_PROXY_SECRET in /etc/caddy/caddy.env.` Ship it, re-run hawk setup for sparrow.
  5. Set `SPARROW_TOKEN` on Andrew's machines. Check: `sparrow list` works, and the browser asks you to sign in.
  6. `pnpm ship --task SPAR-55` for the server tasks.
- [ ] **Step 5: Checks.**
  - `curl -s https://sparrow.andrewminghanjiang.com/api/version` → JSON version.
  - `SPARROW_TOKEN= sparrow list` → "not signed in. Set SPARROW_TOKEN".
  - `sparrow list` with the token → tasks.
  - Browser sign-in as Andrew → board shows every project.
  - `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3417/api/tasks` on the mini PC → `401`.
  - Send feedback from crow → a `CROW` task with `reporter`.
  - Next hawk deploy comments on its task.

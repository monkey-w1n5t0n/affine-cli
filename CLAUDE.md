# Affine CLI — Fork Notes

Fork of [woodcoal/affine-cli](https://github.com/woodcoal/affine-cli) (community tool by 木炭, MIT). Audited as clean before adoption — solo author, ~50 npm downloads/month, no community oversight, so treat upstream pulls as a security checkpoint.

`AGENTS.md` documents the upstream project structure. Note it's slightly stale: it calls `npm run build` "TypeScript compilation" but it's actually `node build.js` (esbuild bundle + `tsc --noEmit` typecheck).

## Install / link

```bash
npm install
npm run build    # writes dist/index.js
npm link         # symlinks `affine-cli` on PATH → bin/affine-cli → dist/index.js
```

Re-link only if `bin/affine-cli` itself changes.

## Build workflow

The `affine-cli` command runs `dist/index.js`, **not** the TypeScript source. Changes to `src/` have no effect until rebuild.

**Default: run `npm run build` after any change under `src/` or to `build.js`, before reporting the task done.** This refreshes `dist/index.js` and runs `tsc --noEmit` for typecheck.

`npm run dev` is a trap — it's `tsc --watch`, typechecks only, does not regenerate `dist/`. Don't use it.

### When to deviate — flag and offer options

Surface these proactively instead of building reflexively:

- **Docs-only change** (README, AGENTS.md, CLAUDE.md, comment-only edits): no build needed.
- **Many sequential edits in one task**: batch them, build once at the end.
- **Iterative debugging / many tight edits expected**: offer to start an esbuild watch process in a side terminal instead, so `dist/` refreshes on every save:
  ```bash
  npx esbuild src/index.ts --bundle --platform=node --format=esm \
    --target=node18 --outfile=dist/index.js \
    --external:socket.io-client --external:yjs --external:form-data \
    --external:fractional-indexing --external:markdown-it --external:nanoid \
    --external:node-fetch --external:undici --watch
  ```
  Watch mode skips the `tsc --noEmit` step — type errors will surface at runtime, not build-time. Trade-off worth flagging.
- **`package.json` deps changed**: `npm install` before `npm run build`.
- **Build failure**: surface the error and stop. Don't bypass `tsc --noEmit` (it's load-bearing) without asking.

## Syncing upstream

```bash
git remote add upstream https://github.com/woodcoal/affine-cli.git    # one-time
git fetch upstream
git log --oneline main..upstream/main    # review diff — security checkpoint
git merge upstream/main
npm install && npm run build             # if deps or src/ changed
```

Never merge upstream blind. The community is too small to catch a malicious release for you.

# ts-logging-common

<!-- last reviewed: 2026-08 | owner: x1-labs -->

Bun workspace monorepo publishing four npm packages under `@x1-labs/`: a Pino
logger factory (`logging`) plus three framework adapters that depend on it
(`logging-nestjs`, `logging-express`, `logging-bun`). Consumers install the core
and, if they use a framework, one adapter.

## Commands

```bash
bun install          # workspace install; CI uses --frozen-lockfile
bun run build        # tsc build for every package -> packages/*/dist
bun run typecheck    # tsc --noEmit everywhere (requires a prior build, see below)
bun run check        # format + lint + typecheck
bun test packages/*/src
bun run bump 0.1.31  # rewrite the version in every package + the internal dep range
bun run publish-all  # build, then npm publish --workspaces --access public
```

`lint` and `format` write files (`eslint --fix`, `prettier --write`). The
read-only variants CI uses are `lint:check` and `format:check`.

## Invariants

- **Build before typecheck.** `dist/` is git-ignored, and the adapter packages
  resolve `@x1-labs/logging` through its built `dist/index.d.ts`. On a fresh
  checkout, `typecheck` without a build fails with TS2339 on every option
  property. CI orders the steps this way for the same reason.
- **The core package has a browser build.** `packages/logging` ships a separate
  browser entry point alongside the Node one. A change to the core's public
  surface has to be reflected in both, or the browser bundle silently drifts.
- **Version bumps are all-or-nothing.** Every package moves to the same version
  together, and the adapters' `^` range on the core is rewritten to match. Use
  the `bump` script; hand-editing one `package.json` breaks the others.
- **Adapters never import each other.** They depend only on the core. Keeping
  that edge one-directional is what lets a consumer install a single adapter
  without pulling in NestJS, Express, and Bun types.
- **Framework deps are peer deps.** `nestjs-pino`, `@nestjs/common`, `express`,
  `pino-http`, and `pino-pretty` belong in `peerDependencies` on the adapters
  and in `devDependencies` at the root only. Promoting one to a real dependency
  makes every consumer install a framework they may not use.

## Configuration contract

Behavior is env-driven, and these names are the public API — renaming one is a
breaking change for consumers.

| Var | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info`, or `debug` when `NODE_ENV=development` | `verbose` is normalized to `trace` |
| `LOG_FORMAT` | `json`, or `pretty` when `NODE_ENV=development` | `json`, `logfmt`, `pretty` |
| `LOG_OMIT_FIELDS` | `pid,hostname` | K8s-friendly; `none` includes all base fields |
| `LOG_TIMESTAMP` | `true` | set false when the log shipper stamps its own |

Every resolver follows the same precedence: explicit option → env var →
`NODE_ENV` heuristic → default. New options should keep that shape.

## Gotchas

- The Bun adapter distinguishes a *thrown* error from a *returned* 5xx. Thrown
  errors are logged and rethrown so `Bun.serve`'s own `error` handler decides
  the response; a returned status >= 500 logs `request errored` with an error
  synthesized from the status code. This mirrors `pino-http`, and the two paths
  must stay behaviorally identical to the Express adapter's output.
- Output is CommonJS (ES2022) with declaration files. Adding ESM-only syntax or
  a top-level `await` breaks the emit for consumers.
- `packages/*/tsconfig.build.json` excludes `**/*.spec.ts` and test files, so a
  test importing something the build excludes will pass locally and fail on
  publish.

## Deeper docs

- `README.md` — consumer-facing usage for each package
- `docs/` — design specs and implementation plans

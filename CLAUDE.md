# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bun workspace monorepo containing three packages:

- **`@x1-labs/logging`** (`packages/logging/`) — Pino-based logger factory for Node.js applications. No NestJS dependency.
- **`@x1-labs/logging-nestjs`** (`packages/logging-nestjs/`) — NestJS integration module. Depends on `@x1-labs/logging` and has `nestjs-pino` + `@nestjs/common` as peer dependencies.
- **`@x1-labs/logging-express`** (`packages/logging-express/`) — Express `pino-http` middleware. Depends on `@x1-labs/logging` and has `express` + `pino-http` as peer dependencies.

## Commands

```bash
bun run build        # Build all packages (bun run --filter '*' build)
bun run typecheck    # Type check all packages
bun run lint         # ESLint with auto-fix across all packages
bun run format       # Prettier across all packages
bun run check        # Run format + lint + typecheck together
bun run bump 0.1.5   # Bump all package versions to specified version
bun run publish-all  # Build + publish all packages to npm
```

No test framework is configured yet. Each package's `tsconfig.build.json` excludes `**/*.spec.ts` in anticipation of future tests.

## Architecture

### `packages/logging/` — Core

- **`level.ts`** — `resolveLogLevel()`: resolves log level from explicit override → `LOG_LEVEL` env var → `'debug'` if `NODE_ENV=development` → `'info'` default. Normalizes `'verbose'` to `'trace'`.
- **`base.ts`** — `resolveBase()`: resolves Pino `base` option from `LOG_OMIT_FIELDS` env var. Defaults to omitting `pid,hostname` (K8s-friendly). Set to `none` to include all fields.
- **`logger.ts`** — `createLogger()`: Pino logger factory. Supports custom level, name, JSON toggle, and arbitrary Pino options. Enables `pino-pretty` when not in JSON mode. Respects `LOG_FORMAT=json` and `LOG_OMIT_FIELDS` env vars.

### `packages/logging-nestjs/` — NestJS Integration

- **`nest.ts`** — `createNestLoggerModule()`: returns a NestJS `DynamicModule` wrapping `nestjs-pino`. Configures HTTP logging with IP extraction from `x-forwarded-for`.
- Imports `resolveLogLevel`, `resolveBase`, and `CreateLoggerOptions` from `@x1-labs/logging`.

### `packages/logging-express/` — Express Integration

- **`express.ts`** — `createExpressLogger()`: returns `pino-http` middleware for Express apps. Supports custom level, JSON toggle, auto-logging, forwarded IP extraction, and arbitrary pino/pino-http options.
- Imports `resolveLogLevel`, `resolveBase`, and `CreateLoggerOptions` from `@x1-labs/logging`.

## Key Design Decisions

- **Three-package split**: projects without a framework depend only on `@x1-labs/logging`; NestJS projects add `@x1-labs/logging-nestjs`; Express projects add `@x1-labs/logging-express`.
- **Workspace linking**: `@x1-labs/logging-nestjs` depends on `@x1-labs/logging` via `workspace:*`.
- **Shared tooling**: eslint, prettier, typescript, and all NestJS/pino dev dependencies live in the root `package.json`. Individual packages only declare their runtime/peer dependencies.
- **Environment-driven config**: log level via `LOG_LEVEL`, format via `LOG_FORMAT=json`, base field omission via `LOG_OMIT_FIELDS` (defaults to `pid,hostname`), dev detection via `NODE_ENV=development`.
- **Output**: CommonJS (ES2022 target), with declaration files. Each package emits to its own `dist/`.

## TypeScript

- Shared base `tsconfig.json` at root (no `outDir`, no `include`)
- Each package extends it and sets `outDir: ./dist`, `rootDir: ./src`
- Strict mode enabled, incremental builds enabled

# Monorepo Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the single `@x1-labs/logging` package into a bun-workspace monorepo with `@x1-labs/logging` (core) and `@x1-labs/logging-nestjs` (NestJS integration).

**Architecture:** Root workspace at repo root with `packages/logging/` and `packages/logging-nestjs/`. Shared tooling config (eslint, prettier, base tsconfig) stays at root. The NestJS package depends on the core package and re-exports nothing from it — consumers import from whichever package they need.

**Tech Stack:** Bun workspaces, TypeScript, Pino, NestJS (optional)

---

### Task 1: Create directory structure

**Step 1: Create package directories**

```bash
mkdir -p packages/logging/src
mkdir -p packages/logging-nestjs/src
```

**Step 2: Move source files**

```bash
cp src/level.ts packages/logging/src/level.ts
cp src/logger.ts packages/logging/src/logger.ts
cp src/nest.ts packages/logging-nestjs/src/nest.ts
```

**Step 3: Remove old src/ and dist/**

```bash
rm -rf src/ dist/
```

---

### Task 2: Create core package (`packages/logging`)

**Files:**
- Create: `packages/logging/package.json`
- Create: `packages/logging/src/index.ts`
- Create: `packages/logging/tsconfig.json`
- Create: `packages/logging/tsconfig.build.json`

**Step 1: Write `packages/logging/package.json`**

```json
{
  "name": "@x1-labs/logging",
  "version": "0.1.0",
  "description": "Shared pino logging library",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pino": "^10.3.0"
  },
  "peerDependencies": {
    "pino-pretty": "^13.0.0"
  },
  "peerDependenciesMeta": {
    "pino-pretty": {
      "optional": true
    }
  },
  "files": ["dist"],
  "license": "MIT"
}
```

**Step 2: Write barrel `packages/logging/src/index.ts`**

```ts
export { resolveLogLevel } from './level';
export { createLogger } from './logger';
export type { CreateLoggerOptions } from './logger';
```

**Step 3: Write `packages/logging/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 4: Write `packages/logging/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts"]
}
```

---

### Task 3: Create NestJS package (`packages/logging-nestjs`)

**Files:**
- Create: `packages/logging-nestjs/package.json`
- Create: `packages/logging-nestjs/src/index.ts`
- Modify: `packages/logging-nestjs/src/nest.ts` (update import path)
- Create: `packages/logging-nestjs/tsconfig.json`
- Create: `packages/logging-nestjs/tsconfig.build.json`

**Step 1: Write `packages/logging-nestjs/package.json`**

```json
{
  "name": "@x1-labs/logging-nestjs",
  "version": "0.1.0",
  "description": "NestJS pino logging integration",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@x1-labs/logging": "workspace:*"
  },
  "peerDependencies": {
    "pino-pretty": "^13.0.0",
    "nestjs-pino": "^4.0.0",
    "@nestjs/common": "^11.0.0"
  },
  "peerDependenciesMeta": {
    "pino-pretty": {
      "optional": true
    }
  },
  "files": ["dist"],
  "license": "MIT"
}
```

**Step 2: Update `packages/logging-nestjs/src/nest.ts`**

Change the imports from local paths to the core package:

```ts
import type { DynamicModule } from '@nestjs/common';
import { resolveLogLevel } from '@x1-labs/logging';
import type { CreateLoggerOptions } from '@x1-labs/logging';
```

**Step 3: Write barrel `packages/logging-nestjs/src/index.ts`**

```ts
export { createNestLoggerModule } from './nest';
export type { CreateNestLoggerModuleOptions } from './nest';
```

**Step 4: Write `packages/logging-nestjs/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 5: Write `packages/logging-nestjs/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts"]
}
```

---

### Task 4: Update root workspace config

**Files:**
- Rewrite: `package.json` (workspace root)
- Rewrite: `tsconfig.json` (shared base, no outDir)
- Delete: `tsconfig.build.json`

**Step 1: Rewrite root `package.json`**

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "bun run --filter '*' build",
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "eslint \"packages/*/src/**/*.ts\" --fix",
    "format": "prettier --write \"packages/*/src/**/*.ts\"",
    "check": "bun run format && bun run lint && bun run typecheck"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.2",
    "@nestjs/common": "^11.1.12",
    "@nestjs/core": "^11.1.12",
    "@types/node": "^22.0.0",
    "eslint": "^9.39.2",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-prettier": "^5.5.5",
    "nestjs-pino": "^4.5.0",
    "pino": "^10.3.0",
    "pino-pretty": "^13.1.3",
    "prettier": "^3.8.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.53.1"
  }
}
```

**Step 2: Rewrite root `tsconfig.json`** (shared base — no outDir, no include)

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2022",
    "sourceMap": true,
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Step 3: Delete old `tsconfig.build.json`**

```bash
rm tsconfig.build.json
```

---

### Task 5: Update eslint config and install

**Step 1: Update `eslint.config.mjs`** to point at packages

Change parserOptions.project to find both package tsconfigs.

**Step 2: Run `bun install`** to link workspaces

**Step 3: Run `bun run build`** and verify both packages compile

**Step 4: Run `bun run check`** and verify lint + typecheck pass

---

### Task 6: Update CLAUDE.md

Update to reflect monorepo structure.

---

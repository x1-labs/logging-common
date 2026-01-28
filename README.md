# ts-logging-common

Shared pino-based logging packages for X1 Labs TypeScript services.

## Packages

| Package                                                 | Description                             | Peer Dependencies                                         |
|---------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------|
| [`@x1-labs/logging`](packages/logging/)                 | Pino logger factory (Node.js + browser) | `pino-pretty` (optional)                                  |
| [`@x1-labs/logging-nestjs`](packages/logging-nestjs/)   | NestJS integration module               | `nestjs-pino`, `@nestjs/common`, `pino-pretty` (optional) |
| [`@x1-labs/logging-express`](packages/logging-express/) | Express pino-http middleware            | `express`, `pino-http`, `pino-pretty` (optional)          |

## Installation

```bash
# Core (any Node.js or browser project)
npm install @x1-labs/logging

# NestJS projects
npm install @x1-labs/logging-nestjs nestjs-pino @nestjs/common

# Express projects
npm install @x1-labs/logging-express pino-http express

# Optional: pretty-printed dev output
npm install -D pino-pretty
```

## Usage

### Basic logger

```typescript
import { createLogger } from '@x1-labs/logging';

const logger = createLogger({ name: 'my-service' });
logger.info('Server started');
logger.debug({ port: 3000 }, 'Listening');
```

### Express middleware

```typescript
import express from 'express';
import { createExpressLogger } from '@x1-labs/logging-express';

const app = express();
app.use(createExpressLogger({ level: 'debug' }));
```

### NestJS module

```typescript
import { Module } from '@nestjs/common';
import { createNestLoggerModule } from '@x1-labs/logging-nestjs';

@Module({
  imports: [createNestLoggerModule({ level: 'info' })],
})
export class AppModule {}
```

## Configuration

All packages share the same environment-driven defaults:

| Variable          | Effect                                                    | Default              |
|-------------------|-----------------------------------------------------------|----------------------|
| `LOG_LEVEL`       | Set log level (`trace`, `debug`, `info`, `warn`, `error`) | `info`               |
| `LOG_FORMAT`      | Set to `json` for structured JSON output                  | pretty (pino-pretty) |
| `LOG_OMIT_FIELDS` | Comma-separated base fields to omit (e.g., `pid,hostname`) | `pid,hostname`       |
| `NODE_ENV`        | When `development`, default level becomes `debug`         | —                    |

To include all default Pino fields (pid, hostname), set `LOG_OMIT_FIELDS=none`.

Options passed to `createLogger()`, `createExpressLogger()`, or `createNestLoggerModule()` override environment variables.

## Browser support

`@x1-labs/logging` ships a browser entry point (`"browser"` field in package.json). Bundlers like webpack and Turbopack automatically use it. The browser build:

- Uses pino's built-in browser mode (`pino/browser.js`)
- Maps log levels to `console` methods
- Outputs structured objects (`browser: { asObject: true }`)
- Skips Node-only features (transports, pino-pretty)

No configuration needed — `import { createLogger } from '@x1-labs/logging'` works in both environments.

## Development

```bash
bun install              # Install dependencies
bun run build            # Build all packages
bun run check            # Format + lint + typecheck
bun run publish-all      # Build + publish all packages to npm
```

## License

MIT

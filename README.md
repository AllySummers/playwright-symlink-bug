Bug report (original): https://github.com/microsoft/playwright/issues/41371

# playwright-pnpm-repro

Minimal reproduction of **two consecutive Playwright regressions** in the
synchronous ESM loader (`module.registerHooks()`) affecting pnpm workspace
monorepos.

---

## Bug 1 — `1.61.0`: `Cannot find module` (extensionless TypeScript subpath imports)

**Upstream issue:** [microsoft/playwright#41371](https://github.com/microsoft/playwright/issues/41371)
**Status:** Fixed in `1.61.1`

### What broke

The new synchronous ESM loader (`module.registerHooks()`, introduced in
[PR #40891](https://github.com/microsoft/playwright/pull/40891)) broke module
resolution for **extensionless TypeScript subpath imports** across pnpm
workspace symlinks.

When an ESM workspace package (`"type": "module"`) does an extensionless
subpath import of a sibling workspace package (e.g.
`import { greet } from '@repro/shared/lib/text.utils'`), the sync loader
resolves the importing file to its real path and passes a `file://` URL to
Node's native ESM resolver. That resolver only tries `.js`/`.mjs`/`.cjs` — it
never adds `.ts` — so the import fails even though the `.ts` file exists.

### Error

```
Error: Cannot find module '.../packages/core/node_modules/@repro/shared/lib/text.utils'
imported from .../packages/core/lib/conversations.ts
Did you mean to import "file:///.../packages/shared/lib/text.utils.ts"?
```

---

## Bug 2 — `1.61.1`: `SyntaxError: Unexpected token 'export'` (compilation cache collision)

**Status:** Not yet fixed at time of writing

### What broke

When `playwright.config.mts` (explicit ESM via `.mts` extension) **imports
from a workspace package** that is also transitively required in CJS context
(e.g. from `global-setup.ts`), the shared compilation cache returns the
ESM-compiled module source for the later CJS `require()` call.

Node then tries to execute ESM syntax (`export`, `import`) inside a CommonJS
context and throws a `SyntaxError`.

### Root cause

In `packages/playwright/src/transform/compilationCache.ts`:

```
memoryCache = new Map<filename, { codePath }>();
```

The in-process `memoryCache` is keyed **only by filename**. The on-disk cache
uses a hash that includes an `"esm"` vs `"no_esm"` flag, so disk entries are
distinct. But once an ESM-compiled result is read from disk and stored in
`memoryCache`, all subsequent calls to `getFromCompilationCache()` for that
filename — regardless of whether CJS or ESM compilation was requested — hit the
memory cache and return the wrong (ESM) source.

**Sequence of events:**

1. `playwright.config.mts` is loaded as ESM via `eval(`import(...)`)`.
2. Node's ESM resolver resolves `@repro/env` → follows the pnpm symlink →
   real path `packages/env/index.ts` (no `node_modules` in path).
3. `shouldTransform('packages/env/index.ts')` returns `true`.
4. Playwright's `load` hook compiles it as **ESM** (babel with `moduleUrl` set),
   writes to disk at `<esm-hash>.js`, and inserts into
   `memoryCache['packages/env/index.ts']`.
5. `global-setup.ts` (CJS — `apps/e2e` has no `"type": "module"`) is loaded.
   It transitively requires `@repro/env`.
6. Playwright's `load` hook is called again with CJS conditions
   (`require, module-sync`).
7. `getFromCompilationCache('packages/env/index.ts', cjsHash)` checks
   `memoryCache` first → **cache hit** → returns the ESM-compiled source.
8. `load` returns `{ format: "commonjs", source: <ESM code> }`.
9. Node tries to execute `export const env = …` in CJS mode →
   **`SyntaxError: Unexpected token 'export'`** (or
   `Cannot use import statement outside a module` if the cached code has
   `import` statements).

### Error

```
Warning: Failed to load the ES module: .../packages/env/index.ts.
Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.

SyntaxError: Unexpected token 'export'

   at ../../../packages/core/lib/conversations.ts:1

> 1 | import { env } from '@repro/env';
    | ^
```

### Fix

The `memoryCache` key should include the compilation mode (ESM vs CJS), e.g.:

```ts
// Instead of:
memoryCache.set(filename, entry);

// Use:
const cacheKey = `${filename}:${moduleUrl ? 'esm' : 'cjs'}`;
memoryCache.set(cacheKey, entry);
```

---

## Confirmed behaviour

| Version | Command | Result |
| --- | --- | --- |
| `1.61.0` | `mise run test` | ❌ `Cannot find module` (Bug 1) |
| `1.61.0` | `mise run test-workaround` | ✅ passes |
| `1.61.1` | `mise run test` | ❌ `SyntaxError: Unexpected token 'export'` (Bug 2) |
| `1.61.1` | `mise run test-workaround` | ✅ passes |

---

## Prerequisites that trigger Bug 2

All of the following must be true simultaneously:

1. **Playwright `1.61.1`** on **Node 22+** (so `module.registerHooks` is used).
2. **`playwright.config.mts`** (or `.mjs`) explicitly imports from a workspace
   package — the import must **not** be stripped by the TypeScript/babel
   transform (i.e. the import must actually be used in the config body).
3. The imported workspace package has **`"type": "module"`** in its
   `package.json`.
4. The same workspace package is also **transitively required** (CJS context)
   from `globalSetup`.
5. A **pnpm workspace** where the package is symlinked directly to
   `packages/<name>` (real path has no `node_modules` segment), so
   `shouldTransform()` returns `true` and the ESM load is intercepted.

---

## Repo layout

```
.
├── mise.toml                       # node 24.16.0, pnpm 11.5.3
├── package.json                    # workspace root ("type": "module")
├── pnpm-workspace.yaml
├── packages/
│   ├── shared/                     # @repro/shared ("type": "module")
│   │   └── lib/text.utils.ts       #   exports greet()
│   ├── core/                       # @repro/core ("type": "module")
│   │   └── lib/conversations.ts    #   imports from @repro/shared & @repro/env
│   └── env/                        # @repro/env ("type": "module", exports map)
│       └── index.ts                #   exports { env } — no workspace deps
└── apps/
    └── e2e/                        # @repro/e2e (CJS — no "type")
        ├── playwright.config.mts   #   imports { env } from @repro/env (used in baseURL)
        ├── global-setup.ts         #   imports { dbUrl } from @repro/core → @repro/env
        └── tests/basic.spec.ts
```

**Why this triggers the cache collision:**
- Config (`playwright.config.mts`) → ESM import → `@repro/env` compiled as ESM → cached
- Global setup (`global-setup.ts`) → CJS require chain → `@repro/env` → cache hit returns ESM code → SyntaxError

---

## Setup

```sh
mise install      # installs node 24.16.0 and pnpm 11.5.3
pnpm install
```

Do **not** use `npx`, `pnpm exec`, or `pnpm run`. Run commands directly via
`mise run` or `mise exec --`.

## Reproduce Bug 2 (`1.61.1`)

```sh
mise run test
```

Fails with `SyntaxError: Unexpected token 'export'`.

## Workaround

```sh
mise run test-workaround
```

Runs with `PLAYWRIGHT_FORCE_ASYNC_LOADER=1` (reverts to the old async loader),
which passes because the esmLoader worker uses a separate `memoryCache` from
the main thread, so the ESM-compiled code never contaminates the CJS require
chain.

---

## Reference

- Original regression issue: [microsoft/playwright#41371](https://github.com/microsoft/playwright/issues/41371)
- Sync loader PR: [microsoft/playwright#40891](https://github.com/microsoft/playwright/pull/40891)

---

_This reproduction and README were produced by an AI agent._

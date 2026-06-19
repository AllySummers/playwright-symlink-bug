# playwright-pnpm-repro

Minimal reproduction of a **Playwright `1.61.0` regression**: the new
**synchronous ESM loader** (`module.registerHooks()`, PR
[#40891](https://github.com/microsoft/playwright/pull/40891), commit
`c758b150`) breaks module resolution for pnpm workspace packages.

When an **ESM** workspace package (`"type": "module"`) does an **extensionless
subpath import** of a sibling workspace package (e.g.
`import { greet } from '@repro/shared/lib/text.utils'`), the sync loader resolves
the importing file to its **real path** (`packages/core/lib/conversations.ts`)
and then hands a `file://` URL to Node's native ESM resolver. That resolver only
tries `.js`/`.mjs`/`.cjs` — it never adds `.ts` — so the import fails even though
the `.ts` file plainly exists (Node even prints a "Did you mean…?" hint pointing
at it).

The old async loader (`module.register()`, used in `1.60.0` and still reachable
via `PLAYWRIGHT_FORCE_ASYNC_LOADER=1`) resolved TypeScript subpath imports
correctly.

## Confirmed behaviour

| Configuration | Result |
| --- | --- |
| `@playwright/test@1.61.0`, default sync loader | ❌ **fails** — `Cannot find module …/node_modules/@repro/shared/lib/text.utils` |
| `@playwright/test@1.61.0` + `PLAYWRIGHT_FORCE_ASYNC_LOADER=1` | ✅ passes |
| `@playwright/test@1.60.0`, default loader | ✅ passes |

Reproduces on both macOS (arm64) and Linux CI.

### Exact error

```
Error: Cannot find module '.../packages/core/node_modules/@repro/shared/lib/text.utils'
imported from .../packages/core/lib/conversations.ts
Did you mean to import "file:///.../packages/shared/lib/text.utils.ts"?
```

## The ingredients that trigger it

All of the following are required — drop any one and the bug disappears:

1. **Playwright `1.61.0`** on **Node 22+** (so `module.registerHooks` exists and
   the sync loader activates).
2. Workspace packages marked **`"type": "module"`** (forces the strict ESM
   `file://` resolver for sub-imports).
3. **Extensionless subpath imports** of `.ts` files
   (`@repro/shared/lib/text.utils`, not `.../text.utils.ts`).
4. **No `exports` / `main`** field — raw `.ts` source imported directly, no
   build step.
5. A pnpm workspace, so the imported package is a **symlink** whose real path
   differs from the symlink path.

The import chain that breaks:
`apps/e2e/tests/basic.spec.ts` → `@repro/core/lib/conversations`
→ `@repro/shared/lib/text.utils`.

## Layout

```
.
├── mise.toml                 # node 24.16.0, pnpm 11.5.3, playwright on PATH via _.path
├── package.json               # workspace root ("type": "module")
├── pnpm-workspace.yaml
├── packages/
│   ├── shared/                # @repro/shared ("type": "module")
│   │   └── lib/text.utils.ts  #   exports greet()
│   └── core/                  # @repro/core   ("type": "module"), dep on @repro/shared
│       └── lib/conversations.ts  # re-exports greet from '@repro/shared/lib/text.utils'
└── apps/
    └── e2e/                   # @repro/e2e (CJS — no "type"), the Playwright test app
        ├── playwright.config.ts
        └── tests/basic.spec.ts   # imports '@repro/core/lib/conversations'
```

## Setup

```sh
mise install      # node 24.16.0 + pnpm 11.5.3
pnpm install
```

`playwright` is on `PATH` via mise's `_.path` (see `mise.toml`), so invoke it
directly — do **not** use `pnpm exec`, `npx`, or `pnpm run`.

## Reproduce the bug

```sh
playwright test
```

Fails with `Cannot find module …/packages/core/node_modules/@repro/shared/lib/text.utils`.

## Confirm the workaround (old async loader)

```sh
PLAYWRIGHT_FORCE_ASYNC_LOADER=1 playwright test
```

Passes.

## Confirm it's a 1.61.0 regression

Change `@playwright/test` to `1.60.0` in `apps/e2e/package.json`, then:

```sh
pnpm install
playwright test     # passes
```

Restore `1.61.0` to get the failure back.

## Reference

- Regression commit: `c758b150` /
  PR [#40891](https://github.com/microsoft/playwright/pull/40891)
- File the upstream issue: <https://github.com/microsoft/playwright/issues/new>

---

_This reproduction and README were produced by an AI agent._

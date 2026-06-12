# Dispatch Web

The **web frontend** for [Dispatch](../arch-rewrite) — a separate repo built to the same
methodology (thin shell + pure feature libraries + a backend-driven *surface* host). It consumes
the backend's typed contracts over HTTP + a WebSocket and ships no business logic the backend
doesn't expose.

- **Stack:** Bun + Vite + Svelte 5 (runes) + TypeScript (strict). Biome (lint/format), Vitest +
  `@testing-library/svelte` (tests).
- **Slice 1 (current):** the **surface system** — connects to the backend's surface WebSocket,
  fetches the surface *catalog*, and renders any backend-declared *surface* generically (e.g. the
  live "Loaded Extensions" surface). Chat UI is a later slice.

---

## Prerequisites

- [Bun](https://bun.sh) (v1.3+).
- **The backend repo as a sibling directory** — this repo links `@dispatch/ui-contract` from
  `../arch-rewrite` via a `file:` dependency:
  ```
  dispatch/
    arch-rewrite/    # the backend (Dispatch server)
    dispatch-web/    # this repo
  ```
- The **backend server running** for surfaces to appear (see `../arch-rewrite/README.md`).

```sh
cd dispatch-web
bun install          # links @dispatch/ui-contract from ../arch-rewrite
```

---

## Run it (visit locally)

```sh
# 1) start the backend (sibling repo) — HTTP :24203 + surface WS :24205
cd ../arch-rewrite && bun run dev

# 2) start this dev server — Vite on :24204
cd ../dispatch-web && bun run dev
```

Open **http://localhost:24204**. You'll see the surface catalog (e.g. "Loaded Extensions"); the
frontend connects to the backend's surface WebSocket at `ws://localhost:24205` (override with
`VITE_WS_URL`).

> **Tip — run both at once with live reload:** the backend repo ships `../arch-rewrite/bin/up`
> (also `bun run dev:all` there) which starts the backend (`bun --watch`) + this dev server
> (Vite HMR) together; **Ctrl-C stops both**.

---

## Visiting over a LAN / Tailscale

The dev server is configured (`vite.config.ts`) to bind **all interfaces** (`server.host: true`)
and accept **any Host header** (`server.allowedHosts: true`) — so it's reachable from another
device on your tailnet. This is safe ONLY because you run it on a **private/local network, not
exposed to the internet** (`allowedHosts: true` disables Vite's DNS-rebinding host check).

When browsing from a **different device than the one running the backend**, set two things:

1. **Reach the dev server:** open `http://<this-machine-tailscale-name>:24204`. (The backend's Bun
   servers already bind all interfaces, so `:24203`/`:24205` are reachable over Tailscale too.)
2. **Point the frontend at the backend's WebSocket.** The WS URL runs in *your browser*, so
   `localhost` would mean *your* device — set it to the backend host. Create `dispatch-web/.env`:
   ```sh
   VITE_WS_URL=ws://<backend-machine-tailscale-name>:24205
   ```
   Vite auto-loads `.env`; restart `bun run dev` after changing it.

---

## Structure (slice 1)

```
src/
  app/                  composition root — owns protocol state (runes), wires the socket, renders
  core/protocol/        PURE op-protocol reducer (catalog/subscribe/update/invoke) — zero I/O
  features/surface-host/  the generic surface interpreter + thin field components (toggle/…)
  adapters/ws/          injected WebSocket client (pure codec + reconnect; socket injected)
```

The surface vocabulary (`SurfaceSpec`, field kinds, the WS protocol) is the backend's
`@dispatch/ui-contract`, mirrored in-repo for reference at `.dispatch/ui-contract.reference.md`.

---

## Development

```sh
bun run dev          # Vite dev server (:24204)
bun run build        # production build → dist/
bun run typecheck    # svelte-check
bun run test         # vitest
bun run check        # biome (.ts/.js; .svelte correctness is svelte-check's job)
```

## Documentation

- **Design + plan:** `../arch-rewrite/notes/frontend-design.md`
- **Build rules + workflow:** `AGENTS.md` · **Vocabulary:** `GLOSSARY.md`

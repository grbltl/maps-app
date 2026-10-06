# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A minimal, early-stage web map demo. There is no build step, package manager, server, or
test suite — this is intentional, not missing infrastructure.

- `frontend/app.html` — the entire application: a single self-contained HTML page. It loads
  MapLibre GL JS v4.7.0 from the cdnjs CDN and renders a full-viewport map using the
  OpenFreeMap "bright" vector tile style. The map opens at zoom 1 centered on `[0, 20]`
  (whole-world view). Once the base style finishes loading (`map.on('load', ...)`), the page
  requests the visitor's location via the browser Geolocation API: on success it drops a blue
  marker and flies the camera to street level (zoom 15) over 3.5s; on denial/timeout/no
  support it logs to the console and leaves the map at the world view. Attribution controls
  are disabled.
- `backend/` — currently empty; reserved for future backend work.
- `frontend/Dockerfile`, `docker-entrypoint.sh`, `settings.json`, `statusline.sh` — these
  build a dev container that runs Claude Code itself (installs `@anthropic-ai/claude-code`,
  restores/persists CLI credentials from a mounted auth volume, configures a custom
  statusline). This is sandbox/tooling scaffolding, not part of the map application.

## Running it

Open `frontend/app.html` directly in a browser — no install or server required. Geolocation
generally requires a secure context (`https://` or `localhost`), so if testing geolocation
behavior specifically, serve the file over localhost rather than opening it as a `file://` URL.

There is no lint, build, or test command configured for this project.

## Working conventions

- `.gitignore` is `.*` (ignores all dotfiles) — be aware that new dotfiles won't be tracked
  unless force-added.
- Keep changes to `app.html` self-contained (inline `<style>`/`<script>`, CDN links) rather
  than introducing a build step, unless the user explicitly asks for one.

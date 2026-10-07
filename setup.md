# Setup: running the agent safely in Docker

The agent (Claude Code) runs inside a Docker container so its filesystem access is limited to
one shared folder you choose, instead of your whole machine. Login credentials persist across
container restarts via a mounted volume, so you only log in once.

Everything below uses `frontend/Dockerfile`, which already:
- installs Node 20, git, curl, and the `@anthropic-ai/claude-code` CLI,
- copies in `settings.json`/`statusline.sh` for the Claude Code status line,
- wires up `docker-entrypoint.sh`, which restores/persists login credentials to/from
  `/claude-auth` and `/gemini-auth` so they survive the container being removed and recreated.

## 1. Build the image

The build context is `frontend/` (it holds the Dockerfile plus the files it `COPY`s in):

```bash
docker build -t claude-code-sandbox -f frontend/Dockerfile frontend
```

## 2. Pick the shared folder

Choose the folder on your host machine the agent is allowed to see and edit — normally this
repo's root. This is the *only* part of your host filesystem the container can reach.

```bash
cd /path/to/this/repo   # the folder containing CLAUDE.md, frontend/, backend/
```

## 3. Run the container

```bash
docker run -it --rm \
  -v "$(pwd)":/workspace \
  -v claude-auth:/claude-auth \
  -v gemini-auth:/gemini-auth \
  claude-code-sandbox
```

- `-v "$(pwd)":/workspace` — the shared folder. Files created/edited by the agent land here on
  your host; nothing outside it is visible to the container.
- `-v claude-auth:/claude-auth` and `-v gemini-auth:/gemini-auth` — named Docker volumes (Docker
  creates them automatically the first time) where the entrypoint script persists your login
  credentials, independent of the container's own filesystem.

This drops you into a bash shell inside the container, already `cd`'d to `/workspace`. Start the
agent with:

```bash
claude
```

## 4. First run: log in once

On the first run there's no saved credential yet, so Claude Code takes you through its normal
onboarding/login flow. Once you authenticate, a background loop in `docker-entrypoint.sh` copies
the resulting credential into the `claude-auth` volume within a few seconds (same idea for Gemini
into `gemini-auth`, if you use it).

## 5. Later runs: no re-login

Re-run the same `docker run` command from step 3. The entrypoint finds the saved credential in
the volume, restores it into the fresh container, and marks onboarding/trust as already accepted
— so `claude` starts ready to work, with no login prompt.

## Safety notes

- Only mount the project folder you intend the agent to work on — never your home directory or
  another wider path. The shared folder is the agent's entire blast radius for file changes.
- Don't add `--privileged`, `--network host`, or mount `/var/run/docker.sock` — any of these
  would let the agent affect your host directly instead of just the container.
- Credentials are written with `chmod 600` and only ever go to the two named volumes above —
  the entrypoint script never logs or transmits them elsewhere.
- To fully log out / reset, remove the volumes: `docker volume rm claude-auth gemini-auth`.
- Review `frontend/Dockerfile` before changing it — it installs packages and the Claude Code CLI
  globally as root inside the image.

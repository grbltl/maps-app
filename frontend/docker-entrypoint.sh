#!/bin/bash
set -eu

AUTH_DIR=/claude-auth
mkdir -p "$AUTH_DIR" /root/.claude

AUTH_DIR_GEMINI=/gemini-auth
mkdir -p "$AUTH_DIR_GEMINI" /root/.gemini/antigravity-cli /root/.gemini/config

# A persisted credential means this is NOT the first run: restore it and mark
# onboarding complete so Claude skips the first-run flow (theme, login, trust).
# On the first run there is no credential, so onboarding runs once and the
# background saver below persists the resulting credential.
if [ -f "$AUTH_DIR/.credentials.json" ]; then
  cp "$AUTH_DIR/.credentials.json" /root/.claude/.credentials.json
  chmod 600 /root/.claude/.credentials.json
  echo '{ "hasCompletedOnboarding": true, "projects": { "/workspace": { "hasTrustDialogAccepted": true } } }' > /root/.claude.json
fi


if [ -f "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token" ]; then
  cp "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token" /root/.gemini/antigravity-cli/antigravity-oauth-token
  chmod 600 /root/.gemini/antigravity-cli/antigravity-oauth-token
  echo '{ "hasCompletedOnboarding": true, "projects": { "/workspace": { "hasTrustDialogAccepted": true } } }' > /root/.gemini/antigravity.json
fi

# Save the credential whenever it changes, so login survives any exit. Save
# when the persisted copy is missing (first login) or older than the live one;
# temp-file + chmod + atomic mv keeps the copy safe on the shared volume.
( set +e
  while true; do
    if [ -f /root/.claude/.credentials.json ] && \
       { [ ! -f "$AUTH_DIR/.credentials.json" ] || \
         [ /root/.claude/.credentials.json -nt "$AUTH_DIR/.credentials.json" ]; }; then
      tmp=$(mktemp "$AUTH_DIR/.credentials.json.tmp.XXXXXX")
      cp /root/.claude/.credentials.json "$tmp"
      chmod 600 "$tmp"
      mv -f "$tmp" "$AUTH_DIR/.credentials.json"
    fi
    sleep 5
  done ) &

( set +e
  while true; do
    if [ -f /root/.gemini/antigravity-cli/antigravity-oauth-token ] && \
       { [ ! -f "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token" ] || \
         [ /root/.gemini/antigravity-cli/antigravity-oauth-token -nt "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token" ]; }; then
      tmp=$(mktemp "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token.tmp.XXXXXX")
      cp /root/.gemini/antigravity-cli/antigravity-oauth-token "$tmp"
      chmod 600 "$tmp"
      mv -f "$tmp" "$AUTH_DIR_GEMINI/antigravity-cli/antigravity-oauth-token"
    fi
    sleep 5
  done ) &  

# exec so the command runs as PID 1 (correct signal handling / reaping).
exec "$@"

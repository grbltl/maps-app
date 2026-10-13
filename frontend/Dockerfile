FROM node:20-slim

# Install absolute baseline dependencies and clean up caches immediately
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    python3 \
    curl \
    procps \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install Claude Code and TypeScript globally
#RUN npm install -g @anthropic-ai/claude-code typescript && npm cache clean --force

# 2. Pin to the safe version, skip pre-built modern binaries, and build from source
RUN npm install -g @anthropic-ai/claude-code@2.1.112 typescript \
    --build-from-source \
    --unsafe-perm \
    && npm cache clean --force

# 3. CRITICAL: Stop Claude Code from pulling down the latest breaking update on launch
ENV DISABLE_AUTOUPDATER=1

# Claude Code configuration directory structure
RUN mkdir -p /root/.claude
COPY settings.json /root/.claude/settings.json
COPY statusline.sh /root/.claude/statusline.sh
RUN chmod +x /root/.claude/statusline.sh

# Entrypoint configuration
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/bin/bash"]


FROM node:20-slim

# Install absolute baseline dependencies and clean up caches immediately
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    procps \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install Claude Code and TypeScript globally
RUN npm install -g @anthropic-ai/claude-code typescript && npm cache clean --force

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


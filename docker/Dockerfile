# MVPClaw — production Dockerfile
#
# Single-stage build for a Node.js 24-slim base. Layer-cached deps come
# first (no source copy until after pnpm install) so a code-only change
# doesn't trigger a fresh node_modules.
#
# Claude Code CLI is installed conditionally — leave it in when the
# configured provider is `claude-cli`; remove the relevant RUN line when
# `agent.provider = "openrouter"` to save image size.

FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 1) Deps first for layer caching.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# 2) Source.
COPY . .
RUN pnpm build

# 3) Claude Code CLI — needed only when provider=claude-cli.
#    Remove this line for the openrouter-direct path to slim the image.
RUN npm install -g @anthropic-ai/claude-code

# 4) Runtime volumes (host-mounted by compose).
VOLUME ["/app/data", "/app/workspace"]

ENV NODE_ENV=production
ENV MVPCLAW_CONFIG=/app/mvpclaw.config.json
ENV MVPCLAW_DATA_DIR=/app/data
ENV MVPCLAW_WORKSPACE_DIR=/app/workspace

CMD ["node", "dist/cli/main.js", "start"]

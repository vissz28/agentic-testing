# Shared Quality Code MCP server for QA and PO (Jira-only tools), verified with Microsoft Entra ID.
# Build from the plugin folder:  docker build -f mcp-server/Dockerfile -t quality-code-mcp .
FROM python:3.12-slim

# Node.js 22 runs the plugin's scripts.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY lib ./lib
COPY commands ./commands
COPY guides ./guides
COPY schema ./schema
COPY templates ./templates
COPY mcp-server ./mcp-server
RUN pip install --no-cache-dir ./mcp-server

# The project the scripts read: mount a folder with .claude/quality-code.json at /data.
RUN useradd --create-home --uid 10001 qc && mkdir /data && chown qc /data
USER qc
ENV QUALITY_CODE_PLUGIN_ROOT=/app QUALITY_CODE_PROJECT_DIR=/data
# Set at run time: QUALITY_CODE_ENTRA_TENANT_ID, QUALITY_CODE_ENTRA_CLIENT_ID, QUALITY_CODE_PUBLIC_URL
# (and optionally QUALITY_CODE_ENTRA_REQUIRED_SCOPE). Without them the server refuses to start.

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
ENTRYPOINT ["quality-code-mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "8000"]

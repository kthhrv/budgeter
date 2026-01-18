# --- RECOMMENDED DOCKERFILE FOR HOME ASSISTANT ADDON ---

ARG BUILD_FROM=homeassistant/amd64-base-python

# STAGE 1: Build the React Frontend (Unchanged)
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/ .
WORKDIR /app/frontend
RUN npm ci
RUN npm run build

# STAGE 2: Build the Final Production Image
# Start FROM the official HA base image, which provides Python and essential tools
FROM $BUILD_FROM

# Set environment variables for Python
ENV UV_PROJECT_ENVIRONMENT="/venv" \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

ENV PATH="/venv/bin:${PATH}"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apk add --no-cache \
    nginx \
    bash \
    curl \
    jq

# Set the working directory
WORKDIR /app

# Copy and install Python packages using uv.
# This is the step where uv provides the most value in an addon.
COPY backend/pyproject.toml backend/uv.lock ./
COPY --from=ghcr.io/astral-sh/uv:0.7.14 /uv /usr/local/bin/uv
RUN uv sync --locked --no-install-project

# --- The rest of the Dockerfile continues as before ---
COPY backend/ .
COPY --from=builder /app/dist ./static_root/
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY run.sh /
RUN chmod +x /run.sh
CMD [ "/run.sh" ]

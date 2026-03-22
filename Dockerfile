# STAGE 1: Build the React Frontend
FROM node:22-alpine AS builder
WORKDIR /app/frontend
COPY frontend/ .
RUN npm ci
RUN npm run build

# STAGE 2: Build the Final Production Image
FROM python:3.13-alpine

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
    git \
    jq

WORKDIR /app

# Install Python dependencies
COPY backend/pyproject.toml backend/uv.lock ./
COPY --from=ghcr.io/astral-sh/uv:0.7.14 /uv /usr/local/bin/uv
RUN uv sync --locked --no-install-project

COPY backend/ .
COPY envars.yml /app/envars.yml
COPY --from=builder /app/frontend/dist ./static_root/
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY run.sh /
RUN chmod +x /run.sh

EXPOSE 80

CMD envars -f /app/envars.yml exec -e ${APP_ENV:-local} -- /run.sh

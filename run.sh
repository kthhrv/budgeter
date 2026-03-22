#!/usr/bin/env bash
set -e

# Fallback for domain if empty
if [ -z "$ADDON_DOMAIN" ] || [ "$ADDON_DOMAIN" == "null" ]; then
    export ADDON_DOMAIN=$(hostname)
fi

echo "Running database migrations..."
./manage.py migrate --no-input

./manage.py setup_oauth

echo "Collecting static files..."
./manage.py collectstatic --no-input

echo "Starting Gunicorn..."
gunicorn budgeter.wsgi:application \
    --workers 2 \
    --bind unix:/tmp/gunicorn.sock \
    --access-logfile - &

echo "Starting Nginx..."
nginx -g "daemon off;"

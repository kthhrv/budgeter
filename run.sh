#!/usr/bin/env bashio
#
# This script is the entrypoint for the addon.
# It prepares the Django environment and starts the Gunicorn and Nginx services.
# The `with-contenv` shebang makes bashio functions available.
#

# Exit immediately if a command exits with a non-zero status.
set -e

# ==============================================================================
# GET CONFIGURATION
# ==============================================================================
# Use bashio to read configuration options from the user's config.
# These are defined in the 'schema' of your config.yaml.
# This is the correct way to handle secrets and user-configurable settings.

# Example: Read the Django secret key from the addon's configuration.
# Make sure to set this as a required option in your config.yaml.
# Bulletproof Config: Read directly from options.json if bashio fails
# This bypasses Supervisor API issues
OPTIONS_FILE="/data/options.json"
export DJANGO_SECRET_KEY=$(jq -r '.secret_key // ""' $OPTIONS_FILE)
export GOOGLE_CLIENT_ID=$(jq -r '.google_client_id // ""' $OPTIONS_FILE)
export GOOGLE_CLIENT_SECRET=$(jq -r '.google_client_secret // ""' $OPTIONS_FILE)
export ADDON_DOMAIN=$(jq -r '.domain // ""' $OPTIONS_FILE)

# Fallback for domain if empty
if [ -z "$ADDON_DOMAIN" ] || [ "$ADDON_DOMAIN" == "null" ]; then
    export ADDON_DOMAIN=$(hostname)
fi

bashio::log.info "Configuration loaded (Direct JSON read)."
./manage.py setup_oauth

# Collect all static files
bashio::log.info "Collecting Django static files..."
./manage.py collectstatic --no-input


# ==============================================================================
# START SERVICES
# ==============================================================================
# Start the Gunicorn server in the background to run the Django application.
# It listens on a Unix socket, which Nginx is configured to proxy requests to.
# Replace 'my_django_app.wsgi:application' with the actual path to your WSGI app.
bashio::log.info "Starting Gunicorn..."
gunicorn budgeter.wsgi:application \
    --workers 2 \
    --bind unix:/tmp/gunicorn.sock &

# Start Nginx in the foreground.
# This must be the last command, as the script's lifetime is tied to this process.
# When Nginx stops, the container will exit.
bashio::log.info "Starting Nginx..."
nginx -g "daemon off;"

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
export DJANGO_SECRET_KEY=$(bashio::config 'secret_key')

# You can export any other settings your Django app needs as environment variables
# export DATABASE_URL=$(bashio::config 'database_url')

bashio::log.info "Configuration loaded."


# ==============================================================================
# DJANGO SETUP
# ==============================================================================
# Navigate to the application directory where manage.py is located.
cd /app

# Apply database migrations to ensure the database schema is up to date.
# The '--no-input' flag prevents it from asking for user confirmation.
bashio::log.info "Running Django database migrations..."
./manage.py migrate --no-input

# Collect all static files (e.g., for the Django Admin) into a single directory.
# Nginx is configured to serve files from this directory at the /static/ URL.
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

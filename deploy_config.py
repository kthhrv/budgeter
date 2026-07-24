"""Deploy configuration, resolved from environment variables.

Imported by tasks.py and unit-tested directly. Deliberately stdlib-only:
tasks.py imports invoke, which is not a project dependency, so config logic
placed there could not be tested.

Every default reproduces the historic .191 behaviour, so `inv release` from a
laptop with no environment set behaves exactly as it always has. CI on .137
overrides via BUDGETER_* variables.
"""
import os

DEFAULT_REGISTRY = "192.168.0.191:5000"
DEFAULT_PROD_HOST = "192.168.0.191"

# Non-secret compose interpolation vars only. Real secrets (DJANGO_SECRET_KEY,
# GOOGLE_CLIENT_ID/SECRET, ADDON_DOMAIN, HA_*) are decrypted inside the
# container at start-up by `envars exec` and never appear here.
ENV_COMPOSE_VARS = {
    "demo": {"BUDGETER_PORT": "8081", "COMPOSE_PROJECT_NAME": "budgeter-demo"},
    "prod": {"BUDGETER_PORT": "8080", "COMPOSE_PROJECT_NAME": "budgeter"},
}


def _env(environ):
    return os.environ if environ is None else environ


def registry(environ=None):
    return _env(environ).get("BUDGETER_REGISTRY", DEFAULT_REGISTRY)


def prod_host(environ=None):
    return _env(environ).get("BUDGETER_PROD_HOST", DEFAULT_PROD_HOST)


def is_local(environ=None):
    """True when the deploy runs on the target host itself (the CI runner on
    .137), so commands execute directly instead of over SSH. Avoids giving the
    runner a root SSH key — it only needs docker-group membership. Only the
    exact string "1" enables this; any other value (including "true") falls
    back to the default of False."""
    return _env(environ).get("BUDGETER_DEPLOY_LOCAL", "") == "1"


def use_buildx(environ=None):
    """The laptop path cross-builds linux/amd64 via the `budgeter-amd64` buildx
    builder. The .137 runner is native amd64 and has no such builder, so CI
    sets BUDGETER_BUILDX=0 for a plain `docker build`. Only the exact string
    "0" disables this; any other value (including "false") falls back to the
    default of True."""
    return _env(environ).get("BUDGETER_BUILDX", "1") != "0"


def stack_dir(env):
    if env == "prod":
        return "/opt/stacks/budgeter"
    return f"/opt/stacks/budgeter-{env}"


def env_lines(env, tag):
    """Lines for the stack's .env file. Raises KeyError for unknown envs."""
    compose_vars = ENV_COMPOSE_VARS[env]
    lines = [f"APP_ENV={env}", f"IMAGE_TAG={tag}"]
    lines += [f"{k}={v}" for k, v in compose_vars.items()]
    return lines

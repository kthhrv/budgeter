"""Deployment tasks for budgeter.

Usage:
    inv build                Build image tagged with git SHA + latest
    inv push                 Push image to registry
    inv deploy               Deploy to demo (default)
    inv deploy --env prod    Deploy to prod
    inv release              Build, push, deploy (default: demo)
    inv release --env prod   Full release to prod
    inv logs                 Tail logs (default: demo)
    inv status               Show running containers
"""

import io
import os
import tempfile

from invoke import task

REGISTRY = "192.168.0.191:5000"
REPO = "budgeter"
PROD_HOST = "192.168.0.191"
PROD_USER = "root"
PROD_DIR_TEMPLATE = "/opt/stacks/budgeter-{env}"
DEFAULT_ENV = "demo"
TARGET_PLATFORM = "linux/amd64"
BUILDX_BUILDER = "budgeter-amd64"

# The registry is plain HTTP. When the docker daemon uses the containerd image
# store, `docker push` ignores daemon.json `insecure-registries` and forces
# HTTPS (fails with EOF). So we push straight from BuildKit instead, with a
# builder that's been told the registry is insecure HTTP via this config.
BUILDKITD_CONFIG = f'''[registry."{REGISTRY}"]
  http = true
  insecure = true
'''

IMAGE = f"{REGISTRY}/{REPO}"

ENV_COMPOSE_VARS = {
    "demo": {
        "BUDGETER_PORT": "8081",
        "COMPOSE_PROJECT_NAME": "budgeter-demo",
    },
    "prod": {
        "BUDGETER_PORT": "8080",
        "COMPOSE_PROJECT_NAME": "budgeter",
    },
}


def _get_sha(c):
    result = c.run("git rev-parse --short HEAD", hide=True)
    return result.stdout.strip()


def _prod_dir(env):
    if env == "prod":
        return "/opt/stacks/budgeter"
    return PROD_DIR_TEMPLATE.format(env=env)


def _ssh(c, cmd, env=DEFAULT_ENV):
    remote = f"{PROD_USER}@{PROD_HOST}"
    prod_dir = _prod_dir(env)
    c.run(f'ssh {remote} "cd {prod_dir} && {cmd}"')


def _ensure_builder(c):
    """Create the buildx builder (insecure-registry-aware) if it doesn't exist.

    Idempotent and cheap — buildx persists the builder definition (incl. the
    insecure-registry config) on the host, so this only does real work on first
    run or after the builder is removed. The builder container itself is
    auto-booted by buildx on use, so it survives a docker/colima restart.
    """
    if c.run(f"docker buildx inspect {BUILDX_BUILDER}", hide=True, warn=True).ok:
        return
    print(f"Creating buildx builder '{BUILDX_BUILDER}' (insecure registry: {REGISTRY})")
    fd, config_path = tempfile.mkstemp(suffix=".toml")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(BUILDKITD_CONFIG)
        c.run(
            f"docker buildx create --name {BUILDX_BUILDER} --driver docker-container "
            f"--platform {TARGET_PLATFORM} --config {config_path} --bootstrap"
        )
    finally:
        os.remove(config_path)


@task
def build(c):
    """Build Docker image tagged with git SHA and latest, loaded into the local daemon."""
    sha = _get_sha(c)
    _ensure_builder(c)
    print(f"Building image — SHA: {sha} (platform: {TARGET_PLATFORM})")
    c.run(
        f"docker buildx build --builder {BUILDX_BUILDER} --platform {TARGET_PLATFORM} --load "
        f"-t {IMAGE}:{sha} -t {IMAGE}:latest -t budgeter:latest ."
    )


@task
def push(c):
    """Push image to the registry straight from BuildKit (cache hit after build)."""
    sha = _get_sha(c)
    _ensure_builder(c)
    print(f"Pushing {IMAGE}:{sha} and latest")
    # Re-run the build with --push; the layers are already in the build cache
    # from `build`, so this just exports + pushes them over HTTP.
    c.run(
        f"docker buildx build --builder {BUILDX_BUILDER} --platform {TARGET_PLATFORM} --push "
        f"-t {IMAGE}:{sha} -t {IMAGE}:latest ."
    )


@task
def deploy(c, env=DEFAULT_ENV):
    """Sync config, pull image, start container."""
    sha = _get_sha(c)
    remote = f"{PROD_USER}@{PROD_HOST}"
    prod_dir = _prod_dir(env)

    # Ensure remote dir exists
    c.run(f'ssh {remote} "mkdir -p {prod_dir}"')

    # Write .env for compose variable substitution. Pipe through stdin so we
    # don't have to worry about quoting / shell-`echo -e` flag portability.
    compose_vars = ENV_COMPOSE_VARS.get(env, {})
    env_lines = [
        f"APP_ENV={env}",
        f"IMAGE_TAG={sha}",
    ]
    env_lines += [f"{k}={v}" for k, v in compose_vars.items()]
    env_content = "\n".join(env_lines) + "\n"
    c.run(f"ssh {remote} 'cat > {prod_dir}/.env'", in_stream=io.StringIO(env_content))

    # Sync compose file
    print(f"Syncing compose.yml to {remote}:{prod_dir}")
    c.run(f"cat compose.yml | ssh {remote} 'cat > {prod_dir}/compose.yml'")

    # Pull and start
    print("Pulling image...")
    _ssh(c, "docker compose pull", env)
    print(f"Starting ({env})...")
    _ssh(c, "docker compose up -d", env)

    print(f"\nDeployed {sha} to {env}")


@task
def release(c, env=DEFAULT_ENV):
    """Build, push, and deploy."""
    sha = _get_sha(c)
    build(c)
    push(c)
    deploy(c, env=env)
    print(f"\nRelease complete — SHA: {sha}")


@task
def logs(c, env=DEFAULT_ENV):
    """Tail logs."""
    _ssh(c, "docker compose logs -f --tail=50", env)


@task
def status(c, env=DEFAULT_ENV):
    """Show running containers."""
    _ssh(c, "docker compose ps", env)


@task
def stop(c, env=DEFAULT_ENV):
    """Stop the stack."""
    _ssh(c, "docker compose down", env)

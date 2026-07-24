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

import deploy_config

# Host, registry, stack dirs and compose vars all live in deploy_config so they
# can be unit-tested without invoke installed, and overridden by env vars in CI.
# Defaults reproduce today's .191 behaviour exactly.
REGISTRY = deploy_config.registry()
REPO = "budgeter"
PROD_USER = "root"
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


def _get_sha(c):
    result = c.run("git rev-parse --short HEAD", hide=True)
    return result.stdout.strip()


def _prod_dir(env):
    return deploy_config.stack_dir(env)


def _ssh(c, cmd, env=DEFAULT_ENV):
    """Run a command in the stack dir on the target host.

    In local mode (the CI runner, which already lives on the target host)
    commands run directly. SSH-to-localhost would mean giving the runner a root
    SSH key — strictly more privilege than the docker-group membership it
    already needs."""
    prod_dir = _prod_dir(env)
    if deploy_config.is_local():
        c.run(f"cd {prod_dir} && {cmd}")
        return
    remote = f"{PROD_USER}@{deploy_config.prod_host()}"
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
    """Build Docker image tagged with git SHA and latest, loaded into the local daemon.

    Laptops cross-build linux/amd64 through the insecure-registry-aware buildx
    builder. The .137 CI runner is native amd64 and pushes to localhost:5000,
    which is TLS-exempt, so it sets BUDGETER_BUILDX=0 and takes a plain build.
    """
    sha = _get_sha(c)
    tags = f"-t {IMAGE}:{sha} -t {IMAGE}:latest -t budgeter:latest"
    if not deploy_config.use_buildx():
        print(f"Building image — SHA: {sha} (native)")
        c.run(f"docker build --build-arg GIT_SHA={sha} {tags} .")
        return
    _ensure_builder(c)
    print(f"Building image — SHA: {sha} (platform: {TARGET_PLATFORM})")
    c.run(
        f"docker buildx build --builder {BUILDX_BUILDER} --platform {TARGET_PLATFORM} --load "
        f"--build-arg GIT_SHA={sha} {tags} ."
    )


@task
def push(c):
    """Push image to the registry.

    Laptop path: straight from BuildKit (cache hit after `build`), because with
    the containerd image store `docker push` ignores daemon.json
    insecure-registries and forces HTTPS against the plain-HTTP registry on
    .191. On the .137 runner the target is localhost:5000, which IS TLS-exempt,
    so a plain docker push works and needs no builder.
    """
    sha = _get_sha(c)
    if not deploy_config.use_buildx():
        print(f"Pushing {IMAGE}:{sha} and latest (native)")
        c.run(f"docker push {IMAGE}:{sha}")
        c.run(f"docker push {IMAGE}:latest")
        return
    _ensure_builder(c)
    print(f"Pushing {IMAGE}:{sha} and latest")
    # Re-run the build with --push; the layers are already in the build cache
    # from `build`, so this just exports + pushes them over HTTP.
    c.run(
        f"docker buildx build --builder {BUILDX_BUILDER} --platform {TARGET_PLATFORM} --push "
        f"--build-arg GIT_SHA={sha} -t {IMAGE}:{sha} -t {IMAGE}:latest ."
    )


@task
def deploy(c, env=DEFAULT_ENV, tag=None):
    """Sync config, pull image, start container.

    `--tag` overrides the git SHA; the CI pipeline uses it to roll back to the
    previously deployed image after a failed health check."""
    sha = tag or _get_sha(c)
    prod_dir = _prod_dir(env)
    remote = f"{PROD_USER}@{deploy_config.prod_host()}"

    # env_lines raises KeyError for an unknown env — do this BEFORE creating any
    # directory, so a typo'd --env cannot mkdir a bogus stack dir.
    env_content = "\n".join(deploy_config.env_lines(env, sha)) + "\n"

    if deploy_config.is_local():
        c.run(f"mkdir -p {prod_dir}")
        with open(f"{prod_dir}/.env", "w") as fh:
            fh.write(env_content)
        print(f"Syncing compose.yml to {prod_dir}")
        c.run(f"cp compose.yml {prod_dir}/compose.yml")
    else:
        c.run(f'ssh {remote} "mkdir -p {prod_dir}"')
        # Pipe through stdin so we don't have to worry about quoting /
        # shell-`echo -e` flag portability.
        c.run(f"ssh {remote} 'cat > {prod_dir}/.env'", in_stream=io.StringIO(env_content))
        print(f"Syncing compose.yml to {remote}:{prod_dir}")
        c.run(f"cat compose.yml | ssh {remote} 'cat > {prod_dir}/compose.yml'")

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

"""Stdlib-only tests: `python3 -m unittest discover -s tests`.

deploy_config must not import invoke (not a project dependency), which is
exactly why the config logic lives there rather than in tasks.py.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import deploy_config


class DefaultsTests(unittest.TestCase):
    """Defaults must reproduce today's .191 behaviour byte for byte —
    Tild's `inv release` runs with no env vars set and must not change."""

    def test_registry_defaults_to_191(self):
        self.assertEqual(deploy_config.registry({}), "192.168.0.191:5000")

    def test_prod_host_defaults_to_191(self):
        self.assertEqual(deploy_config.prod_host({}), "192.168.0.191")

    def test_not_local_by_default(self):
        self.assertFalse(deploy_config.is_local({}))

    def test_buildx_enabled_by_default(self):
        self.assertTrue(deploy_config.use_buildx({}))


class OverrideTests(unittest.TestCase):
    def test_registry_override(self):
        self.assertEqual(
            deploy_config.registry({"BUDGETER_REGISTRY": "localhost:5000"}),
            "localhost:5000",
        )

    def test_prod_host_override(self):
        self.assertEqual(
            deploy_config.prod_host({"BUDGETER_PROD_HOST": "192.168.0.137"}),
            "192.168.0.137",
        )

    def test_local_mode_enabled_by_exactly_one(self):
        self.assertTrue(deploy_config.is_local({"BUDGETER_DEPLOY_LOCAL": "1"}))
        self.assertFalse(deploy_config.is_local({"BUDGETER_DEPLOY_LOCAL": "0"}))
        self.assertFalse(deploy_config.is_local({"BUDGETER_DEPLOY_LOCAL": ""}))

    def test_buildx_disabled_by_zero(self):
        self.assertFalse(deploy_config.use_buildx({"BUDGETER_BUILDX": "0"}))


class StackDirTests(unittest.TestCase):
    def test_prod_has_no_suffix(self):
        self.assertEqual(deploy_config.stack_dir("prod"), "/opt/stacks/budgeter")

    def test_demo_is_suffixed(self):
        self.assertEqual(deploy_config.stack_dir("demo"), "/opt/stacks/budgeter-demo")


class EnvLinesTests(unittest.TestCase):
    def test_prod_env_lines(self):
        self.assertEqual(
            deploy_config.env_lines("prod", "abc1234"),
            [
                "APP_ENV=prod",
                "IMAGE_TAG=abc1234",
                "BUDGETER_PORT=8080",
                "COMPOSE_PROJECT_NAME=budgeter",
            ],
        )

    def test_demo_env_lines(self):
        self.assertEqual(
            deploy_config.env_lines("demo", "abc1234"),
            [
                "APP_ENV=demo",
                "IMAGE_TAG=abc1234",
                "BUDGETER_PORT=8081",
                "COMPOSE_PROJECT_NAME=budgeter-demo",
            ],
        )

    def test_app_env_is_first_and_drives_secret_decryption(self):
        # APP_ENV is the -e argument to `envars exec` in the Dockerfile CMD:
        # it selects WHICH environment's secrets get decrypted at boot.
        self.assertTrue(deploy_config.env_lines("demo", "x")[0].startswith("APP_ENV="))

    def test_unknown_env_raises(self):
        with self.assertRaises(KeyError):
            deploy_config.env_lines("staging", "abc1234")


if __name__ == "__main__":
    unittest.main()

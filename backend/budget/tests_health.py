import os
from unittest import mock

from django.test import TestCase


class HealthEndpointTests(TestCase):
    """The deploy pipeline polls /api/health to decide whether to roll back,
    so it must answer without a session — the rest of the API uses
    NinjaAPI(auth=django_auth), which would return 401 here."""

    def test_health_is_reachable_without_authentication(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_health_reports_the_build_sha(self):
        with mock.patch.dict(os.environ, {"GIT_SHA": "abc1234"}):
            response = self.client.get("/api/health")
        self.assertEqual(response.json()["sha"], "abc1234")

    def test_health_sha_falls_back_when_unset(self):
        # patch.dict without clear=True snapshots and restores os.environ, so
        # popping inside the block is safe and scoped to this test.
        with mock.patch.dict(os.environ):
            os.environ.pop("GIT_SHA", None)
            response = self.client.get("/api/health")
        self.assertEqual(response.json()["sha"], "unknown")

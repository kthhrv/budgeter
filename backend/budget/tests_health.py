import os
from unittest import mock

from django.test import TestCase

from .models import BudgetItem


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

    def test_health_sha_falls_back_when_empty_string(self):
        # `ENV GIT_SHA=${GIT_SHA}` off an unset build-arg bakes an EMPTY
        # STRING into the image, not an absent var — a plain `docker build .`
        # with no --build-arg hits this. os.environ.get(key, "x") only
        # substitutes on a missing key, not an empty value, so the fallback
        # must be `or "unknown"`.
        with mock.patch.dict(os.environ, {"GIT_SHA": ""}):
            response = self.client.get("/api/health")
        self.assertEqual(response.json()["sha"], "unknown")

    def test_health_probes_the_real_schema(self):
        # .exists() compiles to SELECT 1 and would pass against a schema
        # missing a real column; .first() selects every field the model
        # declares, so a removed/renamed column actually surfaces here.
        with mock.patch.object(
            BudgetItem.objects, "first", wraps=BudgetItem.objects.first
        ) as spy:
            response = self.client.get("/api/health")
        spy.assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_health_reports_degraded_on_database_error(self):
        with mock.patch.dict(os.environ, {"GIT_SHA": "deadbee"}):
            with mock.patch.object(
                BudgetItem.objects,
                "first",
                side_effect=Exception("no such column: budget_budgetitem.owner"),
            ):
                response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body["status"], "degraded")
        self.assertEqual(body["sha"], "deadbee")
        self.assertEqual(body["error"], "Exception")
        # No SQL, no exception message — this endpoint is unauthenticated.
        serialized = response.content.decode()
        self.assertNotIn("no such column", serialized)
        self.assertNotIn("budget_budgetitem", serialized)

    def test_health_reports_degraded_with_specific_exception_class_name(self):
        # A more realistic failure: a real OperationalError, not a bare
        # Exception — the reported name must reflect the actual type.
        from django.db import OperationalError

        with mock.patch.object(
            BudgetItem.objects,
            "first",
            side_effect=OperationalError("no such column: owner"),
        ):
            response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "OperationalError")

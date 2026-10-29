#!/usr/bin/env python3
"""منصة البناء الراقي — اختبار قبول الأداء بلا تبعيات خارجية."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
from datetime import datetime, timedelta
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.token = ""

    def request(self, method: str, path: str, body: dict | None = None):
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(f"{self.base_url}{path}", data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=15) as response:
                raw = response.read()
                content_type = response.headers.get("Content-Type", "")
                data = json.loads(raw) if raw and "json" in content_type else raw
                return response.status, data
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {error.code} {path}: {detail[:300]}") from error

    def get(self, path: str):
        status, data = self.request("GET", path)
        if status != 200:
            raise RuntimeError(f"GET {path} returned HTTP {status}")
        return data


class LoadTester:
    def __init__(self, base_url: str, threshold_ms: float):
        self.client = ApiClient(base_url)
        self.threshold_ms = threshold_ms
        self.results: list[dict] = []

    def _log(self, message: str):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def _measure(self, name: str, operation):
        started = time.perf_counter()
        try:
            result = operation()
            elapsed_ms = (time.perf_counter() - started) * 1000
            within_threshold = elapsed_ms < self.threshold_ms
            self.results.append({
                "name": name,
                "elapsed_ms": elapsed_ms,
                "status": "ok" if within_threshold else "slow",
            })
            marker = "✅" if within_threshold else "⚠️"
            self._log(f"  {marker} {name}: {elapsed_ms:.1f}ms")
            return result
        except Exception as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            self.results.append({
                "name": name,
                "elapsed_ms": elapsed_ms,
                "status": "error",
                "error": str(error),
            })
            self._log(f"  ❌ {name}: {error}")
            return None

    def login(self, username: str, password: str):
        self._log("تسجيل الدخول...")
        status, data = self.client.request(
            "POST", "/auth/login", {"username": username, "password": password}
        )
        if status != 200 or not isinstance(data, dict) or not data.get("accessToken"):
            raise RuntimeError("تعذر تسجيل الدخول لحساب اختبار الأداء")
        self.client.token = data["accessToken"]
        self._log(f"  ✅ تم تسجيل الدخول: {data.get('user', {}).get('fullName', username)}")

    def discover_collector_id(self) -> str | None:
        collectors = self.client.get("/collectors")
        if not isinstance(collectors, list):
            return None
        selected = next((item for item in collectors if item.get("active", True)), None)
        selected = selected or (collectors[0] if collectors else None)
        return selected.get("id") if selected else None

    def test_health_endpoints(self):
        self._log("── فحوصات الصحة ──")
        for endpoint in ("/health", "/health/live", "/health/ready", "/health/database"):
            self._measure(f"GET {endpoint}", lambda path=endpoint: self.client.get(path))

    def test_dashboard_performance(self, collector_id: str | None):
        self._log("── أداء لوحة التحكم ──")
        self._measure("GET /dashboard/summary", lambda: self.client.get("/dashboard/summary"))
        self._measure("GET /dashboard/kpis", lambda: self.client.get("/dashboard/kpis"))
        if collector_id:
            query = urlencode({"collectorId": collector_id})
            self._measure(
                "GET /dashboard/collector",
                lambda: self.client.get(f"/dashboard/collector?{query}"),
            )
        else:
            self._log("  ℹ️ لا يوجد محصل نشط؛ تم تخطي لوحة المحصل")

    def test_customers_list(self):
        self._log("── أداء قائمة العملاء ──")
        for limit in (25, 50, 100):
            self._measure(
                f"GET /customers?limit={limit}",
                lambda page_size=limit: self.client.get(f"/customers?limit={page_size}"),
            )

    def test_search_performance(self):
        self._log("── أداء البحث ──")
        for term in ("محمد", "أحمد", "علي", "PERF-000100"):
            query = urlencode({"search": term, "limit": 10})
            self._measure(
                f"GET /customers?search={term}",
                lambda value=query: self.client.get(f"/customers?{value}"),
            )
        global_query = quote("PERF-000100")
        self._measure("GET /search", lambda: self.client.get(f"/search?q={global_query}"))

    def test_collections_performance(self):
        self._log("── أداء التحصيلات ──")
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        for label, start in (("today", today), ("week", week_ago)):
            query = urlencode({"fromDate": start, "toDate": today, "limit": 50})
            self._measure(
                f"GET /collections ({label})",
                lambda value=query: self.client.get(f"/collections?{value}"),
            )

    def test_concurrent_requests(self, count: int):
        self._log(f"── طلبات متزامنة ({count}) ──")

        def make_request(index: int):
            # urllib's shared global opener can serialize or stall concurrent calls.
            # Give every worker an independent client while reusing only the token.
            worker_client = ApiClient(self.client.base_url)
            worker_client.token = self.client.token
            started = time.perf_counter()
            worker_client.get("/customers?limit=25")
            return index, (time.perf_counter() - started) * 1000

        with concurrent.futures.ThreadPoolExecutor(max_workers=count) as executor:
            timings = [elapsed for _, elapsed in executor.map(make_request, range(count))]
        average = sum(timings) / len(timings)
        maximum = max(timings)
        status = "ok" if maximum < self.threshold_ms else "slow"
        self.results.append({"name": f"concurrent customers x{count}", "elapsed_ms": maximum, "status": status})
        marker = "✅" if status == "ok" else "⚠️"
        self._log(f"  {marker} متوسط: {average:.1f}ms — أعلى: {maximum:.1f}ms")

    def print_report(self) -> bool:
        print("\n" + "=" * 60)
        print("تقرير اختبار قبول الأداء")
        print("=" * 60)
        errors = [result for result in self.results if result["status"] == "error"]
        slow = [result for result in self.results if result["status"] == "slow"]
        successful = [result for result in self.results if result["status"] == "ok"]
        print(f"إجمالي الاختبارات: {len(self.results)}")
        print(f"ضمن {self.threshold_ms:.0f}ms: {len(successful)}")
        print(f"بطيئة: {len(slow)}")
        print(f"فاشلة: {len(errors)}")
        if self.results:
            times = [result["elapsed_ms"] for result in self.results]
            print(f"أعلى زمن: {max(times):.1f}ms")
        for result in slow + errors:
            detail = result.get("error") or f"{result['elapsed_ms']:.1f}ms"
            print(f"  ❌ {result['name']}: {detail}")
        passed = not slow and not errors
        print("🟢 النتيجة: ناجح" if passed else "🔴 النتيجة: غير ناجح")
        print("=" * 60)
        return passed


def main() -> int:
    parser = argparse.ArgumentParser(description="اختبار قبول أداء منصة البناء الراقي")
    parser.add_argument("--base-url", default="http://localhost:18000")
    parser.add_argument("--admin-password", required=True)
    parser.add_argument("--username", default="admin")
    parser.add_argument("--concurrent", type=int, default=10)
    parser.add_argument("--threshold-ms", type=float, default=500)
    args = parser.parse_args()

    tester = LoadTester(args.base_url, args.threshold_ms)
    try:
        tester.login(args.username, args.admin_password)
        collector_id = tester.discover_collector_id()
        tester.test_health_endpoints()
        tester.test_dashboard_performance(collector_id)
        tester.test_customers_list()
        tester.test_search_performance()
        tester.test_collections_performance()
        tester.test_concurrent_requests(args.concurrent)
    except Exception as error:
        print(f"\n❌ خطأ حرج: {error}")
        return 1
    return 0 if tester.print_report() else 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())

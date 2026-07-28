#!/usr/bin/env python3
"""
منصة البناء الراقي — Load Test Script
اختبار التحمل على بيانات كبيرة

الاستخدام:
  python scripts/load_test.py --base-url http://localhost:18000 --admin-password ChangeMe!2026

المتطلبات:
  pip install requests
"""
import argparse
import json
import random
import string
import sys
import time
from datetime import datetime, timedelta

try:
    import requests
except ImportError:
    print("ERROR: pip install requests")
    sys.exit(1)


class LoadTester:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.results = []

    def _log(self, msg: str):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    def _measure(self, name: str, func):
        t0 = time.time()
        try:
            result = func()
            elapsed = time.time() - t0
            self.results.append({"name": name, "elapsed": elapsed, "status": "ok"})
            self._log(f"  ✅ {name}: {elapsed:.3f}s")
            return result
        except Exception as e:
            elapsed = time.time() - t0
            self.results.append({"name": name, "elapsed": elapsed, "status": "error", "error": str(e)})
            self._log(f"  ❌ {name}: {elapsed:.3f}s — {e}")
            return None

    def login(self, username: str, password: str):
        self._log("تسجيل الدخول...")
        resp = requests.post(
            f"{self.base_url}/auth/login",
            json={"username": username, "password": password},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self.headers["Authorization"] = f"Bearer {data['accessToken']}"
        self._log(f"  ✅ تم تسجيل الدخول: {data.get('user', {}).get('fullName', username)}")
        return data

    def test_health_endpoints(self):
        self._log("── فحوصات الصحة ──")
        for endpoint in ["/health", "/health/live", "/health/ready", "/health/database"]:
            self._measure(f"GET {endpoint}", lambda ep=endpoint: requests.get(
                f"{self.base_url}{ep}", timeout=5
            ))

    def test_dashboard_performance(self):
        self._log("── أداء لوحة التحكم ──")
        self._measure("GET /dashboard/summary", lambda: requests.get(
            f"{self.base_url}/dashboard/summary", headers=self.headers, timeout=10
        ))
        self._measure("GET /dashboard/collector", lambda: requests.get(
            f"{self.base_url}/dashboard/collector", headers=self.headers, timeout=10
        ))

    def test_customers_list(self):
        self._log("── أداء قائمة العملاء ──")
        for limit in [25, 50, 100]:
            self._measure(f"GET /customers?limit={limit}", lambda l=limit: requests.get(
                f"{self.base_url}/customers?limit={l}", headers=self.headers, timeout=10
            ))

    def test_search_performance(self):
        self._log("── أداء البحث ──")
        search_terms = ["محمد", "أحمد", "علي", "عمر", "خالد"]
        for term in search_terms:
            self._measure(f"GET /customers?q={term}", lambda t=term: requests.get(
                f"{self.base_url}/customers?q={t}&limit=10", headers=self.headers, timeout=10
            ))

    def test_collections_performance(self):
        self._log("── أداء التحصيلات ──")
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        self._measure("GET /collections (today)", lambda: requests.get(
            f"{self.base_url}/collections?fromDate={today}&toDate={today}&limit=50",
            headers=self.headers, timeout=10
        ))
        self._measure("GET /collections (week)", lambda: requests.get(
            f"{self.base_url}/collections?fromDate={week_ago}&toDate={today}&limit=50",
            headers=self.headers, timeout=10
        ))

    def test_concurrent_requests(self, count: int = 10):
        self._log(f"── طلبات متزامنة ({count}) ──")
        import concurrent.futures

        def make_request(i):
            t0 = time.time()
            resp = requests.get(
                f"{self.base_url}/customers?limit=25",
                headers=self.headers, timeout=10
            )
            return {"i": i, "status": resp.status_code, "elapsed": time.time() - t0}

        with concurrent.futures.ThreadPoolExecutor(max_workers=count) as executor:
            futures = [executor.submit(make_request, i) for i in range(count)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        avg = sum(r["elapsed"] for r in results) / len(results)
        success = sum(1 for r in results if r["status"] == 200)
        self._log(f"  نجاح: {success}/{count} — متوسط: {avg:.3f}s")

    def print_report(self):
        print("\n" + "=" * 60)
        print("تقرير اختبار التحمل")
        print("=" * 60)

        ok = [r for r in self.results if r["status"] == "ok"]
        err = [r for r in self.results if r["status"] == "error"]

        print(f"إجمالي الاختبارات: {len(self.results)}")
        print(f"ناجحة: {len(ok)}")
        print(f"فاشلة: {len(err)}")

        if ok:
            times = [r["elapsed"] for r in ok]
            print(f"\nأزمنة الاستجابة:")
            print(f"  أقل:  {min(times):.3f}s")
            print(f"  متوسط: {sum(times)/len(times):.3f}s")
            print(f"  أكثر: {max(times):.3f}s")

        if err:
            print(f"\nأخطاء:")
            for r in err:
                print(f"  ❌ {r['name']}: {r.get('error', 'unknown')}")

        print("=" * 60)

        # Performance verdict
        if ok:
            avg = sum(r["elapsed"] for r in ok) / len(ok)
            if avg < 0.5:
                print("🟢 الأداء: ممتاز (متوسط < 500ms)")
            elif avg < 1.0:
                print("🟡 الأداء: جيد (متوسط < 1s)")
            elif avg < 2.0:
                print("🟠 الأداء: مقبول (متوسط < 2s)")
            else:
                print("🔴 الأداء: بطيء (متوسط > 2s) — يحتاج تحسين")


def main():
    parser = argparse.ArgumentParser(description="Load test for Albinaa Platform")
    parser.add_argument("--base-url", default="http://localhost:18000")
    parser.add_argument("--admin-password", default="ChangeMe!2026")
    parser.add_argument("--concurrent", type=int, default=10)
    args = parser.parse_args()

    tester = LoadTester(args.base_url, "")

    try:
        tester.login("admin", args.admin_password)
        tester.test_health_endpoints()
        tester.test_dashboard_performance()
        tester.test_customers_list()
        tester.test_search_performance()
        tester.test_collections_performance()
        tester.test_concurrent_requests(args.concurrent)
    except Exception as e:
        print(f"\n❌ خطأ حرج: {e}")

    tester.print_report()


if __name__ == "__main__":
    main()

import assert from "node:assert/strict";
import test from "node:test";
import worker from "../apps/api/src/index.js";

function makeAnalyticsDatabase() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          calls.push({ sql, values: this.values });
          return { views: 27 };
        },
        async all() {
          calls.push({ sql, values: this.values });
          if (sql.includes("GROUP BY country")) return { results: [{ country: "VN", views: 20 }, { country: "ZZ", views: 7 }] };
          if (sql.includes("GROUP BY operating_system")) return { results: [{ name: "Android", views: 15 }, { name: "Windows", views: 12 }] };
          if (sql.includes("GROUP BY day")) return { results: [{ day: "2026-10-13", views: 27 }] };
          return { results: [] };
        },
        async run() {
          calls.push({ sql, values: this.values });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
}

test("analytics API requires admin authentication", async () => {
  const DB = makeAnalyticsDatabase();
  const response = await worker.fetch(new Request("https://shop.test/api/admin/analytics"), {
    DB,
    ADMIN_TOKEN: "test-admin-token"
  });
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});
test("analytics API returns aggregated counts for an allowed date range", async () => {
  const DB = makeAnalyticsDatabase();
  const response = await worker.fetch(new Request("https://shop.test/api/admin/analytics?days=30", {
    headers: { authorization: "Bearer test-admin-token" }
  }), {
    DB,
    ADMIN_TOKEN: "test-admin-token"
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.days, 30);
  assert.equal(result.views, 27);
  assert.deepEqual(result.countries, [{ country: "VN", views: 20 }, { country: "ZZ", views: 7 }]);
  assert.deepEqual(result.operatingSystems, [{ name: "Android", views: 15 }, { name: "Windows", views: 12 }]);
  assert.equal(result.timeline[0].day, "2026-10-13");
  assert.equal(DB.calls.length, 4);
  assert.ok(DB.calls.every(({ values }) => values[0] === "-29 days"));
});

test("analytics API rejects unbounded or unsupported ranges", async () => {
  const response = await worker.fetch(new Request("https://shop.test/api/admin/analytics?days=365", {
    headers: { authorization: "Bearer test-admin-token" }
  }), {
    DB: makeAnalyticsDatabase(),
    ADMIN_TOKEN: "test-admin-token"
  });
  assert.equal(response.status, 400);
});

test("storefront page view stores only daily country and OS aggregates", async () => {
  const DB = makeAnalyticsDatabase();
  const tasks = [];
  const request = new Request("https://shop.test/", {
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (Linux; Android 14) Mobile secret-user-agent" }
  });
  const response = await worker.fetch(request, {
    DB,
    ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }) }
  }, {
    waitUntil(promise) { tasks.push(promise); }
  });
  await Promise.all(tasks);
  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /INSERT INTO pageview_daily/);
  assert.deepEqual(DB.calls[0].values.slice(1), ["ZZ", "Android"]);
  assert.doesNotMatch(JSON.stringify(DB.calls), /secret-user-agent/);
  assert.doesNotMatch(DB.calls[0].sql, /ip|user.agent|cookie/i);
});

test("storefront dashboard and home views count while admin pages and assets do not", async () => {
  const DB = makeAnalyticsDatabase();
  const tasks = [];
  const assets = { fetch: async () => new Response("asset") };
  for (const path of ["/admin.html", "/admin.css", "/dashboard", "/"]) {
    await worker.fetch(new Request(`https://shop.test${path}`, {
      headers: { accept: "text/html" }
    }), { DB, ASSETS: assets }, { waitUntil(promise) { tasks.push(promise); } });
  }
  await Promise.all(tasks);
  assert.equal(DB.calls.length, 2);
  assert.ok(DB.calls.every(({ sql }) => sql.includes("INSERT INTO pageview_daily")));
});

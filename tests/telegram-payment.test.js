import assert from "node:assert/strict";
import test from "node:test";
import worker from "../apps/api/src/index.js";

const chatId = "5032505212";
const webhookSecret = "test-webhook-secret";
const orderStatusSecret = "test-order-status-secret-that-is-long-enough";

function makeDatabase() {
  const calls = { runs: [], batches: [] };
  return {
    calls,
    prepare(sql) {
      let args = [];
      return {
        sql,
        bind(...values) { args = values; return this; },
        async first() {
          if (sql.startsWith("SELECT id, name, price, stock FROM products")) return { id: args[0], name: "Cà chua vườn", price: 32000, stock: 10 };
          if (sql.startsWith("INSERT INTO customers")) return { id: 5 };
          if (sql.startsWith("INSERT INTO orders")) return { id: 21 };
          if (sql.startsWith("SELECT id, payment_method, payment_status, status FROM orders")) return { id: args[0], payment_method: "vietqr", payment_status: "pending", status: "pending" };
          if (sql.startsWith("SELECT id, status, payment_status FROM orders")) return { id: args[0], status: "pending", payment_status: "pending" };
          return null;
        },
        async run() { calls.runs.push({ sql, args }); return { meta: { changes: 1 } }; }
      };
    },
    async batch(statements) {
      calls.batches.push(statements.map(({ sql, args }) => ({ sql, args })));
      return statements.map((_, index) => ({ meta: { changes: index === 0 ? 1 : 1 } }));
    }
  };
}

function makeEnv(DB, overrides = {}) {
  return {
    DB,
    ASSETS: { fetch: async () => new Response("asset") },
    VIETQR_BANK_ID: "970415",
    VIETQR_ACCOUNT_NUMBER: "0975150984",
    VIETQR_ACCOUNT_NAME: "TRUONG QUANG HUY",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_ADMIN_CHAT_ID: chatId,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    ORDER_STATUS_SECRET: orderStatusSecret,
    ...overrides
  };
}

function telegramFetchMock(calls) {
  return async (input, options) => {
    calls.push({ url: String(input), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), { status: 200 });
  };
}

test("VietQR orders send an approval message with Telegram buttons", async () => {
  const DB = makeDatabase();
  const telegramCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = telegramFetchMock(telegramCalls);
  try {
    const response = await worker.fetch(new Request("https://shop.test/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Nguyễn An", phone: "0900000000", email: "an@example.com", address: "Hà Nội" },
        paymentMethod: "vietqr",
        items: [{ productId: 2, quantity: 2 }]
      })
    }), makeEnv(DB));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.payment.adminNotification, "sent");
    assert.equal(telegramCalls.length, 1);
    assert.match(telegramCalls[0].url, /sendMessage$/);
    assert.equal(telegramCalls[0].body.chat_id, chatId);
    assert.deepEqual(telegramCalls[0].body.reply_markup.inline_keyboard[0].map((button) => button.callback_data), ["pay:approve:21", "pay:reject:21"]);
    assert.match(telegramCalls[0].body.text, /CHONHA21/);
    assert.match(telegramCalls[0].body.text, /Hà Nội/);
  } finally { globalThis.fetch = originalFetch; }
});

test("VietQR order reports failed Telegram notification without losing the order", async () => {
  const DB = makeDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 500 });
  try {
    const response = await worker.fetch(new Request("https://shop.test/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Nguyễn An", phone: "0900000000", email: "an@example.com", address: "Hà Nội" },
        paymentMethod: "vietqr",
        items: [{ productId: 2, quantity: 1 }]
      })
    }), makeEnv(DB));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.id, 21);
    assert.equal(body.payment.adminNotification, "failed");
  } finally { globalThis.fetch = originalFetch; }
});

test("VietQR order does not send Telegram approval buttons without a webhook secret", async () => {
  const DB = makeDatabase();
  const telegramCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = telegramFetchMock(telegramCalls);
  try {
    const response = await worker.fetch(new Request("https://shop.test/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Nguyễn An", phone: "0900000000", email: "an@example.com", address: "Hà Nội" },
        paymentMethod: "vietqr",
        items: [{ productId: 2, quantity: 1 }]
      })
    }), makeEnv(DB, { TELEGRAM_WEBHOOK_SECRET: undefined }));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.payment.adminNotification, "not_configured");
    assert.equal(telegramCalls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("Telegram webhook rejects an invalid secret before reading callback data", async () => {
  const DB = makeDatabase();
  const response = await worker.fetch(new Request("https://shop.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong" },
    body: JSON.stringify({ callback_query: { data: "pay:approve:21" } })
  }), makeEnv(DB));
  assert.equal(response.status, 401);
  assert.equal(DB.calls.runs.length, 0);
});

test("Telegram approval confirms the order only for the configured admin", async () => {
  const DB = makeDatabase();
  const telegramCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = telegramFetchMock(telegramCalls);
  try {
    const response = await worker.fetch(new Request("https://shop.test/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
      body: JSON.stringify({ callback_query: {
        id: "callback-1",
        from: { id: Number(chatId) },
        message: { message_id: 10, chat: { id: Number(chatId) } },
        data: "pay:approve:21"
      } })
    }), makeEnv(DB));
    assert.equal(response.status, 200);
    assert.match(DB.calls.runs[0].sql, /payment_status = 'paid', status = 'confirmed'/);
    assert.equal(DB.calls.runs[0].args[0], 21);
    assert.equal(telegramCalls.length, 2);
    assert.match(telegramCalls[1].url, /editMessageText$/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Telegram refusal cancels a pending order and releases stock once", async () => {
  const DB = makeDatabase();
  const telegramCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = telegramFetchMock(telegramCalls);
  try {
    const response = await worker.fetch(new Request("https://shop.test/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
      body: JSON.stringify({ callback_query: {
        id: "callback-2",
        from: { id: Number(chatId) },
        message: { message_id: 10, chat: { id: Number(chatId) } },
        data: "pay:reject:21"
      } })
    }), makeEnv(DB));
    assert.equal(response.status, 200);
    assert.equal(DB.calls.batches.length, 1);
    assert.match(DB.calls.batches[0][0].sql, /status = 'cancelled', payment_status = 'unpaid', stock_released = 2/);
    assert.match(DB.calls.batches[0][1].sql, /stock = stock \+/);
    assert.match(DB.calls.batches[0][1].sql, /payment_status = 'unpaid'/);
    assert.match(DB.calls.batches[0][2].sql, /stock_released = 1/);
    assert.equal(telegramCalls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("Telegram callback from another chat/user cannot review an order", async () => {
  const DB = makeDatabase();
  const response = await worker.fetch(new Request("https://shop.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
    body: JSON.stringify({ callback_query: {
      id: "callback-3",
      from: { id: 9001 },
      message: { message_id: 10, chat: { id: Number(chatId) } },
      data: "pay:approve:21"
    } })
  }), makeEnv(DB));
  assert.equal(response.status, 403);
  assert.equal(DB.calls.runs.length, 0);
});

test("Order status requires a valid per-order signature", async () => {
  const DB = makeDatabase();
  const denied = await worker.fetch(new Request("https://shop.test/api/orders/21", { method: "GET" }), makeEnv(DB));
  assert.equal(denied.status, 401);
  assert.equal(DB.calls.runs.length, 0);

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(orderStatusSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("21")));
  const token = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const response = await worker.fetch(new Request("https://shop.test/api/orders/21", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  }), makeEnv(DB));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.id, 21);
  assert.equal(data.status, "pending");
  assert.deepEqual(Object.keys(data).sort(), ["id", "payment_status", "status"]);

  const wrongOrder = await worker.fetch(new Request("https://shop.test/api/orders/22", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  }), makeEnv(DB));
  assert.equal(wrongOrder.status, 401);
});

test("Telegram webhook rejects callbacks when TELEGRAM_WEBHOOK_SECRET is missing", async () => {
  const DB = makeDatabase();
  const response = await worker.fetch(new Request("https://shop.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query: {
      id: "callback-local",
      from: { id: Number(chatId) },
      message: { message_id: 10, chat: { id: Number(chatId) } },
      data: "pay:approve:21"
    } })
  }), makeEnv(DB, { TELEGRAM_WEBHOOK_SECRET: undefined }));
  assert.equal(response.status, 503);
  assert.equal(DB.calls.runs.length, 0);
});

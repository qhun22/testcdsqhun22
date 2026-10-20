const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const error = (message, status = 400) => json({ error: message }, status);
const slugify = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const adminPath = (path) => path.startsWith("/api/admin/");
const normalizeText = (value) => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
const chatUsage = new Map();
const hasOrderStatusSecret = (secret) => typeof secret === "string" && new TextEncoder().encode(secret).length >= 32;
const orderStatusSecret = (env) => [env.ORDER_STATUS_SECRET, env.TELEGRAM_WEBHOOK_SECRET].find(hasOrderStatusSecret);

function operatingSystem(userAgent = "") {
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Khác";
}

const transferCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomTransferCode() {
  const chars = [];
  const random = new Uint8Array(24);
  while (chars.length < 6) {
    crypto.getRandomValues(random);
    for (const value of random) {
      if (value >= 252) continue;
      chars.push(transferCodeAlphabet[value % transferCodeAlphabet.length]);
      if (chars.length === 6) break;
    }
  }
  return chars.join("");
}

// ─── Big Data Pipeline: Stream → Pipeline → Sink → Basin Catalog ─────────────
//
// Kiến trúc:
//   [Website/Chatbot] → POST /api/events          (Stream: HTTP endpoint)
//   → pipeline()                                  (Pipeline: transform + enrich)
//   → sinkToR2()      R2 phân vùng Iceberg-style  (Sink: Data Lake raw storage)
//   → sinkToAnalyticsEngine()                     (Basin: time-series catalog)
//   → sinkChatbotToD1()                           (Basin: structured SQL query)
//
// R2 Data Catalog (Basin Catalog) đã bật tại:
//   https://catalog.cloudflarestorage.com/c0569221e44f432f6669b8df70446872/cho-nha-data-lake
// ─────────────────────────────────────────────────────────────────────────────

// Tầng PIPELINE: validate và enrich raw event gửi từ frontend thành structured event
function pipeline(rawEvent, request) {
  const country = /^[A-Z]{2}$/.test(request.cf?.country || "") ? request.cf.country : "ZZ";
  const os = operatingSystem(request.headers.get("user-agent") || "");
  const ts = new Date().toISOString();
  const type = String(rawEvent?.type || "");
  if (!["page_view", "chatbot_message"].includes(type)) return null;

  if (type === "page_view") {
    return { type, ts, country, os, page: "home" };
  }

  // chatbot_message — lưu thêm preview nội dung (tối đa 80 ký tự)
  const messageLen = Math.min(500, Math.max(0, Number(rawEvent?.messageLen) || 0));
  const hasProductResult = rawEvent?.hasProductResult ? 1 : 0;
  const sessionId = String(rawEvent?.sessionId || "").slice(0, 64);
  const messagePreview = String(rawEvent?.messagePreview || "").slice(0, 80);
  return { type, ts, country, os, messageLen, hasProductResult, sessionId, messagePreview };
}

// Tầng SINK 1 — R2 Data Lake (Basin Catalog đã bật / Apache Iceberg-style)
// Phân vùng key: events/type=.../year=.../month=.../day=.../hour=.../<ts>.ndjson
// Mỗi object = 1 NDJSON record → Iceberg query engine (Spark, PyIceberg) có thể đọc trực tiếp
async function sinkToR2(env, structuredEvent) {
  if (!env.DATA_LAKE) return;
  const now = new Date(structuredEvent.ts);
  const year  = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day   = String(now.getUTCDate()).padStart(2, "0");
  const hour  = String(now.getUTCHours()).padStart(2, "0");
  const safeTs = structuredEvent.ts.replace(/[:.]/g, "-");
  const key = `events/type=${structuredEvent.type}/year=${year}/month=${month}/day=${day}/hour=${hour}/${safeTs}.ndjson`;
  const line = JSON.stringify(structuredEvent) + "\n";
  try {
    await env.DATA_LAKE.put(key, line, {
      httpMetadata: { contentType: "application/x-ndjson" },
      customMetadata: {
        event_type: structuredEvent.type,
        country: structuredEvent.country,
        os: structuredEvent.os
      }
    });
  } catch (exception) {
    console.error("R2 sink failed", exception.name);
  }
}

// Tầng SINK 2 — Analytics Engine (Basin: time-series catalog, query bằng SQL trong Dashboard)
// Schema: blob1=type, blob2=country, blob3=os, blob4=page
//         double1=count, double2=messageLen, double3=hasProductResult
function sinkToAnalyticsEngine(env, structuredEvent) {
  if (!env.ANALYTICS_ENGINE) return;
  try {
    env.ANALYTICS_ENGINE.writeDataPoint({
      blobs: [
        structuredEvent.type,
        structuredEvent.country,
        structuredEvent.os,
        structuredEvent.page || ""
      ],
      doubles: [
        1,
        structuredEvent.messageLen || 0,
        structuredEvent.hasProductResult || 0
      ],
      indexes: [structuredEvent.type]
    });
  } catch (exception) {
    console.error("Analytics Engine sink failed", exception.name);
  }
}

// Tầng SINK 3 — D1 chatbot_events (Basin: structured SQL để hiện trên Admin Dashboard)
async function sinkChatbotToD1(env, structuredEvent) {
  if (structuredEvent.type !== "chatbot_message") return;
  try {
    await env.DB.prepare(
      "INSERT INTO chatbot_events (ts, country, operating_system, message_len, has_product_result, session_id, message_preview) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      structuredEvent.ts,
      structuredEvent.country,
      structuredEvent.os,
      structuredEvent.messageLen,
      structuredEvent.hasProductResult,
      structuredEvent.sessionId,
      structuredEvent.messagePreview
    ).run();
  } catch (exception) {
    console.error("D1 chatbot sink failed", exception.name);
  }
}

// Entry point: nhận raw event từ Stream, chạy qua Pipeline → fan-out 3 Sink song song
async function runPipeline(rawEvent, request, env) {
  const structured = pipeline(rawEvent, request);
  if (!structured) return;
  await Promise.all([
    sinkToR2(env, structured),
    Promise.resolve(sinkToAnalyticsEngine(env, structured)),
    sinkChatbotToD1(env, structured)
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────

async function recordPageView(request, env) {
  const country = /^[A-Z]{2}$/.test(request.cf?.country || "") ? request.cf.country : "ZZ";
  const os = operatingSystem(request.headers.get("user-agent") || "");
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO pageview_daily (day, country, operating_system, page, views) VALUES (?, ?, ?, 'home', 1) ON CONFLICT(day, country, operating_system, page) DO UPDATE SET views = views + 1")
    .bind(day, country, os).run();
}

function allowChatRequest(request) {
  const now = Date.now();
  const key = request.headers.get("cf-connecting-ip") || "local";
  const current = chatUsage.get(key);
  if (current && now - current.startedAt < 60_000 && current.count >= 12) return false;
  if (!current || now - current.startedAt >= 60_000) chatUsage.set(key, { startedAt: now, count: 1 });
  else current.count += 1;
  if (chatUsage.size > 1000) {
    for (const [address, usage] of chatUsage) if (now - usage.startedAt >= 60_000) chatUsage.delete(address);
  }
  return true;
}

function fallbackChatReply(message, products, productIntent) {
  const normalized = normalizeText(message);
  if (products.length) return `Mình tìm thấy ${products.length} sản phẩm phù hợp bên dưới. Bạn có thể chọn món để tạo đơn và quét mã VietQR thanh toán ngay tại đây hoặc thêm vào giỏ.`;
  if (productIntent) return "Mình chưa tìm thấy sản phẩm còn hàng phù hợp. Bạn thử một tên món khác hoặc từ khóa ngắn hơn nhé.";
  if (/online|truc tuyen|vietqr|momo|vnpay/.test(normalized)) return "Dạ! Bạn có thể chọn món và thanh toán online trực tiếp qua VietQR ngay tại khung chat này hoặc qua giỏ hàng. Sau khi tạo đơn, mã VietQR sẽ hiển thị ngay với số tiền và nội dung chuyển khoản chính xác để bạn quét thanh toán.";
  if (/thanh toan|chuyen khoan|cod|tien mat/.test(normalized)) return "Dạ! Cửa hàng hỗ trợ chuyển khoản VietQR trực tiếp qua khung chat hoặc thanh toán khi nhận hàng (COD) và chuyển khoản qua giỏ hàng. Bạn muốn thanh toán theo cách nào?";
  if (/dat hang|mua hang|don hang|gio hang/.test(normalized)) return "Dạ! Bạn có thể chọn món và thanh toán trực tiếp ngay trong chatbot, hoặc thêm vào giỏ hàng rồi bấm Đặt hàng nhé.";
  if (/giao hang|phi ship|van chuyen|thoi gian giao/.test(normalized)) return "Dạ! Cửa hàng hiện chưa hiển thị phí hoặc thời gian giao hàng cụ thể. Bạn có thể gửi địa chỉ trong đơn để cửa hàng xác nhận.";
  if (/doi tra|hoan tien|huy don/.test(normalized)) return "Dạ! Mình chưa có thông tin chính sách đổi trả hoặc hủy đơn. Bạn vui lòng liên hệ cửa hàng để được xác nhận.";
  return "Dạ! Mình có thể giúp tìm sản phẩm, hướng dẫn đặt hàng và giải đáp về thanh toán. Bạn thử hỏi tên món cần tìm hoặc cách đặt đơn nhé.";
}

async function chat(request, env) {
  if (!allowChatRequest(request)) return error("Bạn gửi tin nhắn hơi nhanh. Vui lòng thử lại sau một phút nhé.", 429);
  const body = await readBody(request);
  const message = String(body?.message || "").trim();
  if (!message || message.length > 500) return error("Tin nhắn cần có nội dung và không dài quá 500 ký tự.");

  const normalized = normalizeText(message);
  const capabilityQuestion = /ho tro gi|ho tro duoc gi|lam duoc gi|giup duoc gi/.test(normalized);
  const onlinePaymentQuestion = /online|truc tuyen|vietqr|momo|vnpay/.test(normalized);
  const deliveryQuestion = /phi ship|phi giao|giao hang|van chuyen|thoi gian giao/.test(normalized);
  const productIntent = !deliveryQuestion && /\b(tim|mua|gia|goi y|san pham|mon|co ban|rau|cu|trai cay|thit|ca|gao|sua|banh)\b/.test(normalized);
  const ignored = new Set("ban minh toi muon can tim cho hoi xem co con hang khong giup voi la cac loai nao nao gia bao nhieu san pham san pham loai mon an mon ngon cua va hay".split(" "));
  const terms = (message.match(/[\p{L}\p{N}]+/gu) || []).filter((term) => term.length > 1 && !ignored.has(normalizeText(term))).slice(0, 8);
  let products = [];
  if (productIntent && terms.length) {
    const conditions = terms.map(() => "(p.name LIKE ? OR p.description LIKE ?)").join(" OR ");
    const values = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
    const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.description, p.price, p.image_url, p.stock, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.stock > 0 AND (${conditions}) ORDER BY p.featured DESC, p.created_at DESC LIMIT 20`).bind(...values).all();
    products = results.map((product) => {
      const name = normalizeText(product.name);
      const description = normalizeText(product.description);
      const matchedTerms = terms.filter((term) => name.includes(normalizeText(term)) || description.includes(normalizeText(term))).length;
      return { ...product, matchedTerms, score: terms.reduce((score, term) => score + Number(name.includes(normalizeText(term))) * 2 + Number(description.includes(normalizeText(term))), 0) };
    }).filter((product) => product.matchedTerms >= Math.min(2, terms.length)).sort((left, right) => right.score - left.score).slice(0, 4).map(({ matchedTerms, score, ...product }) => product);
  }

  const history = Array.isArray(body.history) ? body.history.slice(-8).filter((entry) => ["user", "assistant"].includes(entry?.role) && typeof entry.content === "string").map((entry) => ({ role: entry.role, content: entry.content.slice(0, 500) })) : [];
  if (history.at(-1)?.role !== "user" || history.at(-1)?.content !== message) history.push({ role: "user", content: message });
  let reply = onlinePaymentQuestion
    ? fallbackChatReply(message, [], false)
    : capabilityQuestion ? "Mình có thể giúp bạn tìm sản phẩm còn hàng, xem giá, chọn món, hướng dẫn đặt hàng và giải đáp về thanh toán. Bạn muốn bắt đầu với việc nào?" : "";
  if (env.AI && !reply) {
    try {
      const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [
          { role: "system", content: `Bạn là trợ lý cửa hàng thực phẩm Chợ Nhà, luôn trả lời bằng tiếng Việt tự nhiên, ngắn gọn, thân thiện và xưng mình/bạn. Bạn có thể giúp khách tìm sản phẩm, xem giá, chọn món, hướng dẫn thêm vào giỏ và đặt hàng, hoặc giải đáp phương thức thanh toán. Nếu khách hỏi bạn hỗ trợ gì, hãy nêu ngắn gọn các việc trên thay vì nói không có thông tin. Khách chọn sản phẩm, chỉnh số lượng trong giỏ để xem báo giá, điền thông tin nhận hàng rồi chọn phương thức thanh toán. Cửa hàng hỗ trợ VietQR với số tiền và nội dung theo mã đơn; đơn chờ cửa hàng xác nhận thủ công sau khi kiểm tra tiền về, chưa có webhook tự động đối soát. Thanh toán khi nhận hàng và chuyển khoản thủ công vẫn khả dụng; MoMo và VNPay chưa khả dụng. Không nói VietQR đã được thanh toán nếu chưa có xác nhận của cửa hàng. Chỉ tư vấn sản phẩm trong danh sách còn hàng bên dưới. Không tự bịa phí hoặc thời gian giao, chính sách đổi trả, hay thông tin liên hệ; nếu chưa biết thì nói rõ cửa hàng cần xác nhận. Không xác nhận hoặc thay đổi đơn hàng. Sản phẩm còn hàng phù hợp với câu hỏi: ${JSON.stringify(products)}.` },
          ...history
        ],
        max_tokens: 220
      });
      reply = String(result?.response || "").trim();
    } catch (exception) { console.error("Workers AI chat unavailable", exception); }
  }
  return json({ reply: reply || fallbackChatReply(message, products, productIntent), products });
}

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed with HTTP ${response.status}.`);
  return result.result;
}

async function notifyTelegramOrder(env, order, customer, items) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET) return "not_configured";
  const itemLines = items.map((item) => `• ${item.name} × ${item.quantity} — ${item.price * item.quantity} VND`).join("\n");
  const text = [
    "Chợ Nhà · yêu cầu thanh toán VietQR",
    `Đơn #${order.id}`,
    `Khách: ${customer.name.trim()}`,
    `SĐT: ${customer.phone.trim()}`,
    `Địa chỉ: ${customer.address ? customer.address.trim() : "Chưa cung cấp"}`,
    "Sản phẩm:",
    itemLines,
    `Tổng tiền: ${order.total.toLocaleString("vi-VN")} VND`,
    `Nội dung chuyển khoản: ${order.transferCode}`
  ].join("\n");
  try {
    await telegramApi(env, "sendMessage", {
      chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Duyệt thanh toán", callback_data: `pay:approve:${order.id}` },
          { text: "❌ Từ chối", callback_data: `pay:reject:${order.id}` }
        ]]
      }
    });
    return "sent";
  } catch (exception) {
    console.error("Telegram order notification failed", exception.name);
    return "failed";
  }
}

async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET) return error("Telegram webhook chưa được cấu hình đầy đủ.", 503);
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return error("Webhook không hợp lệ.", 401);
  const update = await readBody(request);
  const callback = update?.callback_query;
  if (!callback) return json({ ok: true });
  const message = callback.message;
  const trustedChat = String(message?.chat?.id || "") === String(env.TELEGRAM_ADMIN_CHAT_ID);
  const trustedUser = String(callback.from?.id || "") === String(env.TELEGRAM_ADMIN_CHAT_ID);
  const action = String(callback.data || "").match(/^pay:(approve|reject):([1-9]\d*)$/);
  if (!trustedChat || !trustedUser || !action) return error("Thao tác duyệt không hợp lệ.", 403);

  try {
    await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "Đang xử lý đơn hàng..." });
  } catch (exception) {
    console.error("Telegram callback acknowledgement failed", exception.name);
  }

  const orderId = Number(action[2]);
  const order = await env.DB.prepare("SELECT id, payment_method, payment_status, status FROM orders WHERE id = ?").bind(orderId).first();
  if (!order || order.payment_method !== "vietqr" || order.payment_status !== "pending" || order.status !== "pending") {
    try { await telegramApi(env, "editMessageText", { chat_id: message.chat.id, message_id: message.message_id, text: `Chợ Nhà · Đơn #${orderId} không còn chờ duyệt.` }); }
    catch (exception) { console.error("Telegram stale review message update failed", exception.name); }
    return json({ ok: true });
  }

  let result;
  if (action[1] === "approve") {
    result = await env.DB.prepare("UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ? AND payment_method = 'vietqr' AND payment_status = 'pending' AND status = 'pending'")
      .bind(orderId).run();
  } else {
    const batch = await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'unpaid', stock_released = 2 WHERE id = ? AND payment_method = 'vietqr' AND payment_status = 'pending' AND status = 'pending' AND stock_released = 0").bind(orderId),
      env.DB.prepare("UPDATE products SET stock = stock + (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = ? AND oi.product_id = products.id) WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ? AND product_id IS NOT NULL) AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND payment_method = 'vietqr' AND payment_status = 'unpaid' AND status = 'cancelled' AND stock_released = 2)").bind(orderId, orderId, orderId),
      env.DB.prepare("UPDATE orders SET stock_released = 1 WHERE id = ? AND payment_method = 'vietqr' AND payment_status = 'unpaid' AND status = 'cancelled' AND stock_released = 2").bind(orderId)
    ]);
    result = batch[0];
  }

  const changed = result.meta.changes === 1;
  const decision = action[1] === "approve" ? "Đã duyệt thanh toán; đơn đã xác nhận." : "Đã từ chối thanh toán; đơn đã hủy và tồn kho được hoàn lại.";
  const text = changed ? `Chợ Nhà · ${decision}\nĐơn #${orderId}` : `Chợ Nhà · Đơn #${orderId} đã được xử lý trước đó.`;
  try {
    await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id, text: changed ? decision : "Đơn đã được xử lý." });
    await telegramApi(env, "editMessageText", { chat_id: message.chat.id, message_id: message.message_id, text });
  } catch (exception) {
    console.error("Telegram payment review update failed", exception.name);
  }
  return json({ ok: true });
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function requireAdmin(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN && token && token === env.ADMIN_TOKEN);
}

async function signOrderStatusToken(secret, orderId) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(orderId))));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function api(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;

  if (path === "/api/telegram/webhook" && method === "POST") return telegramWebhook(request, env);
  if (adminPath(path) && !(await requireAdmin(request, env))) return error("Bạn cần đăng nhập quản trị.", 401);

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/analytics/page-view" && method === "POST") {
    await recordPageView(request, env);
    return json({ ok: true, recorded: true, page: "home" }, 201);
  }

  // Stream endpoint: nhận raw events từ frontend, đẩy qua Pipeline → Sink → Basin
  if (path === "/api/events" && method === "POST") {
    const body = await readBody(request);
    if (!body || !body.type) return error("Thiếu trường type.", 400);
    // Chạy pipeline bất đồng bộ, không block response
    ctx.waitUntil(runPipeline(body, request, env).catch((exception) => {
      console.error("Pipeline failed", exception.name);
    }));
    return json({ ok: true }, 202);
  }

  // Pipeline ingest endpoint: nhận schema giống Cloudflare Pipelines (id/country/device/ip/time/meta)
  // Tương đương endpoint *.ingest.cloudflare.com của thầy — ghi vào D1 table visitors (Basin Catalog)
  if (path === "/api/pipeline" && method === "POST") {
    const body = await readBody(request);
    if (!body) return error("Thiếu body.", 400);
    const visitorId = String(body?.id || "").slice(0, 64);
    const country = /^[A-Z]{2}$/.test(String(body?.country || "")) ? body.country : (request.cf?.country || "ZZ");
    const device = String(body?.device || "unknown").slice(0, 32);
    const ip = String(body?.ip || request.headers.get("cf-connecting-ip") || "").slice(0, 64);
    const rawTime = body?.time;
    const ts = rawTime ? new Date(typeof rawTime === "number" && rawTime < 1e12 ? rawTime * 1000 : rawTime).toISOString() : new Date().toISOString();
    const meta = body?.meta ? JSON.stringify(body.meta) : "{}";
    ctx.waitUntil((async () => {
      try {
        await env.DB.prepare(
          "INSERT INTO visitors (visitor_id, country, device, ip, ts, meta, ingest_ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(visitorId, country, device, ip, ts, meta, new Date().toISOString()).run();
      } catch (exception) {
        console.error("Pipeline visitors sink failed", exception.name);
      }
      // Đồng thời ghi vào R2 Data Lake (NDJSON)
      try {
        const now = new Date();
        const key = `pipeline/country=${country}/device=${device}/year=${now.getUTCFullYear()}/month=${String(now.getUTCMonth()+1).padStart(2,"0")}/day=${String(now.getUTCDate()).padStart(2,"0")}/${now.toISOString().replace(/[:.]/g,"-")}.ndjson`;
        await env.DATA_LAKE.put(key, JSON.stringify({ visitor_id: visitorId, country, device, ip, ts, meta: body?.meta || {} }), {
          httpMetadata: { contentType: "application/x-ndjson" }
        });
      } catch (exception) {
        console.error("Pipeline R2 sink failed", exception.name);
      }
    })());
    return json({ ok: true }, 202);
  }

  if (path === "/api/chat" && method === "POST") return chat(request, env);

  const orderStatusMatch = path.match(/^\/api\/orders\/([1-9]\d*)$/);
  if (orderStatusMatch && method === "GET") {
    const signingSecret = orderStatusSecret(env);
    if (!signingSecret) return error("Kiểm tra trạng thái đơn chưa được cấu hình an toàn.", 503);
    const orderId = Number(orderStatusMatch[1]);
    const suppliedToken = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!suppliedToken) return error("Bạn không có quyền xem trạng thái đơn này.", 401);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signature = Uint8Array.from(suppliedToken.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
    const authorized = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(String(orderId)));
    if (!authorized) return error("Bạn không có quyền xem trạng thái đơn này.", 401);
    const order = await env.DB.prepare("SELECT id, status, payment_status FROM orders WHERE id = ?")
      .bind(orderId).first();
    return order ? json(order) : error("Không tìm thấy đơn hàng.", 404);
  }

  if (path === "/api/categories" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, slug FROM categories ORDER BY name").all();
    return json(results);
  }

  if (path === "/api/products" && method === "GET") {
    const category = url.searchParams.get("category");
    const query = url.searchParams.get("q");
    let sql = "SELECT p.id, p.category_id, c.name AS category_name, p.name, p.description, p.price, p.image_url, p.stock, p.featured FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.stock > 0";
    const values = [];
    if (category) { sql += " AND c.slug = ?"; values.push(category); }
    if (query) { sql += " AND (p.name LIKE ? OR p.description LIKE ?)"; values.push(`%${query}%`, `%${query}%`); }
    sql += " ORDER BY p.featured DESC, p.created_at DESC";
    const { results } = await env.DB.prepare(sql).bind(...values).all();
    return json(results);
  }

  if (path === "/api/orders" && method === "POST") {
    const body = await readBody(request);
    if (!body || !body.customer || !Array.isArray(body.items) || body.items.length === 0) return error("Thông tin đơn hàng chưa hợp lệ.");
    const { name, email, phone, address } = body.customer;
    if (![name, email, phone, address].every((value) => typeof value === "string" && value.trim())) return error("Vui lòng điền đầy đủ thông tin nhận hàng.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("Email chưa đúng định dạng.");
    if (!body.items.every((item) => Number.isInteger(item.productId) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99)) return error("Sản phẩm trong giỏ chưa hợp lệ.");
    const quantities = new Map();
    for (const item of body.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    const products = new Map();
    for (const [productId, quantity] of quantities) {
      const product = await env.DB.prepare("SELECT id, name, price, stock FROM products WHERE id = ?").bind(productId).first();
      if (!product || product.stock < quantity) return error(`Sản phẩm ${product?.name ?? "đã chọn"} không đủ tồn kho.`, 409);
      products.set(productId, product);
    }
    const paymentMethod = body.paymentMethod || "cod";
    if (!["cod", "bank_transfer", "vietqr"].includes(paymentMethod)) return error("Phương thức thanh toán này hiện chưa khả dụng. Vui lòng chọn VietQR hoặc thanh toán khi nhận hàng.");
    if (paymentMethod === "vietqr" && ![env.VIETQR_BANK_ID, env.VIETQR_ACCOUNT_NUMBER, env.VIETQR_ACCOUNT_NAME].every((value) => typeof value === "string" && value.trim())) {
      return error("VietQR chưa được cấu hình đầy đủ. Vui lòng chọn phương thức thanh toán khác.", 503);
    }
    const paymentStatus = paymentMethod === "cod" ? "unpaid" : "pending";
    const reserved = [];
    for (const [productId, quantity] of quantities) {
      const reservation = await env.DB.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
        .bind(quantity, productId, quantity).run();
      if (reservation.meta.changes !== 1) {
        for (const [reservedId, reservedQuantity] of reserved) {
          await env.DB.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(reservedQuantity, reservedId).run();
        }
        return error(`Sản phẩm ${products.get(productId).name} vừa hết hàng.`, 409);
      }
      reserved.push([productId, quantity]);
    }
    let orderId;
    try {
      const customerResult = await env.DB.prepare("INSERT INTO customers (name, email, phone, address) VALUES (?, ?, ?, ?) ON CONFLICT(email, phone) DO UPDATE SET name = excluded.name, address = excluded.address RETURNING id")
        .bind(name.trim(), email.trim().toLowerCase(), phone.trim(), address.trim()).first();
      orderId = await env.DB.prepare("INSERT INTO orders (customer_id, payment_method, payment_status, total) VALUES (?, ?, ?, 0) RETURNING id")
        .bind(customerResult.id, paymentMethod, paymentStatus).first();
      let total = 0;
      for (const [productId, quantity] of quantities) {
        const product = products.get(productId);
        total += product.price * quantity;
        await env.DB.prepare("INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)")
          .bind(orderId.id, product.id, product.name, product.price, quantity).run();
      }
      let transferCode;
      if (paymentMethod === "vietqr") {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          transferCode = randomTransferCode();
          try {
            await env.DB.prepare("UPDATE orders SET total = ?, transfer_code = ? WHERE id = ?")
              .bind(total, transferCode, orderId.id).run();
            break;
          } catch (exception) {
            if (!String(exception.message).includes("UNIQUE constraint failed: orders.transfer_code") || attempt === 9) throw exception;
          }
        }
      } else {
        await env.DB.prepare("UPDATE orders SET total = ? WHERE id = ?").bind(total, orderId.id).run();
      }
      let payment;
      let telegramNotification;
      if (paymentMethod === "vietqr") {
        const qrUrl = new URL(`https://img.vietqr.io/image/${encodeURIComponent(env.VIETQR_BANK_ID)}-${encodeURIComponent(env.VIETQR_ACCOUNT_NUMBER)}-compact2.png`);
        qrUrl.searchParams.set("amount", String(total));
        qrUrl.searchParams.set("addInfo", transferCode);
        qrUrl.searchParams.set("accountName", env.VIETQR_ACCOUNT_NAME.trim());
        const order = { id: orderId.id, total, transferCode };
        const orderItems = [...quantities].map(([productId, quantity]) => ({
          name: products.get(productId).name,
          price: products.get(productId).price,
          quantity
        }));
        telegramNotification = await notifyTelegramOrder(env, order, { name, phone, address }, orderItems);
        payment = { method: "vietqr", status: paymentStatus, qrUrl: qrUrl.toString(), transferContent: transferCode, adminNotification: telegramNotification };
      }
      const signingSecret = orderStatusSecret(env);
      const statusToken = signingSecret ? await signOrderStatusToken(signingSecret, orderId.id) : undefined;
      return json({ id: orderId.id, total, status: "pending", statusToken, payment }, 201);
    } catch (exception) {
      if (orderId?.id) await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(orderId.id).run();
      for (const [reservedId, reservedQuantity] of reserved) {
        await env.DB.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(reservedQuantity, reservedId).run();
      }
      throw exception;
    }
  }

  if (path === "/api/admin/summary" && method === "GET") {
    const [products, categories, orders, customers] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM products").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM categories").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customers").first()
    ]);
    return json({ products: products.count, categories: categories.count, orders: orders.count, customers: customers.count });
  }

  if (path === "/api/admin/analytics" && method === "GET") {
    const days = Number(url.searchParams.get("days") || 30);
    if (![7, 30, 90].includes(days)) return error("Khoảng thời gian phải là 7, 30 hoặc 90 ngày.");
    const since = `-${days - 1} days`;
    const allViews = "(SELECT day, country, operating_system, views FROM pageview_daily UNION ALL SELECT day, country, operating_system, views FROM pageview_demo_daily)";
    const [summary, demoSummary, countries, systems, timeline] = await Promise.all([
      env.DB.prepare(`SELECT COALESCE(SUM(views), 0) AS views FROM ${allViews} WHERE day >= date('now', ?)`).bind(since).first(),
      env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS views FROM pageview_demo_daily WHERE day >= date('now', ?)").bind(since).first(),
      env.DB.prepare(`SELECT country, SUM(views) AS views FROM ${allViews} WHERE day >= date('now', ?) GROUP BY country ORDER BY views DESC LIMIT 10`).bind(since).all(),
      env.DB.prepare(`SELECT operating_system AS name, SUM(views) AS views FROM ${allViews} WHERE day >= date('now', ?) GROUP BY operating_system ORDER BY views DESC`).bind(since).all(),
      env.DB.prepare(`SELECT day, SUM(views) AS views FROM ${allViews} WHERE day >= date('now', ?) GROUP BY day ORDER BY day`).bind(since).all()
    ]);
    return json({
      days,
      views: summary.views,
      demoViews: demoSummary.views,
      countries: countries.results,
      operatingSystems: systems.results,
      timeline: timeline.results
    });
  }

  if (path === "/api/admin/analytics/demo" && method === "POST") {
    const countrySystems = [
      ["VN", "Windows"], ["VN", "Android"], ["VN", "iOS"], ["VN", "Khác"],
      ["US", "Windows"], ["US", "macOS"], ["US", "iOS"],
      ["JP", "Windows"], ["JP", "Android"], ["JP", "iOS"],
      ["SG", "macOS"], ["SG", "iOS"], ["TH", "Android"],
      ["TH", "Windows"], ["FR", "iOS"], ["DE", "Linux"],
      ["AU", "macOS"], ["CA", "Windows"], ["KR", "Android"]
    ];
    const statements = [env.DB.prepare("DELETE FROM pageview_demo_daily")];
    let totalViews = 0;
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      const values = countrySystems.flatMap(([country, operatingSystem], index) => {
        const views = 3 + ((offset * 7 + index * 11) % 38);
        totalViews += views;
        return [day, country, operatingSystem, "home", views];
      });
      const rows = countrySystems.map(() => "(?, ?, ?, ?, ?)").join(", ");
      statements.push(env.DB.prepare(`INSERT INTO pageview_demo_daily (day, country, operating_system, page, views) VALUES ${rows}`).bind(...values));
    }
    await env.DB.batch(statements);
    return json({ ok: true, days: 30, countries: 10, operatingSystems: 6, views: totalViews });
  }

  if (path === "/api/admin/analytics/chatbot" && method === "GET") {
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const since1h  = new Date(Date.now() -  1 * 3_600_000).toISOString();
    const [total, byCountry, byOs, byHour, recent, pageViews24h] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS messages, COALESCE(SUM(has_product_result),0) AS product_hits FROM chatbot_events WHERE ts >= ?").bind(since24h).first(),
      env.DB.prepare("SELECT country, COUNT(*) AS messages FROM chatbot_events WHERE ts >= ? GROUP BY country ORDER BY messages DESC LIMIT 10").bind(since24h).all(),
      env.DB.prepare("SELECT operating_system AS name, COUNT(*) AS messages FROM chatbot_events WHERE ts >= ? GROUP BY operating_system ORDER BY messages DESC").bind(since24h).all(),
      env.DB.prepare("SELECT strftime('%H', ts) AS hour, COUNT(*) AS messages FROM chatbot_events WHERE ts >= ? GROUP BY hour ORDER BY hour").bind(since24h).all(),
      env.DB.prepare("SELECT ts, country, operating_system, message_len, has_product_result, message_preview FROM chatbot_events WHERE ts >= ? ORDER BY ts DESC LIMIT 20").bind(since1h).all(),
      env.DB.prepare("SELECT COALESCE(SUM(views),0) AS views FROM pageview_daily WHERE day >= date('now','-1 day')").first()
    ]);
    return json({
      hours: 24,
      messages: total?.messages || 0,
      productHits: total?.product_hits || 0,
      pageViews24h: pageViews24h?.views || 0,
      countries: byCountry.results,
      operatingSystems: byOs.results,
      timeline: byHour.results,
      recentMessages: recent.results
    });
  }

  // Basin Catalog query: xem dữ liệu visitors từ D1 (tương đương Query data tab trong Basin Catalog của thầy)
  if (path === "/api/admin/analytics/visitors" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const [total, byCountry, byDevice, recent] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM visitors").first(),
      env.DB.prepare("SELECT country, COUNT(*) AS count FROM visitors GROUP BY country ORDER BY count DESC LIMIT 10").all(),
      env.DB.prepare("SELECT device, COUNT(*) AS count FROM visitors GROUP BY device ORDER BY count DESC").all(),
      env.DB.prepare("SELECT visitor_id AS id, country, device, ip, ts, meta, ingest_ts AS __ingest_ts FROM visitors ORDER BY ingest_ts DESC LIMIT ?").bind(limit).all(),
    ]);
    return json({
      total: total?.total || 0,
      byCountry: byCountry.results,
      byDevice: byDevice.results,
      rows: recent.results,
    });
  }

  if (path === "/api/admin/products" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC").all();
    return json(results);
  }
  if (path === "/api/admin/products" && method === "POST") {
    const body = await readBody(request);
    if (!body || !String(body.name || "").trim() || !Number.isInteger(Number(body.price)) || Number(body.price) < 0) return error("Tên và giá sản phẩm là bắt buộc.");
    const result = await env.DB.prepare("INSERT INTO products (category_id, name, description, price, image_url, stock, featured) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(body.categoryId || null, body.name.trim(), body.description || "", Number(body.price), body.imageUrl || "", Math.max(0, Number(body.stock) || 0), body.featured ? 1 : 0).first();
    return json({ id: result.id }, 201);
  }

  const productMatch = path.match(/^\/api\/admin\/products\/(\d+)$/);
  if (productMatch && method === "PUT") {
    const body = await readBody(request);
    if (!body || !String(body.name || "").trim() || !Number.isInteger(Number(body.price)) || Number(body.price) < 0) return error("Tên và giá sản phẩm là bắt buộc.");
    await env.DB.prepare("UPDATE products SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?, stock = ?, featured = ? WHERE id = ?")
      .bind(body.categoryId || null, body.name.trim(), body.description || "", Number(body.price), body.imageUrl || "", Math.max(0, Number(body.stock) || 0), body.featured ? 1 : 0, Number(productMatch[1])).run();
    return json({ ok: true });
  }
  if (productMatch && method === "DELETE") {
    await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(Number(productMatch[1])).run();
    return json({ ok: true });
  }

  if (path === "/api/admin/categories" && method === "POST") {
    const body = await readBody(request);
    const name = String(body?.name || "").trim();
    if (!name) return error("Tên danh mục là bắt buộc.");
    try {
      const result = await env.DB.prepare("INSERT INTO categories (name, slug) VALUES (?, ?) RETURNING id").bind(name, slugify(name)).first();
      return json({ id: result.id }, 201);
    } catch { return error("Tên danh mục đã tồn tại.", 409); }
  }
  const categoryMatch = path.match(/^\/api\/admin\/categories\/(\d+)$/);
  if (categoryMatch && method === "DELETE") {
    await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(Number(categoryMatch[1])).run();
    return json({ ok: true });
  }

  if (path === "/api/admin/customers" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT c.*, COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS lifetime_value FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY c.created_at DESC").all();
    return json(results);
  }
  if (path === "/api/admin/orders" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT o.*, c.name AS customer_name, c.email, c.phone, c.address, (SELECT GROUP_CONCAT(oi.product_name || ' × ' || oi.quantity, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS items FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.created_at DESC").all();
    return json(results);
  }
  const orderMatch = path.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (orderMatch && method === "PATCH") {
    const body = await readBody(request);
    if (body?.paymentStatus !== undefined) {
      if (!["unpaid", "pending", "paid"].includes(body.paymentStatus)) return error("Trạng thái thanh toán không hợp lệ.");
      await env.DB.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").bind(body.paymentStatus, Number(orderMatch[1])).run();
      return json({ ok: true });
    }
    const allowed = ["pending", "confirmed", "shipping", "completed", "cancelled"];
    if (!allowed.includes(body?.status)) return error("Trạng thái đơn hàng không hợp lệ.");
    await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(body.status, Number(orderMatch[1])).run();
    return json({ ok: true });
  }

  return error("Không tìm thấy API.", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, ctx); }
      catch (exception) { console.error(exception); return error("Máy chủ gặp lỗi, vui lòng thử lại.", 500); }
    }
    const response = await env.ASSETS.fetch(request);
    if (request.method === "GET" && ["/", "/index.html", "/dashboard", "/dashboard/"].includes(url.pathname) && request.headers.get("accept")?.includes("text/html")) {
      ctx.waitUntil(recordPageView(request, env).catch((exception) => {
        console.error("Page-view analytics write failed", exception.name);
      }));
    }
    return response;
  },
  async scheduled(_event, env) {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM pageview_daily WHERE day < date('now', '-90 days')"),
        env.DB.prepare("DELETE FROM pageview_demo_daily WHERE day < date('now', '-90 days')"),
        env.DB.prepare("DELETE FROM chatbot_events WHERE ts < datetime('now', '-90 days')")
      ]);
    } catch (exception) {
      console.error("Page-view analytics retention cleanup failed", exception.name);
    }
  }
};
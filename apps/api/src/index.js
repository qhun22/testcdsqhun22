const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const error = (message, status = 400) => json({ error: message }, status);
const slugify = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const adminPath = (path) => path.startsWith("/api/admin/");
const normalizeText = (value) => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
const chatUsage = new Map();

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
  if (products.length) return `Mình tìm thấy ${products.length} sản phẩm phù hợp bên dưới. Bạn có thể xem giá và thêm món vào giỏ ngay tại đây.`;
  if (productIntent) return "Mình chưa tìm thấy sản phẩm còn hàng phù hợp. Bạn thử một tên món khác hoặc từ khóa ngắn hơn nhé.";
  if (/thanh toan|chuyen khoan|cod|tien mat/.test(normalized)) return "Cửa hàng hỗ trợ thanh toán khi nhận hàng hoặc chuyển khoản thủ công. Bạn chọn phương thức ở phần thông tin nhận hàng khi đặt đơn nhé.";
  if (/dat hang|mua hang|don hang|gio hang/.test(normalized)) return "Bạn thêm sản phẩm vào giỏ, mở Giỏ hàng, điền thông tin nhận hàng rồi chọn Đặt hàng. Đơn sẽ ở trạng thái chờ cửa hàng xác nhận.";
  if (/giao hang|phi ship|van chuyen|thoi gian giao/.test(normalized)) return "Cửa hàng hiện chưa hiển thị phí hoặc thời gian giao hàng cụ thể. Bạn có thể gửi địa chỉ trong đơn để cửa hàng xác nhận.";
  if (/doi tra|hoan tien|huy don/.test(normalized)) return "Mình chưa có thông tin chính sách đổi trả hoặc hủy đơn. Bạn vui lòng liên hệ cửa hàng để được xác nhận.";
  return "Mình có thể giúp tìm sản phẩm, hướng dẫn đặt hàng và giải đáp về thanh toán. Bạn thử hỏi tên món cần tìm hoặc cách đặt đơn nhé.";
}

async function chat(request, env) {
  if (!allowChatRequest(request)) return error("Bạn gửi tin nhắn hơi nhanh. Vui lòng thử lại sau một phút nhé.", 429);
  const body = await readBody(request);
  const message = String(body?.message || "").trim();
  if (!message || message.length > 500) return error("Tin nhắn cần có nội dung và không dài quá 500 ký tự.");

  const normalized = normalizeText(message);
  const capabilityQuestion = /ho tro gi|ho tro duoc gi|lam duoc gi|giup duoc gi/.test(normalized);
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
  let reply = capabilityQuestion ? "Mình có thể giúp bạn tìm sản phẩm còn hàng, xem giá, chọn món, hướng dẫn đặt hàng và giải đáp về thanh toán. Bạn muốn bắt đầu với việc nào?" : "";
  if (env.AI && !reply) {
    try {
      const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [
          { role: "system", content: `Bạn là trợ lý cửa hàng thực phẩm Chợ Nhà, luôn trả lời bằng tiếng Việt tự nhiên, ngắn gọn, thân thiện và xưng mình/bạn. Bạn có thể giúp khách tìm sản phẩm, xem giá, chọn món, hướng dẫn thêm vào giỏ và đặt hàng, hoặc giải đáp phương thức thanh toán. Nếu khách hỏi bạn hỗ trợ gì, hãy nêu ngắn gọn các việc trên thay vì nói không có thông tin. Khách đặt hàng bằng cách thêm món vào giỏ, mở giỏ hàng, điền thông tin nhận hàng, chọn phương thức thanh toán rồi bấm Đặt hàng; đơn sẽ chờ cửa hàng xác nhận. Cửa hàng nhận thanh toán khi giao hàng hoặc chuyển khoản thủ công; đây chưa phải thanh toán trực tuyến. Chỉ tư vấn sản phẩm trong danh sách còn hàng bên dưới. Không tự bịa phí hoặc thời gian giao, chính sách đổi trả, hay thông tin liên hệ; nếu chưa biết thì nói rõ cửa hàng cần xác nhận. Không xác nhận hoặc thay đổi đơn hàng. Sản phẩm còn hàng phù hợp với câu hỏi: ${JSON.stringify(products)}.` },
          ...history
        ],
        max_tokens: 220
      });
      reply = String(result?.response || "").trim();
    } catch (exception) { console.error("Workers AI chat unavailable", exception); }
  }
  return json({ reply: reply || fallbackChatReply(message, products, productIntent), products });
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function requireAdmin(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN && token && token === env.ADMIN_TOKEN);
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method;

  if (adminPath(path) && !(await requireAdmin(request, env))) return error("Bạn cần đăng nhập quản trị.", 401);

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/chat" && method === "POST") return chat(request, env);

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
    const paymentMethod = ["cod", "bank_transfer"].includes(body.paymentMethod) ? body.paymentMethod : "cod";
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
      orderId = await env.DB.prepare("INSERT INTO orders (customer_id, payment_method, total) VALUES (?, ?, 0) RETURNING id")
        .bind(customerResult.id, paymentMethod).first();
      let total = 0;
      for (const [productId, quantity] of quantities) {
        const product = products.get(productId);
        total += product.price * quantity;
        await env.DB.prepare("INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)")
          .bind(orderId.id, product.id, product.name, product.price, quantity).run();
      }
      await env.DB.prepare("UPDATE orders SET total = ? WHERE id = ?").bind(total, orderId.id).run();
      return json({ id: orderId.id, total, status: "pending" }, 201);
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
    const allowed = ["pending", "confirmed", "shipping", "completed", "cancelled"];
    if (!allowed.includes(body?.status)) return error("Trạng thái đơn hàng không hợp lệ.");
    await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(body.status, Number(orderMatch[1])).run();
    return json({ ok: true });
  }

  return error("Không tìm thấy API.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); }
      catch (exception) { console.error(exception); return error("Máy chủ gặp lỗi, vui lòng thử lại.", 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
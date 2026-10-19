const money = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
const fallbackImage = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80";
const state = { products: [], categories: [], cart: JSON.parse(localStorage.getItem("cho-nha-cart") || "[]"), category: "", query: "" };
const $ = (selector) => document.querySelector(selector);
const chatSessionKey = "cho-nha-chat-session";
const greeting = "Chào bạn! Mình có thể giúp tìm món trong cửa hàng hoặc giải đáp về cách đặt hàng, thanh toán.";
function loadChatSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(chatSessionKey) || "null");
    if (saved && Array.isArray(saved.messages)) return {
      messages: saved.messages.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-60),
      checkoutItems: Array.isArray(saved.checkoutItems) ? saved.checkoutItems : [],
      customer: saved.customer && typeof saved.customer === "object" ? saved.customer : {},
      flow: ["idle", "selecting", "details", "complete"].includes(saved.flow) ? saved.flow : "idle",
      pendingMessage: typeof saved.pendingMessage === "string" ? saved.pendingMessage : "",
      draft: typeof saved.draft === "string" ? saved.draft : "",
      generation: Number.isInteger(saved.generation) ? saved.generation : 0,
      open: Boolean(saved.open)
    };
  } catch (exception) { console.error("Could not restore chat session", exception); }
  return { messages: [{ role: "assistant", content: greeting }], checkoutItems: [], customer: {}, flow: "idle", pendingMessage: "", draft: "", generation: 0, open: false };
}
const chatSession = loadChatSession();
const chatHistory = chatSession.messages.filter((item) => item.role === "user" || item.content !== greeting).slice(-9).map(({ role, content }) => ({ role, content }));
const chatProducts = new Map();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const imageUrl = (product) => product?.image_url || product?.imageUrl || fallbackImage;
const imageErrorHandler = `this.onerror=null;this.src='${fallbackImage}'`;

function saveChatSession() {
  try { localStorage.setItem(chatSessionKey, JSON.stringify(chatSession)); }
  catch (exception) { console.error("Could not save chat session", exception); showToast("Không lưu được phiên chat trên trình duyệt này."); }
}

function addToChatHistory(role, content) {
  chatHistory.push({ role, content });
  if (chatHistory.length > 9) chatHistory.splice(0, chatHistory.length - 9);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Đã có lỗi xảy ra.");
  return data;
}

// Gửi raw chatbot event vào Stream endpoint → Pipeline → Sink (R2 + D1 + Analytics Engine)
function sendChatbotEvent(message, answer) {
  const payload = {
    type: "chatbot_message",
    messageLen: message.length,
    hasProductResult: Array.isArray(answer?.products) && answer.products.length > 0,
    sessionId: String(chatSession.generation || 0)
  };
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function renderCategories() {
  $("#categories").innerHTML = `<button class="category-chip ${state.category ? "" : "active"}" data-category="">Tất cả</button>` + state.categories.map((category) => `<button class="category-chip ${state.category === category.slug ? "active" : ""}" data-category="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</button>`).join("");
}

function renderProducts() {
  const visible = state.products.filter((product) => `${product.name} ${product.description}`.toLowerCase().includes(state.query.toLowerCase()));
  $("#products").innerHTML = visible.length ? visible.map((product) => `<article class="product-card"><div class="product-photo"><img src="${escapeHtml(imageUrl(product))}" onerror="${imageErrorHandler}" alt="${escapeHtml(product.name)}" loading="lazy">${product.featured ? "<span class=\"product-tag\">Nhà mình thích</span>" : ""}<button class="add-button" data-add="${product.id}" aria-label="Thêm ${escapeHtml(product.name)} vào giỏ">+</button></div><div class="product-info"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.category_name || "Món ngon")}</p></div><span class="product-price">${money(product.price)}</span></div></article>`).join("") : "<p class=\"loading\">Chưa tìm thấy món này. Thử tìm một món khác nhé.</p>";
}

function persistCart() {
  localStorage.setItem("cho-nha-cart", JSON.stringify(state.cart));
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((total, item) => total + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  $("#cart-count").textContent = count;
  $("#drawer-count").textContent = `(${count})`;
  $("#cart-total").textContent = money(total);
  $("#cart-items").innerHTML = state.cart.length ? state.cart.map((item) => `<div class="cart-row"><img src="${escapeHtml(item.image || fallbackImage)}" onerror="${imageErrorHandler}" alt=""><div><h3>${escapeHtml(item.name)}</h3><p>${money(item.price)}</p></div><div class="quantity"><button data-quantity="${item.id}" data-delta="-1" aria-label="Giảm số lượng">−</button><span>${item.quantity}</span><button data-quantity="${item.id}" data-delta="1" aria-label="Tăng số lượng">+</button></div></div>`).join("") : "<p class=\"empty-cart\">Giỏ hàng đang chờ món ngon đầu tiên.</p>";
  $("#checkout-form button[type=submit]").disabled = !state.cart.length;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function addProductToCart(product) {
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) existing.quantity += 1;
  else state.cart.push({ id: product.id, name: product.name, price: product.price, image: imageUrl(product), quantity: 1 });
  persistCart();
  showToast("Đã thêm vào giỏ hàng");
}

function renderChatMessage(entry) {
  const message = document.createElement("div");
  message.className = `chat-message ${entry.role === "user" ? "user-message" : "assistant-message"}`;
  if (entry.kind) message.dataset.chatKind = entry.kind;
  const paragraph = document.createElement("p");
  paragraph.textContent = entry.content;
  message.append(paragraph);
  if (entry.products?.length) {
    const results = document.createElement("div");
    results.className = "chat-product-results";
    entry.products.forEach((product) => {
      chatProducts.set(Number(product.id), product);
      const item = document.createElement("article");
      item.className = "chat-product";
      const image = document.createElement("img");
      image.src = imageUrl(product);
      image.alt = "";
      image.onerror = () => { image.src = fallbackImage; };
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = product.name;
      const price = document.createElement("span");
      price.textContent = money(product.price);
      details.append(name, price);
      const add = document.createElement("button");
      add.type = "button";
      add.dataset[entry.mode === "checkout" ? "chatCheckoutAdd" : "chatAdd"] = product.id;
      add.setAttribute("aria-label", `${entry.mode === "checkout" ? "Chọn" : "Thêm"} ${product.name}`);
      add.textContent = "+";
      item.append(image, details, add);
      results.append(item);
    });
    message.append(results);
  }
  if (entry.kind === "checkout-quote") {
    const items = document.createElement("div");
    items.className = "chat-checkout-items";
    for (const product of chatSession.checkoutItems) {
      const row = document.createElement("div");
      row.className = "chat-checkout-item";
      const name = document.createElement("span");
      name.textContent = `${product.name} · ${money(product.price)}`;
      const controls = document.createElement("div");
      controls.className = "chat-checkout-quantity";
      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.dataset.paymentQuantity = product.id;
      decrease.dataset.delta = "-1";
      decrease.setAttribute("aria-label", `Giảm ${product.name}`);
      decrease.textContent = "−";
      const count = document.createElement("span");
      count.textContent = String(product.quantity);
      const increase = document.createElement("button");
      increase.type = "button";
      increase.dataset.paymentQuantity = product.id;
      increase.dataset.delta = "1";
      increase.setAttribute("aria-label", `Tăng ${product.name}`);
      increase.textContent = "+";
      controls.append(decrease, count, increase);
      const subtotal = document.createElement("strong");
      subtotal.textContent = money(product.price * product.quantity);
      row.append(name, controls, subtotal);
      items.append(row);
    }
    const total = chatSession.checkoutItems.reduce((sum, product) => sum + product.price * product.quantity, 0);
    const totalRow = document.createElement("strong");
    totalRow.className = "chat-checkout-total";
    totalRow.textContent = `Tổng tạm tính: ${money(total)}`;
    items.append(totalRow);
    const checkout = document.createElement("button");
    checkout.type = "button";
    checkout.className = "chat-cart-button";
    checkout.dataset.paymentCheckout = "";
    checkout.disabled = !chatSession.checkoutItems.length;
    checkout.textContent = "Tiếp tục · tạo mã VietQR";
    items.append(checkout);
    message.append(items);
  }
  if (entry.kind === "checkout-form") {
    const form = document.createElement("form");
    form.className = "chat-payment-form";
    form.innerHTML = '<label>Họ và tên<input name="name" autocomplete="name" required></label><label>Số điện thoại<input name="phone" autocomplete="tel" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Địa chỉ giao hàng<textarea name="address" autocomplete="street-address" required></textarea></label><button class="chat-cart-button" type="submit">Tạo đơn và mã VietQR</button><p class="chat-payment-status" role="status"></p>';
    for (const field of form.elements) if (field.name && chatSession.customer[field.name]) field.value = chatSession.customer[field.name];
    message.append(form);
  }
  if (entry.kind === "checkout-payment" && entry.payment) {
    const payment = entry.payment;
    const heading = document.createElement("strong");
    heading.textContent = `Đơn #${payment.orderId} · ${money(payment.total)}`;
    const image = document.createElement("img");
    image.className = "chat-payment-qr";
    image.src = payment.qrUrl;
    image.alt = `Mã QR thanh toán đơn hàng ${payment.orderId}`;
    image.loading = "lazy";
    const details = document.createElement("p");
    details.textContent = `Chuyển ${money(payment.total)} · Nội dung: ${payment.transferContent}`;
    const notice = document.createElement("p");
    notice.className = "payment-notice";
    notice.textContent = payment.adminNotification === "sent"
      ? "Đã gửi yêu cầu duyệt cho cửa hàng qua Telegram. Đơn chỉ được xác nhận sau khi cửa hàng duyệt và kiểm tra tiền về."
      : payment.adminNotification === "failed"
        ? "Không gửi được thông báo Telegram cho cửa hàng. Đơn đã tạo nhưng đang chờ cửa hàng xác nhận; vui lòng liên hệ trực tiếp."
        : "Telegram chưa được cấu hình. Đơn đã tạo nhưng đang chờ cửa hàng xác nhận; vui lòng liên hệ trực tiếp.";
    message.append(heading, image, details, notice);

    if (payment.orderId && payment.statusToken) {
      const pollOrderStatus = async () => {
        try {
          const check = await api(`/api/orders/${payment.orderId}`, {
            headers: { authorization: `Bearer ${payment.statusToken}` }
          });
          if (check.payment_status === "paid" || check.status === "confirmed") {
            notice.className = "payment-notice";
            notice.style.color = "var(--green, #2b6140)";
            notice.style.fontWeight = "600";
            notice.textContent = `Đơn #${payment.orderId} đã được quản trị viên duyệt thanh toán thành công!`;
            return true;
          } else if (check.status === "cancelled") {
            notice.className = "payment-notice";
            notice.style.color = "#c0392b";
            notice.textContent = `Đơn #${payment.orderId} đã bị từ chối hoặc đã hủy.`;
            return true;
          }
        } catch { }
        return false;
      };
      const interval = setInterval(async () => {
        const finished = await pollOrderStatus();
        if (finished) clearInterval(interval);
      }, 3500);
      setTimeout(() => clearInterval(interval), 300000);
    }
  }
  $("#chat-messages").append(message);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function appendChatMessage(role, content, products = [], options = {}) {
  const entry = { role, content, products, ...options };
  chatSession.messages.push(entry);
  chatSession.messages = chatSession.messages.slice(-60);
  addToChatHistory(role, content);
  renderChatMessage(entry);
  saveChatSession();
}

function appendChatCheckoutQuote() {
  chatSession.messages = chatSession.messages.filter((entry) => entry.kind !== "checkout-quote");
  $("#chat-messages").querySelectorAll('[data-chat-kind="checkout-quote"]').forEach((entry) => entry.remove());
  const details = chatSession.checkoutItems.map((item) => `${item.name} × ${item.quantity}`);
  const content = details.length
    ? `Báo giá sản phẩm đã chọn:\n${details.join("\n")}\nBạn có thể chỉnh số lượng bên dưới trước khi tiếp tục.`
    : "Chưa chọn sản phẩm nào. Hãy chọn món để xem báo giá.";
  appendChatMessage("assistant", content, [], { kind: "checkout-quote" });
}

function isOnlinePaymentIntent(message) {
  const norm = message.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
  return /\b(thanh toan|online|truc tuyen|vietqr|qr|momo|vnpay|chuyen khoan|ck|dat hang|mua hang|dat mua|mua ngay|tinh tien|tra tien|tao don)\b/.test(norm);
}

function restoreChatSession() {
  const messages = $("#chat-messages");
  messages.replaceChildren();
  chatSession.messages.forEach(renderChatMessage);
  $("#chat-input").value = chatSession.draft || "";
  $("#chat-panel").hidden = !chatSession.open;
  $("#chat-panel").setAttribute("aria-hidden", String(!chatSession.open));
  $("#chat-launcher").setAttribute("aria-expanded", String(chatSession.open));
  messages.scrollTop = messages.scrollHeight;
}

function resetChatSession() {
  if (chatSession.messages.length > 1 && !confirm("Tạo phiên chat mới? Nội dung chat hiện tại sẽ bị xóa khỏi trình duyệt.")) return;
  chatSession.messages = [{ role: "assistant", content: greeting }];
  chatSession.checkoutItems = [];
  chatSession.customer = {};
  chatSession.flow = "idle";
  chatSession.pendingMessage = "";
  chatSession.draft = "";
  chatSession.generation += 1;
  chatHistory.splice(0, chatHistory.length);
  chatProducts.clear();
  $("#chat-input").value = "";
  $("#chat-messages").replaceChildren();
  renderChatMessage(chatSession.messages[0]);
  saveChatSession();
}

function setChatOpen(open) {
  const panel = $("#chat-panel");
  panel.hidden = !open;
  panel.setAttribute("aria-hidden", String(!open));
  $("#chat-launcher").setAttribute("aria-expanded", String(open));
  chatSession.open = open;
  saveChatSession();
  if (open) $("#chat-input").focus();
}

$("#chat-launcher").addEventListener("click", () => setChatOpen(true));
$("#chat-close").addEventListener("click", () => setChatOpen(false));
$("#chat-restart").addEventListener("click", resetChatSession);

async function processChatMessage(message) {
  const generation = chatSession.generation;
  const input = $("#chat-input");
  const submit = $("#chat-form").querySelector("button[type=submit]");
  input.disabled = true;
  submit.disabled = true;
  const typing = document.createElement("div");
  typing.className = "chat-message assistant-message chat-typing";
  typing.textContent = "Đang soạn câu trả lời...";
  $("#chat-messages").append(typing);
  try {
    const answer = await api("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, history: chatHistory.slice(-8) }) });
    typing.remove();
    if (generation !== chatSession.generation) return;
    // Đẩy chatbot event vào pipeline (fire-and-forget)
    sendChatbotEvent(message, answer);
    const checkoutMode = isOnlinePaymentIntent(message) || chatSession.flow === "selecting";
    if (checkoutMode) {
      chatSession.flow = "selecting";
      appendChatMessage("assistant", answer.reply);
      if (state.cart.length > 0 && !chatSession.checkoutItems.length) {
        chatSession.checkoutItems = state.cart.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          stock: item.stock || 99,
          quantity: item.quantity
        }));
        appendChatCheckoutQuote();
      } else {
        const products = answer.products?.length ? answer.products : await api("/api/products");
        appendChatMessage("assistant", products.length ? "Chọn sản phẩm bên dưới để thêm vào báo giá. Sau đó bạn có thể chỉnh số lượng và tạo mã thanh toán ngay tại đây." : "Hiện không còn sản phẩm nào để đặt.", products, { mode: "checkout" });
      }
    } else appendChatMessage("assistant", answer.reply, answer.products || []);
    chatSession.pendingMessage = "";
    saveChatSession();
  } catch (exception) {
    typing.remove();
    if (generation !== chatSession.generation) return;
    chatSession.pendingMessage = "";
    appendChatMessage("assistant", exception.message || "Chưa gửi được tin nhắn. Bạn thử lại nhé.");
    saveChatSession();
  } finally {
    input.disabled = false;
    submit.disabled = false;
    input.focus();
  }
}

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message) return;
  appendChatMessage("user", message);
  input.value = "";
  chatSession.draft = "";
  chatSession.pendingMessage = message;
  saveChatSession();
  await processChatMessage(message);
});

$("#chat-input").addEventListener("input", (event) => {
  chatSession.draft = event.currentTarget.value;
  saveChatSession();
});

$("#chat-messages").addEventListener("click", (event) => {
  if (event.target.closest("[data-open-cart]")) {
    setCartOpen(true);
    return;
  }
  if (event.target.closest("[data-payment-checkout]")) {
    if (!chatSession.checkoutItems.length) return;
    chatSession.flow = "details";
    appendChatMessage("assistant", "Điền thông tin nhận hàng để tạo đơn và mã VietQR.", [], { kind: "checkout-form" });
    saveChatSession();
    return;
  }
  const quantityButton = event.target.closest("[data-payment-quantity]");
  if (quantityButton) {
    const item = chatSession.checkoutItems.find((product) => product.id === Number(quantityButton.dataset.paymentQuantity));
    if (!item) return;
    item.quantity = Math.min(item.stock || 99, 99, item.quantity + Number(quantityButton.dataset.delta));
    if (item.quantity <= 0) chatSession.checkoutItems = chatSession.checkoutItems.filter((product) => product.id !== item.id);
    appendChatCheckoutQuote();
    return;
  }
  const checkoutAdd = event.target.closest("[data-chat-checkout-add]");
  if (checkoutAdd) {
    const product = chatProducts.get(Number(checkoutAdd.dataset.chatCheckoutAdd));
    if (!product) return;
    const existing = chatSession.checkoutItems.find((item) => item.id === Number(product.id));
    if (existing) {
      if (existing.quantity >= Math.min(product.stock, 99)) { showToast("Số lượng đã đạt giới hạn cho phép."); return; }
      existing.quantity += 1;
    } else chatSession.checkoutItems.push({
      id: Number(product.id),
      name: product.name,
      price: Number(product.price),
      stock: Number(product.stock),
      quantity: 1
    });
    appendChatCheckoutQuote();
    return;
  }
  const button = event.target.closest("[data-chat-add]");
  if (!button) return;
  const product = chatProducts.get(Number(button.dataset.chatAdd));
  if (product) {
    addProductToCart(product);
  }
});

$("#chat-messages").addEventListener("input", (event) => {
  if (!event.target.name || !["name", "phone", "email", "address"].includes(event.target.name)) return;
  chatSession.customer[event.target.name] = event.target.value;
  saveChatSession();
});

$("#chat-messages").addEventListener("submit", async (event) => {
  if (!event.target.matches(".chat-payment-form")) return;
  event.preventDefault();
  if (!chatSession.checkoutItems.length) return;
  const form = event.target;
  const generation = chatSession.generation;
  const status = form.querySelector(".chat-payment-status");
  const submit = form.querySelector("button[type=submit]");
  const details = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  status.textContent = "Đang tạo đơn và mã QR...";
  try {
    const order = await api("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer: details,
        paymentMethod: "vietqr",
        items: chatSession.checkoutItems.map(({ id, quantity }) => ({ productId: id, quantity }))
      })
    });
    if (generation !== chatSession.generation) return;
    form.querySelectorAll("input, textarea, button").forEach((field) => { field.disabled = true; });
    status.textContent = `Đã tạo đơn #${order.id}.`;
    chatSession.checkoutItems = [];
    chatSession.customer = {};
    chatSession.flow = "complete";
    state.cart = [];
    persistCart();
    appendChatMessage("assistant", "Đơn hàng đã tạo. Quét VietQR để chuyển khoản.", [], {
      kind: "checkout-payment",
      payment: { orderId: order.id, total: order.total, qrUrl: order.payment.qrUrl, transferContent: order.payment.transferContent, adminNotification: order.payment.adminNotification, statusToken: order.statusToken }
    });
  } catch (exception) {
    if (generation !== chatSession.generation) return;
    status.textContent = exception.message || "Chưa tạo được đơn. Vui lòng thử lại.";
    submit.disabled = false;
  }
});

$("#categories").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderCategories();
  try { state.products = await api(`/api/products${state.category ? `?category=${encodeURIComponent(state.category)}` : ""}`); renderProducts(); }
  catch (exception) { $("#products").innerHTML = `<p class="loading">${escapeHtml(exception.message)}</p>`; }
});

$("#search").addEventListener("input", (event) => { state.query = event.target.value.trim(); renderProducts(); });
$("#products").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  const product = state.products.find((item) => item.id === Number(button.dataset.add));
  if (!product) return;
  addProductToCart(product);
});

$("#cart-items").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity]");
  if (!button) return;
  const item = state.cart.find((entry) => entry.id === Number(button.dataset.quantity));
  if (item) item.quantity += Number(button.dataset.delta);
  state.cart = state.cart.filter((entry) => entry.quantity > 0);
  persistCart();
});

function setCartOpen(open) {
  $("#cart-drawer").classList.toggle("open", open);
  $("#cart-drawer").setAttribute("aria-hidden", String(!open));
  $("#cart-backdrop").hidden = !open;
}
$("#open-cart").addEventListener("click", () => setCartOpen(true));
$("#close-cart").addEventListener("click", () => setCartOpen(false));
$("#cart-backdrop").addEventListener("click", () => setCartOpen(false));

$("#checkout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const message = $("#checkout-message");
  const paymentPanel = $("#checkout-payment");
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  message.textContent = "Đang gửi đơn hàng...";
  paymentPanel.hidden = true;
  paymentPanel.replaceChildren();
  try {
    const order = await api("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: { name: form.get("name"), phone: form.get("phone"), email: form.get("email"), address: form.get("address") }, paymentMethod: form.get("paymentMethod"), items: state.cart.map(({ id, quantity }) => ({ productId: id, quantity })) }) });
    state.cart = [];
    persistCart();
    formElement.reset();
    message.textContent = order.payment?.method === "vietqr"
      ? `Đã tạo đơn #${order.id} · ${money(order.total)}. Quét mã VietQR bên dưới để chuyển khoản.`
      : `Đặt hàng thành công! Mã đơn #${order.id} · ${money(order.total)}`;
    if (order.payment?.method === "vietqr") {
      const heading = document.createElement("h3");
      heading.textContent = "Thanh toán VietQR";
      const image = document.createElement("img");
      image.src = order.payment.qrUrl;
      image.alt = `Mã QR thanh toán đơn hàng ${order.id}, số tiền ${money(order.total)}`;
      image.loading = "lazy";
      const instructions = document.createElement("p");
      instructions.textContent = `Số tiền: ${money(order.total)} · Nội dung chuyển khoản: ${order.payment.transferContent}`;
      const notice = document.createElement("p");
      notice.className = "payment-notice";
      notice.textContent = order.payment.adminNotification === "sent"
        ? "Đã gửi yêu cầu duyệt cho cửa hàng qua Telegram. Đơn chỉ được xác nhận sau khi cửa hàng duyệt và kiểm tra tiền về."
        : order.payment.adminNotification === "failed"
          ? "Không gửi được thông báo Telegram cho cửa hàng. Đơn đã tạo nhưng đang chờ xác nhận; vui lòng liên hệ trực tiếp."
          : "Telegram chưa được cấu hình. Đơn đã tạo nhưng đang chờ cửa hàng xác nhận; vui lòng liên hệ trực tiếp.";
      paymentPanel.append(heading, image, instructions, notice);
      paymentPanel.hidden = false;
    }
    state.products = await api("/api/products");
    renderProducts();
  } catch (exception) { message.textContent = exception.message; }
  finally { submit.disabled = !state.cart.length; }
});

async function init() {
  try {
    [state.categories, state.products] = await Promise.all([api("/api/categories"), api("/api/products")]);
    renderCategories();
    renderProducts();
    renderCart();
  } catch (exception) { $("#products").innerHTML = `<p class="loading">${escapeHtml(exception.message)} Vui lòng tải lại trang.</p>`; }
}
restoreChatSession();
if (chatSession.pendingMessage) processChatMessage(chatSession.pendingMessage);
init();
const money = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
const fallbackImage = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80";
const state = { products: [], categories: [], cart: JSON.parse(localStorage.getItem("cho-nha-cart") || "[]"), category: "", query: "" };
const chatHistory = [{ role: "assistant", content: "Chào bạn! Mình có thể giúp tìm món trong cửa hàng hoặc giải đáp về cách đặt hàng, thanh toán." }];
const chatProducts = new Map();
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const imageUrl = (product) => product?.image_url || product?.imageUrl || fallbackImage;
const imageErrorHandler = `this.onerror=null;this.src='${fallbackImage}'`;

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Đã có lỗi xảy ra.");
  return data;
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

function appendChatMessage(role, content, products = []) {
  const message = document.createElement("div");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  message.append(paragraph);
  if (products.length) {
    const results = document.createElement("div");
    results.className = "chat-product-results";
    products.forEach((product) => {
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
      add.dataset.chatAdd = product.id;
      add.setAttribute("aria-label", `Thêm ${product.name} vào giỏ`);
      add.textContent = "+";
      item.append(image, details, add);
      results.append(item);
    });
    message.append(results);
  }
  $("#chat-messages").append(message);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function setChatOpen(open) {
  const panel = $("#chat-panel");
  panel.hidden = !open;
  panel.setAttribute("aria-hidden", String(!open));
  $("#chat-launcher").setAttribute("aria-expanded", String(open));
  if (open) $("#chat-input").focus();
}

$("#chat-launcher").addEventListener("click", () => setChatOpen(true));
$("#chat-close").addEventListener("click", () => setChatOpen(false));
$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const submit = event.currentTarget.querySelector("button[type=submit]");
  const message = input.value.trim();
  if (!message) return;
  chatHistory.push({ role: "user", content: message });
  appendChatMessage("user", message);
  input.value = "";
  input.disabled = true;
  submit.disabled = true;
  const typing = document.createElement("div");
  typing.className = "chat-message assistant-message chat-typing";
  typing.textContent = "Đang soạn câu trả lời...";
  $("#chat-messages").append(typing);
  try {
    const answer = await api("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, history: chatHistory.slice(-8) }) });
    typing.remove();
    appendChatMessage("assistant", answer.reply, answer.products || []);
    chatHistory.push({ role: "assistant", content: answer.reply });
    if (chatHistory.length > 9) chatHistory.splice(1, chatHistory.length - 9);
  } catch (exception) {
    typing.remove();
    appendChatMessage("assistant", exception.message || "Chưa gửi được tin nhắn. Bạn thử lại nhé.");
  } finally {
    input.disabled = false;
    submit.disabled = false;
    input.focus();
  }
});

$("#chat-messages").addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-add]");
  if (!button) return;
  const product = chatProducts.get(Number(button.dataset.chatAdd));
  if (product) addProductToCart(product);
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
  const form = new FormData(event.currentTarget);
  const message = $("#checkout-message");
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  message.textContent = "Đang gửi đơn hàng...";
  try {
    const order = await api("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: { name: form.get("name"), phone: form.get("phone"), email: form.get("email"), address: form.get("address") }, paymentMethod: form.get("paymentMethod"), items: state.cart.map(({ id, quantity }) => ({ productId: id, quantity })) }) });
    state.cart = [];
    persistCart();
    event.currentTarget.reset();
    message.textContent = `Đặt hàng thành công! Mã đơn #${order.id} · ${money(order.total)}`;
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
init();
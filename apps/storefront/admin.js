const $ = (selector) => document.querySelector(selector);
const money = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
const date = (value) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(`${value.replace(" ", "T")}Z`));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const paymentMethodName = (value) => ({ cod: "Khi nhận hàng", bank_transfer: "Chuyển khoản", vietqr: "VietQR", momo: "MoMo", vnpay: "VNPay" })[value] || value;
const paymentStatusControl = (order) => order.payment_method === "vietqr" && order.status === "cancelled" && order.payment_status === "unpaid"
  ? "<span>Bị từ chối</span>"
  : `<select class="status-select" data-payment-order="${order.id}" aria-label="Trạng thái thanh toán đơn ${order.id}">${[["unpaid","Chưa thanh toán"],["pending","Chờ thanh toán"],["paid","Đã nhận tiền"]].map(([value,label]) => `<option value="${value}" ${order.payment_status === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
let token = sessionStorage.getItem("cho-nha-admin-token") || "";
let data = { products: [], categories: [], orders: [], customers: [] };
let activeTab = "orders";
let analyticsRequest = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Đã có lỗi xảy ra.");
  return result;
}

function setAuthenticated(authenticated) {
  $("#login-panel").hidden = authenticated;
  $("#dashboard").hidden = !authenticated;
  $("#logout").hidden = !authenticated;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2200);
}

async function loadDashboard() {
  const [summary, products, categories, orders, customers] = await Promise.all([api("/api/admin/summary"), api("/api/admin/products"), api("/api/categories"), api("/api/admin/orders"), api("/api/admin/customers")]);
  data = { products, categories, orders, customers };
  $("#metrics").innerHTML = [["Sản phẩm", summary.products], ["Danh mục", summary.categories], ["Đơn hàng", summary.orders], ["Khách hàng", summary.customers]].map(([label, count]) => `<div class="metric"><span>${label}</span><strong>${count}</strong></div>`).join("");
  renderTab();
}

function renderTab() {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === activeTab));
  const target = $("#admin-content");
  $("#add-product").hidden = activeTab === "analytics";
  if (activeTab === "orders") {
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>MÃ ĐƠN</th><th>KHÁCH HÀNG</th><th>SẢN PHẨM</th><th>TỔNG TIỀN</th><th>THANH TOÁN</th><th>NGÀY ĐẶT</th><th>TRẠNG THÁI ĐƠN</th></tr></thead><tbody>${data.orders.map((order) => `<tr><td><strong>#${order.id}</strong></td><td>${escapeHtml(order.customer_name)}<br><span>${escapeHtml(order.phone)}</span></td><td>${escapeHtml(order.items || "—")}</td><td>${money(order.total)}</td><td>${escapeHtml(paymentMethodName(order.payment_method))}<br>${paymentStatusControl(order)}</td><td>${date(order.created_at)}</td><td><select class="status-select" data-order="${order.id}" aria-label="Trạng thái đơn ${order.id}">${[["pending","Chờ xác nhận"],["confirmed","Đã xác nhận"],["shipping","Đang giao"],["completed","Hoàn tất"],["cancelled","Đã hủy"]].map(([value,label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>${data.orders.length ? "" : "<p class=\"empty-state\">Chưa có đơn hàng nào.</p>"}</div>`;
  } else if (activeTab === "products") {
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>SẢN PHẨM</th><th>DANH MỤC</th><th>GIÁ</th><th>TỒN KHO</th><th></th></tr></thead><tbody>${data.products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.category_name || "Chưa phân loại")}</td><td>${money(product.price)}</td><td>${product.stock}</td><td><div class="row-actions"><button data-edit="${product.id}">Sửa</button><button class="delete" data-delete-product="${product.id}">Xóa</button></div></td></tr>`).join("")}</tbody></table>${data.products.length ? "" : "<p class=\"empty-state\">Chưa có sản phẩm nào.</p>"}</div>`;
  } else if (activeTab === "categories") {
    target.innerHTML = `<div class="content-heading"><h2>Danh mục sản phẩm</h2></div><form class="category-add" id="category-form"><input name="name" placeholder="Tên danh mục mới" required><button class="primary-button">Thêm danh mục</button></form>${data.categories.map((category) => `<div class="category-row"><span>${escapeHtml(category.name)}</span><button class="small-button" data-delete-category="${category.id}">Xóa</button></div>`).join("")}`;
  } else if (activeTab === "customers") {
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>KHÁCH HÀNG</th><th>LIÊN HỆ</th><th>ĐỊA CHỈ</th><th>SỐ ĐƠN</th><th>ĐÃ MUA</th></tr></thead><tbody>${data.customers.map((customer) => `<tr><td><strong>${escapeHtml(customer.name)}</strong></td><td>${escapeHtml(customer.email)}<br><span>${escapeHtml(customer.phone)}</span></td><td>${escapeHtml(customer.address)}</td><td>${customer.order_count}</td><td>${money(customer.lifetime_value)}</td></tr>`).join("")}</tbody></table>${data.customers.length ? "" : "<p class=\"empty-state\">Chưa có khách hàng nào.</p>"}</div>`;
  } else {
    target.innerHTML = `<div class="analytics-heading"><h2>Lượt xem cửa hàng</h2><label>Khoảng thời gian <select id="analytics-days" aria-label="Khoảng thời gian phân tích"><option value="7">7 ngày</option><option value="30" selected>30 ngày</option><option value="90">90 ngày</option></select></label></div><p class="analytics-note">Thống kê lượt tải trang chủ theo ngày. Quốc gia lấy từ Cloudflare; hệ điều hành được phân loại từ trình duyệt. Không lưu IP, cookie, định danh người dùng hay thông tin cá nhân. Lượt xem không đại diện cho số khách duy nhất.</p><p id="analytics-loading" class="empty-state">Đang tải thống kê…</p><div id="analytics-results"></div>`;
    loadAnalytics(30);
  }
}

async function loadAnalytics(days) {
  const requestNumber = ++analyticsRequest;
  $("#analytics-loading").textContent = "Đang tải thống kê…";
  $("#analytics-loading").hidden = false;
  $("#analytics-results").replaceChildren();
  try {
    const result = await api(`/api/admin/analytics?days=${days}`);
    if (requestNumber !== analyticsRequest || activeTab !== "analytics") return;
    const countries = result.countries.map((item) => `<li><span>${item.country === "ZZ" ? "Không xác định" : escapeHtml(item.country)}</span><strong>${Number(item.views).toLocaleString("vi-VN")}</strong></li>`).join("");
    const systems = result.operatingSystems.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${Number(item.views).toLocaleString("vi-VN")}</strong></li>`).join("");
    const daysByDate = new Map(result.timeline.map((item) => [item.day, Number(item.views)]));
    const timeline = Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - (days - index - 1));
      const key = date.toISOString().slice(0, 10);
      return { day: key, views: daysByDate.get(key) || 0 };
    });
    const maxViews = Math.max(1, ...timeline.map((item) => item.views));
    $("#analytics-loading").hidden = true;
    $("#analytics-results").innerHTML = `<div class="analytics-cards"><div class="analytics-card"><span>Lượt xem trong ${days} ngày</span><strong>${Number(result.views).toLocaleString("vi-VN")}</strong></div><div class="analytics-card"><span>Quốc gia/vùng lãnh thổ</span><strong>${result.countries.filter((item) => item.country !== "ZZ").length}</strong></div><div class="analytics-card"><span>Hệ điều hành</span><strong>${result.operatingSystems.length}</strong></div></div><section><h3>Dòng thời gian lượt xem</h3><div class="timeline" aria-label="Biểu đồ lượt xem theo ngày">${timeline.map((item) => `<div class="timeline-day" title="${item.day}: ${item.views} lượt xem"><span class="timeline-label">${item.day.slice(5)}</span><span class="timeline-bar" style="height:${Math.max(2, item.views / maxViews * 130)}px"></span></div>`).join("")}</div></section><div class="analytics-grid"><section><h3>Lượt xem theo quốc gia</h3><ul class="analytics-list">${countries || "<li>Chưa có dữ liệu</li>"}</ul></section><section><h3>Lượt xem theo hệ điều hành</h3><ul class="analytics-list">${systems || "<li>Chưa có dữ liệu</li>"}</ul></section></div>`;
  } catch (exception) {
    if (requestNumber !== analyticsRequest) return;
    $("#analytics-loading").hidden = true;
    $("#analytics-results").innerHTML = `<p class="analytics-error">${escapeHtml(exception.message)}</p>`;
  }
}

function openProduct(product = null) {
  const form = $("#product-form");
  form.reset();
  form.elements.id.value = product?.id || "";
  form.elements.name.value = product?.name || "";
  form.elements.description.value = product?.description || "";
  form.elements.price.value = product?.price || "";
  form.elements.stock.value = product?.stock ?? 0;
  form.elements.imageUrl.value = product?.image_url || "";
  form.elements.featured.checked = Boolean(product?.featured);
  $("#product-category").innerHTML = `<option value="">Chưa phân loại</option>${data.categories.map((category) => `<option value="${category.id}" ${product?.category_id === category.id ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}`;
  $("#dialog-title").textContent = product ? "Sửa sản phẩm" : "Thêm sản phẩm";
  $("#product-dialog").showModal();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  token = $("#admin-token").value;
  $("#login-message").textContent = "Đang kiểm tra...";
  try {
    await loadDashboard();
    sessionStorage.setItem("cho-nha-admin-token", token);
    setAuthenticated(true);
  } catch (exception) { $("#login-message").textContent = exception.message; token = ""; }
});

$("#logout").addEventListener("click", () => { token = ""; sessionStorage.removeItem("cho-nha-admin-token"); setAuthenticated(false); });
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => { activeTab = tab.dataset.tab; renderTab(); }));
$("#admin-content").addEventListener("change", (event) => {
  if (event.target.id === "analytics-days") loadAnalytics(Number(event.target.value));
});
$("#add-product").addEventListener("click", () => openProduct());
$("#admin-content").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  if (edit) return openProduct(data.products.find((product) => product.id === Number(edit.dataset.edit)));
  const removeProduct = event.target.closest("[data-delete-product]");
  const removeCategory = event.target.closest("[data-delete-category]");
  try {
    if (removeProduct && confirm("Xóa sản phẩm này?")) await api(`/api/admin/products/${removeProduct.dataset.deleteProduct}`, { method: "DELETE" });
    else if (removeCategory && confirm("Xóa danh mục này? Sản phẩm thuộc danh mục sẽ chuyển thành chưa phân loại.")) await api(`/api/admin/categories/${removeCategory.dataset.deleteCategory}`, { method: "DELETE" });
    else return;
    await loadDashboard();
    toast("Đã cập nhật cửa hàng");
  } catch (exception) { toast(exception.message); }
});

$("#admin-content").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order]");
  const paymentSelect = event.target.closest("[data-payment-order]");
  if (!select && !paymentSelect) return;
  const orderId = select?.dataset.order || paymentSelect.dataset.paymentOrder;
  const update = select ? { status: select.value } : { paymentStatus: paymentSelect.value };
  try { await api(`/api/admin/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(update) }); toast(select ? "Đã cập nhật trạng thái đơn hàng" : "Đã cập nhật trạng thái thanh toán"); await loadDashboard(); }
  catch (exception) { toast(exception.message); }
});

$("#admin-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "category-form") return;
  event.preventDefault();
  try { await api("/api/admin/categories", { method: "POST", body: JSON.stringify({ name: new FormData(event.target).get("name") }) }); await loadDashboard(); toast("Đã thêm danh mục"); }
  catch (exception) { toast(exception.message); }
});

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = form.get("id");
  const product = { name: form.get("name"), description: form.get("description"), price: Number(form.get("price")), stock: Number(form.get("stock")), categoryId: form.get("categoryId") ? Number(form.get("categoryId")) : null, imageUrl: form.get("imageUrl"), featured: form.get("featured") === "on" };
  try { await api(id ? `/api/admin/products/${id}` : "/api/admin/products", { method: id ? "PUT" : "POST", body: JSON.stringify(product) }); $("#product-dialog").close(); activeTab = "products"; await loadDashboard(); toast("Đã lưu sản phẩm"); }
  catch (exception) { toast(exception.message); }
});

async function restoreSession() {
  if (!token) return setAuthenticated(false);
  try { await loadDashboard(); setAuthenticated(true); }
  catch { token = ""; sessionStorage.removeItem("cho-nha-admin-token"); setAuthenticated(false); }
}
restoreSession();
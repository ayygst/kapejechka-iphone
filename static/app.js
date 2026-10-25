const $ = (selector) => document.querySelector(selector);
function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const STORAGE_KEY = "kapejechka-local-v1";
const DEFAULT_CATEGORIES = ["🍔 Їжа", "🛒 Продукти", "🚕 Транспорт", "🏠 Дім", "💊 Здоров'я", "🎮 Розваги", "🛍️ Покупки", "📱 Підписки", "💳 Платежі", "✈️ Подорожі", "🎁 Подарунки", "📦 Інше"];
const state = { month: localDateString().slice(0, 7), kind: "all", category: "", data: null, editId: null, formKind: "expense" };
const monthNames = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return `${monthNames[number - 1]} ${year}`;
}

function shiftMonth(amount) {
  const [year, month] = state.month.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  state.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  refresh();
}

function money(value) {
  return `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${state.data?.currency || "PLN"}`;
}

function dateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(date).replace(" р.", "");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2400);
}

async function api(path, options = {}) {
  const db = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { categories: DEFAULT_CATEGORIES, transactions: [], nextId: 1 };
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  const method = options.method || "GET";
  if (path.startsWith("/api/data")) {
    const month = new URLSearchParams(path.split("?")[1] || "").get("month") || state.month;
    const transactions = db.transactions.filter((item) => String(item.created_at).slice(0, 7) === month).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const expenses = transactions.filter((item) => item.kind === "expense");
    const income = transactions.filter((item) => item.kind === "income");
    const grouped = new Map();
    expenses.forEach((item) => { const row = grouped.get(item.category) || { name: item.category, total: 0, count: 0 }; row.total += Number(item.amount); row.count++; grouped.set(item.category, row); });
    return { month, currency: "PLN", categories: db.categories, transactions, expenses: { amount: expenses.reduce((s, x) => s + Number(x.amount), 0) }, income: { amount: income.reduce((s, x) => s + Number(x.amount), 0) }, category_totals: [...grouped.values()].sort((a, b) => b.total - a.total) };
  }
  if (path === "/api/session") return { authenticated: true };
  if (path === "/api/login") return { csrf: "local" };
  if (path === "/api/logout") return { ok: true };
  if (path === "/api/categories" && method === "POST") {
    const name = String(JSON.parse(options.body || "{}").name || "").trim();
    if (!name) throw new Error("Введіть назву категорії.");
    if (db.categories.includes(name)) throw new Error("Така категорія вже є.");
    db.categories.push(name); save(); return { ok: true };
  }
  const match = path.match(/^\/api\/transactions(?:\/(\d+))?$/);
  if (match) {
    const id = Number(match[1]);
    if (method === "POST") {
      const item = { ...JSON.parse(options.body || "{}"), id: db.nextId++ };
      db.transactions.push(item); save(); return { transaction: item };
    }
    if (method === "PATCH") {
      const index = db.transactions.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Операцію не знайдено.");
      db.transactions[index] = { ...db.transactions[index], ...JSON.parse(options.body || "{}") }; save(); return { transaction: db.transactions[index] };
    }
    if (method === "DELETE") { db.transactions = db.transactions.filter((item) => item.id !== id); save(); return { ok: true }; }
  }
  throw new Error("Не вдалося виконати дію.");
}

function showLogin() {
  $("#app").hidden = true;
  $("#login-screen").hidden = false;
  state.csrf = "";
}

async function enterApp(csrf) {
  state.csrf = csrf || "";
  $("#login-screen").hidden = true;
  $("#app").hidden = false;
  await refresh();
}

async function refresh() {
  try {
    state.data = await api(`/api/data?month=${encodeURIComponent(state.month)}&kind=all`);
    draw();
  } catch (error) {
    if (error.message) toast(error.message);
  }
}

function transactionMarkup(item) {
  const income = item.kind === "income";
  const title = income ? item.category : item.category;
  const detail = income ? "Дохід" : (item.description || "Витрата");
  const sign = income ? "+" : "−";
  return `<article class="transaction-item">
    <div class="transaction-icon ${income ? "income" : ""}">${income ? "↙" : "↗"}</div>
    <div class="transaction-main"><div class="transaction-name">${escapeHtml(title)}</div><div class="transaction-date">${escapeHtml(detail)} · ${escapeHtml(dateLabel(item.created_at))}</div></div>
    <div class="transaction-right"><div class="transaction-amount ${income ? "" : "expense"}">${sign}${escapeHtml(money(item.amount))}</div><div class="transaction-actions"><button class="mini-action" data-edit="${item.id}" aria-label="Редагувати">Змінити</button><button class="mini-action" data-delete="${item.id}" aria-label="Видалити">Видалити</button></div></div>
  </article>`;
}

function fillCategorySelect(select, selected = "") {
  const categories = state.data?.categories || [];
  select.innerHTML = categories.map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
}

function draw() {
  if (!state.data) return;
  const data = state.data;
  const total = data.income.amount - data.expenses.amount;
  $("#home-month").textContent = monthLabel(state.month);
  $("#history-month").textContent = monthLabel(state.month);
  $("#category-month").textContent = monthLabel(state.month);
  $("#month-short").textContent = monthLabel(state.month);
  $("#balance").textContent = money(total);
  $("#balance").classList.toggle("negative", total < 0);
  $("#income-total").textContent = money(data.income.amount);
  $("#expense-total").textContent = money(data.expenses.amount);
  const latest = [...data.transactions].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  $("#recent-list").innerHTML = latest.slice(0, 5).map(transactionMarkup).join("");
  $("#home-empty").hidden = latest.length > 0;

  const categoryTotals = new Map(data.category_totals.map((row) => [row.name, row]));
  $("#category-list").innerHTML = data.categories.map((name) => {
    const row = categoryTotals.get(name) || { total: 0, count: 0 };
    return `<article class="category-row"><div class="category-name">${escapeHtml(name)}</div><div class="category-total">${escapeHtml(money(row.total))}<div class="category-count">${row.count} операцій</div></div></article>`;
  }).join("");

  const categoryFilter = $("#category-filter");
  const oldFilter = state.category;
  categoryFilter.innerHTML = `<option value="">Усі категорії</option>${data.categories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  categoryFilter.value = data.categories.includes(oldFilter) ? oldFilter : "";
  state.category = categoryFilter.value;
  $("#category-filter-wrap").hidden = state.kind !== "expense";
  document.querySelectorAll("#type-tabs .filter").forEach((button) => button.classList.toggle("active", button.dataset.kind === state.kind));
  const filtered = data.transactions.filter((item) => (state.kind === "all" || item.kind === state.kind) && (!state.category || item.category === state.category));
  $("#history-caption").textContent = state.category || ({ all: "Усі операції", expense: "Витрати", income: "Доходи" })[state.kind];
  $("#history-count").textContent = `${filtered.length}${data.transactions.length === 300 ? "+" : ""} записів`;
  $("#history-list").innerHTML = filtered.map(transactionMarkup).join("");
  $("#history-empty").hidden = filtered.length > 0;
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === `screen-${name}`));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.screen === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setFormKind(kind) {
  state.formKind = kind;
  document.querySelectorAll("[data-form-kind]").forEach((button) => button.classList.toggle("active", button.dataset.formKind === kind));
  const expense = kind === "expense";
  $("#category-label").textContent = expense ? "Категорія" : "Джерело доходу";
  $("#description-label").hidden = !expense;
  $("#description").hidden = !expense;
  $("#transaction-category").hidden = !expense;
  $("#transaction-category").required = expense;
  $("#income-source").hidden = expense;
  $("#income-source").required = !expense;
  if (expense) fillCategorySelect($("#transaction-category"));
}

function openModal(item = null, kind = "expense") {
  state.editId = item?.id ?? null;
  const formKind = item?.kind || kind;
  $("#modal-eyebrow").textContent = item ? "РЕДАГУВАННЯ ЗАПИСУ" : "НОВА ОПЕРАЦІЯ";
  $("#modal-title").textContent = item ? "Змінити операцію" : "Додати запис";
  $("#save-button").innerHTML = item ? 'Зберегти зміни <span>→</span>' : 'Зберегти запис <span>→</span>';
  $("#delete-button").hidden = !item;
  $("#form-switch").hidden = !!item;
  $("#amount").value = item ? String(item.amount).replace(".", ",") : "";
  $("#description").value = item?.description || "";
  $("#transaction-date").value = item ? String(item.created_at).slice(0, 10) : localDateString();
  $("#income-source").value = item?.category || "";
  setFormKind(formKind);
  if (item && item.kind === "expense") fillCategorySelect($("#transaction-category"), item.category);
  $("#transaction-modal").hidden = false;
  document.body.classList.add("modal-open");
  setTimeout(() => $("#amount").focus(), 150);
}

function closeModal() {
  $("#transaction-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

async function handleTransactionAction(event) {
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-delete]");
  if (edit) {
    const item = state.data.transactions.find((row) => String(row.id) === edit.dataset.edit);
    if (item) openModal(item);
  }
  if (remove) {
    if (!window.confirm("Видалити цю операцію?")) return;
    try {
      await api(`/api/transactions/${remove.dataset.delete}`, { method: "DELETE" });
      toast("Операцію видалено");
      await refresh();
    } catch (error) { toast(error.message); }
  }
}

async function boot() {
  try {
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!db) localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories: DEFAULT_CATEGORIES, transactions: [], nextId: 1 }));
    await enterApp("local");
  } catch (_) { toast("Не вдалося відкрити локальне сховище цього iPhone."); }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").hidden = true;
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    await enterApp(result.csrf);
  } catch (error) {
    $("#login-error").textContent = error.message;
    $("#login-error").hidden = false;
  }
});

document.querySelectorAll("[data-shift]").forEach((button) => button.addEventListener("click", () => shiftMonth(Number(button.dataset.shift))));
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.open)));
$("#type-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-kind]");
  if (!button) return;
  state.kind = button.dataset.kind;
  if (state.kind !== "expense") state.category = "";
  draw();
});
$("#category-filter").addEventListener("change", (event) => { state.category = event.target.value; draw(); });
$("#recent-list").addEventListener("click", handleTransactionAction);
$("#history-list").addEventListener("click", handleTransactionAction);
$("#add-button").addEventListener("click", () => openModal());
$("#close-modal").addEventListener("click", closeModal);
$("#transaction-modal").addEventListener("click", (event) => { if (event.target === $("#transaction-modal")) closeModal(); });
document.querySelectorAll("[data-form-kind]").forEach((button) => button.addEventListener("click", () => setFormKind(button.dataset.formKind)));

$("#transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = state.formKind;
  const payload = {
    kind,
    amount: $("#amount").value,
    category: kind === "expense" ? $("#transaction-category").value : $("#income-source").value.trim(),
    description: kind === "expense" ? $("#description").value.trim() : "",
    created_at: $("#transaction-date").value,
  };
  try {
    await api(state.editId ? `/api/transactions/${state.editId}` : "/api/transactions", {
      method: state.editId ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
    closeModal();
    toast(state.editId ? "Зміни збережено" : "Операцію додано");
    await refresh();
  } catch (error) { toast(error.message); }
});

$("#delete-button").addEventListener("click", async () => {
  if (!state.editId || !window.confirm("Видалити цю операцію?")) return;
  try {
    await api(`/api/transactions/${state.editId}`, { method: "DELETE" });
    closeModal(); toast("Операцію видалено"); await refresh();
  } catch (error) { toast(error.message); }
});

$("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#category-name");
  try {
    await api("/api/categories", { method: "POST", body: JSON.stringify({ name: input.value.trim() }) });
    input.value = ""; toast("Категорію додано"); await refresh();
  } catch (error) { toast(error.message); }
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/static/sw.js").catch(() => {}));
boot();

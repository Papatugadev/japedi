// ✅ Import por namespace (mais robusto que named imports)
import * as FirebaseApp from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import * as Firestore from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import * as Auth from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/** Firebase config (público do front) */
const firebaseConfig = {
  apiKey: "AIzaSyAQsb1pCGm6BNkGuKBDsBzXdnyHAyH1JXc",
  authDomain: "japed-e09f2.firebaseapp.com",
  projectId: "japed-e09f2",
  storageBucket: "japed-e09f2.firebasestorage.app",
  messagingSenderId: "715293947768",
  appId: "1:715293947768:web:66c67dc1c33953c0ec3a8d"
};

console.log("APP.JS CARREGOU ✅");
console.log("IMPORT FIREBASE OK ✅", typeof FirebaseApp.initializeApp);

// Init Firebase
const app = FirebaseApp.initializeApp(firebaseConfig);
const db = Firestore.getFirestore(app);
const auth = Auth.getAuth(app);

/* =========================
   AUTH ANÔNIMO (cliente)
   ========================= */

let __authReadyResolve;
const authReady = new Promise((res) => { __authReadyResolve = res; });

Auth.onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      await Auth.signInAnonymously(auth);
      return; // vai disparar novamente com user
    }
    state.customerUid = user.uid;
    __authReadyResolve();
  } catch (e) {
    console.warn("Falha no auth anônimo:", e?.code || e, e?.message || "");
    __authReadyResolve(); // não trava o app
  }
});

async function ensureAnonAuth() {
  await authReady;
  return state.customerUid;
}

/* =========================
   Persistência do último pedido
   ========================= */

function lastOrderKey() {
  return `japed:lastOrder:${state.restaurant?.id || state.slug || "unknown"}`;
}

function saveLastOrder(orderId, orderNumber) {
  try {
    localStorage.setItem(
      lastOrderKey(),
      JSON.stringify({ orderId, orderNumber: orderNumber || null, ts: Date.now() })
    );
  } catch (_) {}
}

function loadLastOrder() {
  try {
    const raw = localStorage.getItem(lastOrderKey());
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.orderId) return null;
    if (obj.ts && Date.now() - obj.ts > 48 * 60 * 60 * 1000) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function forgetLastOrder() {
  try { localStorage.removeItem(lastOrderKey()); } catch (_) {}
}

const state = {
  slug: null,
  restaurant: null,
  products: [],
  cart: [], // [{id,name,price,qty}]
  currentOrderId: null,
  currentOrderNumber: null,
  customerUid: null,
  unsubTrack: null,
  unsubChat: null
};

/** Util: formatar BRL */
function moneyBRL(value) {
  const v = Number(value || 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Util: gera número de pedido (4 dígitos) para exibir como #1234 */
function genOrderNumber4() {
  return Math.floor(1000 + Math.random() * 9000);
}

/** Pega slug por ?r=slug (local) ou /r/slug (vercel) */
function getSlug() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("r");
  if (fromQuery) return fromQuery;

  const parts = (window.location.pathname || "/").split("/").filter(Boolean);
  if (parts[0] === "r" && parts[1]) return parts[1];

  return null;
}

/** Buscar restaurante pelo slug (multi-tenant) */
async function fetchRestaurantBySlug(slug) {
  const q = Firestore.query(
    Firestore.collection(db, "restaurants"),
    Firestore.where("slug", "==", slug)
  );

  const snap = await Firestore.getDocs(q);
  if (snap.empty) return null;

  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/** Buscar produtos do restaurante */
async function fetchProducts(restaurantId) {
  const ref = Firestore.collection(db, "restaurants", restaurantId, "products");
  const snap = await Firestore.getDocs(ref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* =========================
   CARRINHO (LÓGICA)
   ========================= */

function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;

  const existing = state.cart.find(i => i.id === productId);

  if (existing) existing.qty += 1;
  else {
    state.cart.push({
      id: p.id,
      name: p.name || "Produto",
      price: Number(p.price || 0),
      qty: 1
    });
  }

  renderCartUI();
}

function changeQty(productId, delta) {
  const item = state.cart.find(i => i.id === productId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(i => i.id !== productId);

  renderCartUI();
}

function cartTotals() {
  const qty = state.cart.reduce((acc, i) => acc + i.qty, 0);
  const subtotal = state.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  return { qty, subtotal };
}

/* =========================
   UI (RENDER)
   ========================= */

function renderProducts() {
  const titleEl = document.getElementById("title");
  const descEl = document.getElementById("desc");
  const wrap = document.getElementById("products");

  if (!state.restaurant) {
    titleEl.textContent = "Carregando...";
    descEl.textContent = "";
    wrap.innerHTML = "";
    return;
  }

  titleEl.textContent = state.restaurant.name || "Restaurante";
  descEl.textContent = state.restaurant.whatsapp ? `WhatsApp: ${state.restaurant.whatsapp}` : "";

  wrap.innerHTML = "";

  const activeProducts = state.products
    .filter(p => p.active !== false)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (activeProducts.length === 0) {
    wrap.innerHTML = `<p>Nenhum produto disponível.</p>`;
    return;
  }

  for (const p of activeProducts) {
    const div = document.createElement("div");
    div.className = "box";
    div.innerHTML = `
      <div><strong>${p.name || "Produto"}</strong></div>
      <div class="muted" style="margin-top:6px">${p.desc || ""}</div>
      <div class="price">${moneyBRL(p.price)}</div>
      <button class="btn" data-add="${p.id}">Adicionar</button>
    `;
    wrap.appendChild(div);
  }

  wrap.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => addToCart(btn.getAttribute("data-add")));
  });
}

function renderCartUI() {
  const badge = document.getElementById("cartBadge");
  const cartBar = document.getElementById("cartBar");
  const cartBarQty = document.getElementById("cartBarQty");
  const cartBarTotal = document.getElementById("cartBarTotal");
  const cartItems = document.getElementById("cartItems");
  const cartSubtotal = document.getElementById("cartSubtotal");

  const { qty, subtotal } = cartTotals();

  if (qty > 0) {
    badge.classList.remove("hidden");
    badge.textContent = String(qty);
  } else {
    badge.classList.add("hidden");
    badge.textContent = "0";
  }

  if (qty > 0) {
    cartBar.classList.remove("hidden");
    cartBarQty.textContent = qty === 1 ? "1 item" : `${qty} itens`;
    cartBarTotal.textContent = moneyBRL(subtotal);
  } else {
    cartBar.classList.add("hidden");
  }

  cartItems.innerHTML = "";

  if (state.cart.length === 0) {
    cartItems.innerHTML = `<p class="muted">Seu carrinho está vazio.</p>`;
  } else {
    for (const item of state.cart) {
      const row = document.createElement("div");
      row.className = "cartitem";
      row.innerHTML = `
        <div>
          <strong>${item.name}</strong><br/>
          <span class="muted">${moneyBRL(item.price)} cada</span>
        </div>

        <div class="qty">
          <button type="button" data-dec="${item.id}">-</button>
          <strong>${item.qty}</strong>
          <button type="button" data-inc="${item.id}">+</button>
        </div>
      `;
      cartItems.appendChild(row);
    }

    cartItems.querySelectorAll("[data-inc]").forEach(b =>
      b.addEventListener("click", () => changeQty(b.getAttribute("data-inc"), +1))
    );
    cartItems.querySelectorAll("[data-dec]").forEach(b =>
      b.addEventListener("click", () => changeQty(b.getAttribute("data-dec"), -1))
    );
  }

  cartSubtotal.textContent = moneyBRL(subtotal);
}

/* =========================
   Drawer open/close
   ========================= */

function openCartDrawer() {
  document.getElementById("cartDrawer").classList.remove("hidden");
}

function closeCartDrawer() {
  document.getElementById("cartDrawer").classList.add("hidden");
}

/* =========================
   Checkout modal open/close
   ========================= */

function openCheckout() {
  document.getElementById("checkoutModal").classList.remove("hidden");
}

function closeCheckout() {
  document.getElementById("checkoutModal").classList.add("hidden");
}

function clearCheckoutInputs() {
  document.getElementById("custName").value = "";
  document.getElementById("custPhone").value = "";
  document.getElementById("custAddr").value = "";
}

/* =========================
   Criar pedido no Firestore
   ========================= */

async function createOrder() {
  await ensureAnonAuth();
  const name = (document.getElementById("custName").value || "").trim();
  const phone = (document.getElementById("custPhone").value || "").trim();
  const address = (document.getElementById("custAddr").value || "").trim();

  if (!name) return alert("Digite seu nome.");
  if (state.cart.length === 0) return alert("Carrinho vazio.");

  const { subtotal, qty } = cartTotals();

  const orderData = {
    status: "recebido",
    createdAt: Firestore.serverTimestamp(),
    updatedAt: Firestore.serverTimestamp(),
    orderNumber: genOrderNumber4(),
    customer: { name, phone, address },
    items: state.cart.map(i => ({
      id: i.id,
      name: i.name,
      price: i.price,
      qty: i.qty
    })),
    totals: { qty, subtotal }
  };

  const ordersRef = Firestore.collection(db, "restaurants", state.restaurant.id, "orders");
  const newDoc = await Firestore.addDoc(ordersRef, orderData);

  // cria/garante chat do pedido
  try {
    const chatRef = Firestore.doc(db, "restaurants", state.restaurant.id, "chats", newDoc.id);
    await Firestore.setDoc(
      chatRef,
      {
        customerUid: state.customerUid || null,
        createdAt: Firestore.serverTimestamp(),
        status: "open",
        updatedAt: Firestore.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("Não foi possível criar chat (rules):", e?.code || e, e?.message || "");
  }

  state.currentOrderNumber = orderData.orderNumber;

  try { saveLastOrder(newDoc.id, orderData.orderNumber); } catch (_) {}

  // tracking público
  try {
    const publicRef = Firestore.doc(db, "restaurants", state.restaurant.id, "orders_public", newDoc.id);
    await Firestore.setDoc(
      publicRef,
      {
        status: orderData.status,
        createdAt: orderData.createdAt,
        updatedAt: orderData.updatedAt,
        orderNumber: orderData.orderNumber,
        totals: orderData.totals,
        customerName: orderData.customer?.name || ""
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("Não foi possível gravar orders_public (rules):", e?.code || e, e?.message || "");
  }

  return newDoc.id;
}

/* =========================
   Tabs + Chat Drawer + Tracking
   ========================= */

function showTab(name){
  const menuView = document.getElementById("menuView");
  const ordersView = document.getElementById("ordersView");
  const pill = document.querySelector(".bottomnav__pill");

  const tabMenu = document.getElementById("tabMenu");
  const tabOrders = document.getElementById("tabOrders");

  const isMenu = name === "menu";
  menuView?.classList?.toggle("hidden", !isMenu);
  ordersView?.classList?.toggle("hidden", isMenu);

  tabMenu?.classList?.toggle("is-active", isMenu);
  tabOrders?.classList?.toggle("is-active", !isMenu);

  if (pill){
    pill.setAttribute("data-active", isMenu ? "menu" : "orders");
  }
}

function setOrdersUI(hasOrder){
  document.getElementById("ordersEmpty")?.classList?.toggle("hidden", !!hasOrder);
  document.getElementById("orderCard")?.classList?.toggle("hidden", !hasOrder);

  const dot = document.getElementById("ordersDot");
  if (dot) dot.classList.toggle("hidden", !hasOrder);
}

function openChatDrawer(){
  const root = document.getElementById("chatDrawer");
  if (!root) return;
  root.classList.remove("hidden");
  root.offsetHeight;
  root.classList.add("is-open");
}

function closeChatDrawer(){
  const root = document.getElementById("chatDrawer");
  if (!root) return;
  root.classList.remove("is-open");
  window.setTimeout(() => root.classList.add("hidden"), 220);
}

function setupChatSwipe(){
  const panel = document.getElementById("chatPanel");
  const root = document.getElementById("chatDrawer");
  if (!panel || !root) return;

  let startX = 0;
  let current = 0;
  let dragging = false;

  const onStart = (e) => {
    if (!root.classList.contains("is-open")) return;

    // ✅ NÃO iniciar swipe se tocou em botão/input (isso quebrava o "Fechar")
    try {
      const t = e.target;
      if (t && t.closest && t.closest("button,input,textarea,label,select,a")) return;
    } catch(_) {}

    dragging = true;
    panel.classList.add("dragging");
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    current = 0;
  };

  const onMove = (e) => {
    if (!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const delta = Math.max(0, x - startX);
    current = delta;
    panel.style.transform = `translateX(${delta}px)`;
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");

    const threshold = Math.min(120, panel.clientWidth * 0.25);
    if (current > threshold){
      panel.style.transform = "";
      closeChatDrawer();
      return;
    }
    panel.style.transform = "";
  };

  panel.addEventListener("touchstart", onStart, { passive:true });
  panel.addEventListener("touchmove", onMove, { passive:true });
  panel.addEventListener("touchend", onEnd);

  panel.addEventListener("mousedown", onStart);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onEnd);
}

function openTrackScreen(orderId) {
  showTab("orders");
  setOrdersUI(true);

  document.getElementById("trackOrderId").textContent =
    (state.currentOrderNumber ? ("#" + state.currentOrderNumber) : ("#" + (orderId || "-")));

  const lbl = document.getElementById("chatOrderLabel");
  if (lbl) lbl.textContent =
    (state.currentOrderNumber ? ("#" + state.currentOrderNumber) : ("#" + (orderId || "-")));
}

function startTrackingOrder(orderId) {
  if (state.unsubTrack) {
    state.unsubTrack();
    state.unsubTrack = null;
  }

  const orderRef = Firestore.doc(db, "restaurants", state.restaurant.id, "orders_public", orderId);

  state.unsubTrack = Firestore.onSnapshot(
    orderRef,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      if (data.orderNumber) {
        state.currentOrderNumber = data.orderNumber;
        document.getElementById("trackOrderId").textContent = "#" + data.orderNumber;
      }

      document.getElementById("trackStatus").textContent = data.status || "-";

      const updated = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
      document.getElementById("trackUpdated").textContent =
        updated ? `Atualizado: ${updated.toLocaleString("pt-BR")}` : "";
    },
    (err) => {
      console.error("Erro no tracking (snapshot):", err?.code || err, err?.message || "");
      if (err?.code === "permission-denied") {
        document.getElementById("trackStatus").textContent = "Sem permissão para acompanhar";
        document.getElementById("trackUpdated").textContent =
          "Ajuste as regras do Firestore para permitir leitura em orders_public.";
      }
    }
  );
}

/* =========================
   Chat (tempo real) - por pedido
   ========================= */

function ensureChatUIVisible() {
  const box = document.getElementById("chatBox");
  if (box) box.style.display = "block";
}

function clearChatUI() {
  const box = document.getElementById("chatMessages");
  if (box) box.innerHTML = "";
  const input = document.getElementById("chatText");
  if (input) input.value = "";
}

function stopChat() {
  if (state.unsubChat) {
    state.unsubChat();
    state.unsubChat = null;
  }
}

function startChat(orderId) {
  stopChat();
  ensureChatUIVisible();
  clearChatUI();

  const msgsRef = Firestore.collection(
    db,
    "restaurants",
    state.restaurant.id,
    "chats",
    orderId,
    "messages"
  );
  const q = Firestore.query(msgsRef, Firestore.orderBy("createdAt", "asc"));

  state.unsubChat = Firestore.onSnapshot(
    q,
    (snap) => {
      const box = document.getElementById("chatMessages");
      if (!box) return;
      box.innerHTML = "";
      snap.forEach((doc) => {
        const m = doc.data() || {};
        const div = document.createElement("div");
        div.className = "msg " + ((m.from === "customer") ? "me" : "them");
        const safe = String(m.text || "").replace(/[<>&]/g, s => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[s]));
        const t = (m.createdAt && m.createdAt.toDate)
          ? m.createdAt.toDate().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})
          : "";
        div.innerHTML = `<div>${safe}</div>${t ? `<div class="msgMeta">${t}</div>` : ""}`;
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    },
    (err) => {
      console.error("Erro no chat (snapshot):", err?.code || err, err?.message || "");
    }
  );
}

async function sendChatMessage(text) {
  await ensureAnonAuth();
  if (!text || !state.currentOrderId) return;

  const ref = Firestore.collection(
    db,
    "restaurants",
    state.restaurant.id,
    "chats",
    state.currentOrderId,
    "messages"
  );

  try {
    await Firestore.addDoc(ref, {
      from: "customer",
      text: String(text),
      createdAt: Firestore.serverTimestamp()
    });

    try {
      const chatRef = Firestore.doc(db, "restaurants", state.restaurant.id, "chats", state.currentOrderId);
      await Firestore.setDoc(chatRef, { updatedAt: Firestore.serverTimestamp() }, { merge: true });
    } catch (_) {}
  } catch (e) {
    console.error("Erro ao enviar mensagem:", e?.code || e, e?.message || "");
    alert("Não foi possível enviar a mensagem (verifique as regras do Firestore).");
  }
}

/* =========================
   Boot
   ========================= */

async function boot() {
  // Fecha chat com ESC (desktop)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { try { closeChatDrawer(); } catch(_) {} }
  });

  // ✅ Tabs (navbar pílula)
  const tabMenu = document.getElementById("tabMenu");
  const tabOrders = document.getElementById("tabOrders");
  if (tabMenu) tabMenu.addEventListener("click", () => showTab("menu"));
  if (tabOrders) tabOrders.addEventListener("click", () => {
    if (!state.currentOrderId) return showTab("menu");
    showTab("orders");
  });

  const goMenuBtn = document.getElementById("goMenuBtn");
  if (goMenuBtn) goMenuBtn.addEventListener("click", () => showTab("menu"));

  // ✅ Chat: fechar / backdrop / swipe / abrir
  const closeChatBtn = document.getElementById("closeChatBtn");
  const chatBackdrop = document.getElementById("chatBackdrop");
  // iOS/Safari às vezes não dispara click em overlays como esperado; use touchend também
  if (closeChatBtn) {
    closeChatBtn.addEventListener("click", closeChatDrawer);
    closeChatBtn.addEventListener("touchend", (e) => { e.preventDefault(); closeChatDrawer(); }, { passive:false });
  }
  if (chatBackdrop) {
    chatBackdrop.addEventListener("click", closeChatDrawer);
    chatBackdrop.addEventListener("touchend", (e) => { e.preventDefault(); closeChatDrawer(); }, { passive:false });
  }
  try { setupChatSwipe(); } catch(_) {}

  const openChatBtn = document.getElementById("openChatBtn");
  if (openChatBtn) openChatBtn.addEventListener("click", () => {
    if (!state.currentOrderId) return;
    const lbl = document.getElementById("chatOrderLabel");
    if (lbl) lbl.textContent =
      (state.currentOrderNumber ? ("#" + state.currentOrderNumber) : ("#" + state.currentOrderId));
    try { startChat(state.currentOrderId); } catch(_){}
    openChatDrawer();
  });

  // Chat (enviar)
  const sendBtn = document.getElementById("sendChatBtn");
  const chatText = document.getElementById("chatText");
  if (sendBtn && chatText) {
    sendBtn.addEventListener("click", async () => {
      const text = (chatText.value || "").trim();
      if (!text) return;
      await sendChatMessage(text);
      chatText.value = "";
    });
    chatText.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const text = (chatText.value || "").trim();
        if (!text) return;
        await sendChatMessage(text);
        chatText.value = "";
      }
    });
  }

  // Esquecer último pedido
  const forgetBtn = document.getElementById("forgetOrderBtn");
  if (forgetBtn) {
    forgetBtn.addEventListener("click", () => {
      forgetLastOrder();
      state.currentOrderId = null;
      state.currentOrderNumber = null;
      stopChat();
      if (state.unsubTrack) { state.unsubTrack(); state.unsubTrack = null; }
      setOrdersUI(false);
      showTab("menu");
      try { closeChatDrawer(); } catch(_) {}
      alert("Pedido removido deste aparelho.");
    });
  }

  // Carrinho
  document.getElementById("openCartBtn")?.addEventListener("click", openCartDrawer);
  document.getElementById("cartBarBtn")?.addEventListener("click", openCartDrawer);
  document.getElementById("closeDrawerBtn")?.addEventListener("click", closeCartDrawer);
  document.getElementById("closeDrawerBackdrop")?.addEventListener("click", closeCartDrawer);

  // Checkout abre
  document.getElementById("checkoutBtn")?.addEventListener("click", () => {
    if (state.cart.length === 0) return alert("Carrinho vazio.");
    closeCartDrawer();
    openCheckout();
  });

  // Checkout fecha
  document.getElementById("closeCheckoutBtn")?.addEventListener("click", closeCheckout);
  document.getElementById("closeCheckoutBackdrop")?.addEventListener("click", closeCheckout);

  // Confirmar pedido
  document.getElementById("confirmOrderBtn")?.addEventListener("click", async () => {
    try {
      const orderId = await createOrder();

      state.cart = [];
      renderCartUI();

      closeCheckout();
      clearCheckoutInputs();

      state.currentOrderId = orderId;
      setOrdersUI(true);
      openTrackScreen(orderId);
      startTrackingOrder(orderId);

    } catch (err) {
      console.error(err);
      alert("Erro ao criar pedido. Veja o console (F12).");
    }
  });

  // Carregar dados do restaurante
  state.slug = getSlug();
  if (!state.slug) {
    document.getElementById("title").textContent = "URL inválida. Use /r/slug ou ?r=slug";
    return;
  }

  state.restaurant = await fetchRestaurantBySlug(state.slug);
  if (!state.restaurant) {
    document.getElementById("title").textContent = "Restaurante não encontrado";
    return;
  }

  state.products = await fetchProducts(state.restaurant.id);

  // Retomar último pedido
  const last = loadLastOrder();
  if (last?.orderId) {
    state.currentOrderId = last.orderId;
    if (last.orderNumber) state.currentOrderNumber = last.orderNumber;
    setOrdersUI(true);
    openTrackScreen(last.orderId);
    startTrackingOrder(last.orderId);
  } else {
    setOrdersUI(false);
  }

  renderProducts();
  renderCartUI();
  showTab("menu");
}

boot();

/* =========================
   PWA: Service Worker
   ========================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      console.log("SW registrado ✅");
    } catch (e) {
      console.warn("SW falhou:", e);
    }
  });
}
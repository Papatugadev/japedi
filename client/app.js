// ✅ Import por namespace (mais robusto que named imports)
import * as FirebaseApp from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import * as Firestore from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

/**
 * STATE = tudo que muda no app.
 * - restaurant/products vem do Firestore
 * - cart é local (por enquanto)
 */
const state = {
  slug: null,
  restaurant: null,
  products: [],
  cart: [], // [{id,name,price,qty}]
  currentOrderId: null,
  unsubTrack: null
};

/** Util: formatar BRL */
function moneyBRL(value) {
  const v = Number(value || 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

/**
 * Adiciona um produto no carrinho.
 * Guarda só {id,name,price,qty} = mínimo necessário pro pedido.
 */
function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;

  const existing = state.cart.find(i => i.id === productId);

  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      id: p.id,
      name: p.name || "Produto",
      price: Number(p.price || 0),
      qty: 1
    });
  }

  renderCartUI();
}

/** Aumenta/diminui quantidade */
function changeQty(productId, delta) {
  const item = state.cart.find(i => i.id === productId);
  if (!item) return;

  item.qty += delta;

  // Se ficou 0, remove
  if (item.qty <= 0) {
    state.cart = state.cart.filter(i => i.id !== productId);
  }

  renderCartUI();
}

/** Calcula totais */
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

/**
 * Renderiza tudo do carrinho: badge, barra inferior, drawer.
 */
function renderCartUI() {
  const badge = document.getElementById("cartBadge");
  const cartBar = document.getElementById("cartBar");
  const cartBarQty = document.getElementById("cartBarQty");
  const cartBarTotal = document.getElementById("cartBarTotal");
  const cartItems = document.getElementById("cartItems");
  const cartSubtotal = document.getElementById("cartSubtotal");

  const { qty, subtotal } = cartTotals();

  // Badge no topo
  if (qty > 0) {
    badge.classList.remove("hidden");
    badge.textContent = String(qty);
  } else {
    badge.classList.add("hidden");
    badge.textContent = "0";
  }

  // Barra fixa
  if (qty > 0) {
    cartBar.classList.remove("hidden");
    cartBarQty.textContent = qty === 1 ? "1 item" : `${qty} itens`;
    cartBarTotal.textContent = moneyBRL(subtotal);
  } else {
    cartBar.classList.add("hidden");
  }

  // Drawer itens
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

    customer: { name, phone, address },

    items: state.cart.map(i => ({
      id: i.id,
      name: i.name,
      price: i.price,
      qty: i.qty
    })),

    totals: {
      qty,
      subtotal
    }
  };

  const ordersRef = Firestore.collection(db, "restaurants", state.restaurant.id, "orders");
  const newDoc = await Firestore.addDoc(ordersRef, orderData);

  // ✅ Tracking público (evita permission-denied no cliente quando rules bloqueiam /orders)
  // Tenta criar/atualizar um doc espelho em /orders_public com dados mínimos.
  try {
    const publicRef = Firestore.doc(db, "restaurants", state.restaurant.id, "orders_public", newDoc.id);
    await Firestore.setDoc(
      publicRef,
      {
        status: orderData.status,
        createdAt: orderData.createdAt,
        updatedAt: orderData.updatedAt,
        totals: orderData.totals,
        customerName: orderData.customer?.name || ""
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("Não foi possível gravar orders_public (rules):", e?.code || e, e?.message || "");
  }

  return newDoc.id;}

/* =========================
   Tracking (tempo real)
   ========================= */

function openTrackScreen(orderId) {
  document.getElementById("trackScreen").classList.remove("hidden");
  document.getElementById("trackOrderId").textContent = orderId;
}

function closeTrackScreen() {
  document.getElementById("trackScreen").classList.add("hidden");
}

function startTrackingOrder(orderId) {
  // se já tinha listener, desliga
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
   Boot
   ========================= */

async function boot() {
  // Eventos carrinho
  document.getElementById("openCartBtn").addEventListener("click", openCartDrawer);
  document.getElementById("cartBarBtn").addEventListener("click", openCartDrawer);
  document.getElementById("closeDrawerBtn").addEventListener("click", closeCartDrawer);
  document.getElementById("closeDrawerBackdrop").addEventListener("click", closeCartDrawer);

  // Checkout abre
  document.getElementById("checkoutBtn").addEventListener("click", () => {
    if (state.cart.length === 0) return alert("Carrinho vazio.");
    closeCartDrawer();
    openCheckout();
  });

  // Checkout fecha
  document.getElementById("closeCheckoutBtn").addEventListener("click", closeCheckout);
  document.getElementById("closeCheckoutBackdrop").addEventListener("click", closeCheckout);

  // Confirmar pedido
  document.getElementById("confirmOrderBtn").addEventListener("click", async () => {
    try {
      const orderId = await createOrder();

      // limpa carrinho
      state.cart = [];
      renderCartUI();

      closeCheckout();
      clearCheckoutInputs();

      // abre tracking
      state.currentOrderId = orderId;
      openTrackScreen(orderId);
      startTrackingOrder(orderId);

    } catch (err) {
      console.error(err);
      alert("Erro ao criar pedido. Veja o console (F12).");
    }
  });

  // Voltar ao cardápio
  document.getElementById("backToMenuBtn").addEventListener("click", () => {
    closeTrackScreen();
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

  // Render inicial
  renderProducts();
  renderCartUI();
}

boot();
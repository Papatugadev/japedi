import * as FirebaseApp from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import * as Auth from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import * as Firestore from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** ✅ Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyAQsb1pCGm6BNkGuKBDsBzXdnyHAyH1JXc",
  authDomain: "japed-e09f2.firebaseapp.com",
  projectId: "japed-e09f2",
  storageBucket: "japed-e09f2.firebasestorage.app",
  messagingSenderId: "715293947768",
  appId: "1:715293947768:web:66c67dc1c33953c0ec3a8d"
};

const app = FirebaseApp.initializeApp(firebaseConfig);
const auth = Auth.getAuth(app);
const db = Firestore.getFirestore(app);

/**
 * ✅ MVP: fixo por enquanto
 * Depois vamos buscar do users/{uid}.restaurantId (multi-tenant real).
 */
const RESTAURANT_ID = "r_001";

/** UI refs */
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorEl = document.getElementById("loginError");

const panelEl = document.getElementById("panel");
const loginScreenEl = document.getElementById("loginScreen");

const ordersWrap = document.getElementById("orders");
const restNameEl = document.getElementById("restName");

let unsubOrders = null;

/** Helpers */
function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function minsSince(ts) {
  if (!ts?.toDate) return null;
  const ms = Date.now() - ts.toDate().getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function statusLabel(s) {
  const map = {
    recebido: "Recebido",
    em_preparo: "Em preparo",
    saiu_pra_entrega: "Saiu pra entrega",
    entregue: "Entregue",
    cancelado: "Cancelado"
  };
  return map[s] || s || "-";
}

function statusColor(s) {
  if (s === "recebido") return "#16a34a";
  if (s === "em_preparo") return "#f59e0b";
  if (s === "saiu_pra_entrega") return "#3b82f6";
  if (s === "entregue") return "#10b981";
  if (s === "cancelado") return "#ef4444";
  return "#16a34a";
}

/** Auth: login */
loginBtn.onclick = async () => {
  errorEl.textContent = "";
  try {
    await Auth.signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
  } catch (e) {
    errorEl.textContent = "Email ou senha inválidos";
  }
};

document.getElementById("logoutBtn").onclick = async () => {
  if (unsubOrders) unsubOrders();
  await Auth.signOut(auth);
  location.reload();
};

/** Carrega nome do restaurante */
async function loadRestaurantHeader() {
  const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID);
  const snap = await Firestore.getDoc(ref);
  restNameEl.textContent = snap.exists() ? (snap.data().name || "Restaurante") : "Restaurante";
}

/** Atualiza status do pedido */
async function setOrderStatus(orderId, newStatus) {
  const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId);
  await Firestore.updateDoc(ref, {
    status: newStatus,
    updatedAt: Firestore.serverTimestamp()
  });
}

/** Renderiza pedidos */
function renderOrders(list) {
  ordersWrap.innerHTML = "";

  if (list.length === 0) {
    ordersWrap.innerHTML = `<p style="color:#666">Nenhum pedido ainda.</p>`;
    return;
  }

  for (const o of list) {
    const mins = minsSince(o.createdAt);
    const border = statusColor(o.status);

    const itemsHtml = (o.items || [])
      .map(i => `• ${i.qty}x ${i.name} (${brl(i.price)})`)
      .join("<br/>");

    const div = document.createElement("div");
    div.className = "order";
    div.style.borderLeftColor = border;

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <strong>Pedido ${o.id}</strong>
          <div style="margin-top:4px;color:#555"><strong>Status:</strong> ${statusLabel(o.status)}</div>
          <div style="margin-top:4px;color:#555"><strong>Cliente:</strong> ${o.customer?.name || "-"}</div>
          <div style="margin-top:4px;color:#555"><strong>Whats:</strong> ${o.customer?.phone || "-"}</div>
          <div style="margin-top:4px;color:#555"><strong>Endereço:</strong> ${o.customer?.address || "-"}</div>
          <div style="margin-top:6px;color:#555">${mins !== null ? `há ${mins} min` : ""}</div>
        </div>

        <div style="text-align:right">
          <div><strong>${brl(o.totals?.subtotal)}</strong></div>
          <div style="color:#666">${o.totals?.qty || 0} itens</div>
        </div>
      </div>

      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee;color:#333">
        ${itemsHtml || "<span style='color:#666'>Sem itens</span>"}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn small" data-act="em_preparo" data-id="${o.id}">Em preparo</button>
        <button class="btn small" data-act="saiu_pra_entrega" data-id="${o.id}">Saiu</button>
        <button class="btn small" data-act="entregue" data-id="${o.id}">Entregue</button>
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      </div>
    `;

    ordersWrap.appendChild(div);
  }

  // ligar eventos dos botões
  ordersWrap.querySelectorAll("[data-act][data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");

      try {
        await setOrderStatus(orderId, act);
      } catch (e) {
        console.error(e);
        alert("Erro ao mudar status. Veja o console (F12).");
      }
    });
  });
}

/** Listener realtime */
function startOrdersListener() {
  const ref = Firestore.collection(db, "restaurants", RESTAURANT_ID, "orders");

  const q = Firestore.query(ref, Firestore.orderBy("createdAt", "desc"));

  unsubOrders = Firestore.onSnapshot(q, (snap) => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(list);
  });
}

/** Auth state */
Auth.onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  loginScreenEl.classList.add("hidden");
  panelEl.classList.remove("hidden");

  await loadRestaurantHeader();
  startOrdersListener();
});
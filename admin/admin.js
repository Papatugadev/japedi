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
let RESTAURANT_ID = null;
// ====== DIAGNÓSTICO DE PERMISSÃO (ADMIN) ======
let ADMIN_UID = "";
let ADMIN_OK = false;


async function loadRestaurantIdFromUser() {
  const u = auth.currentUser;
  if (!u?.uid) return null;

  // users/{uid} -> { restaurantId, role }
  const uref = Firestore.doc(db, "users", u.uid);
  const usnap = await Firestore.getDoc(uref);
  if (!usnap.exists()) return null;

  const data = usnap.data() || {};
  return data.restaurantId || null;
}

async function checkAdminAccess() {
  try {
    const u = auth.currentUser;
    ADMIN_UID = u?.uid || "";
    if (!ADMIN_UID) {
      ADMIN_OK = false;
      return;
    }
    if (!RESTAURANT_ID) {
      // tenta descobrir automaticamente
      try { RESTAURANT_ID = await loadRestaurantIdFromUser(); } catch (_) {}
    }
    if (!RESTAURANT_ID) {
      ADMIN_OK = false;
      const el0 = document.getElementById("permDiag");
      if (el0) {
        el0.innerHTML = `<div style="padding:10px;border:1px solid #fee2e2;background:#fff1f2;border-radius:12px">
          <strong style="color:#991b1b">Sem restaurantId</strong>
          <div style="margin-top:4px;color:#7f1d1d;font-size:12px">
            Crie/ajuste <code>users/${ADMIN_UID}</code> com o campo <code>restaurantId</code>.
          </div>
        </div>`;
      }
      return;
    }

    // ✅ Seu modelo de permissão usa /users/{uid} { restaurantId, role }
    const uref = Firestore.doc(db, "users", ADMIN_UID);
    const usnap = await Firestore.getDoc(uref);
    const udata = usnap.exists() ? usnap.data() : null;

    ADMIN_OK =
      !!udata &&
      udata.restaurantId === RESTAURANT_ID &&
      (udata.role === "owner" || udata.role === "admin");

    const el = document.getElementById("permDiag");
    if (el) {
      el.innerHTML = ADMIN_OK
        ? `<div style="padding:10px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:12px">
            <strong style="color:#166534">Admin OK</strong>
            <div style="margin-top:4px;color:#14532d;font-size:12px">RID: <code>${RESTAURANT_ID}</code> · UID: <code>${ADMIN_UID}</code></div>
          </div>`
        : `<div style="padding:10px;border:1px solid #fee2e2;background:#fff1f2;border-radius:12px">
            <strong style="color:#991b1b">Sem permissão de admin</strong>
            <div style="margin-top:4px;color:#7f1d1d;font-size:12px">
              Verifique se existe <code>users/${ADMIN_UID}</code> com <code>restaurantId="${RESTAURANT_ID}"</code> e <code>role="owner"</code>.
            </div>
          </div>`;
    }
  } catch (e) {
    ADMIN_OK = false;
    console.warn("Falha ao checar admin:", e?.code || e, e?.message || "");
  }
}

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
  if (!RESTAURANT_ID) {
    restNameEl.textContent = "Restaurante";
    return;
  }
  try {
    const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID);
    const snap = await Firestore.getDoc(ref);
    restNameEl.textContent = snap.exists() ? (snap.data().name || "Restaurante") : "Restaurante";
  } catch (e) {
    console.warn("Sem permissão para ler /restaurants:", e?.code || e, e?.message || "");
    restNameEl.textContent = "Restaurante";
  }
}

/** Atualiza status do pedido */
async function setOrderStatus(orderId, newStatus) {
  if (!ADMIN_OK) {
    console.warn("Usuário não é admin deste restaurante (RID/UID).");
    await checkAdminAccess();
    if (!ADMIN_OK) {
      alert("Sem permissão de admin. Confira o RID/UID no topo.");
      return;
    }
  }

  // ✅ Admin atualiza SEMPRE o tracking público (cliente acompanha)
  const privateRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId);
  const publicRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_public", orderId);

  const payload = {
    status: newStatus,
    updatedAt: Firestore.serverTimestamp()
  };

  // 1) Atualiza o público (se o doc existir)
  let publicOk = false;
  try {
    await Firestore.updateDoc(publicRef, payload);
    publicOk = true;
  } catch (e) {
    // Se não existir ainda, cria
    if (e?.code === "not-found") {
      try {
        await Firestore.setDoc(
          publicRef,
          {
            ...payload,
            createdAt: Firestore.serverTimestamp()
          },
          { merge: true }
        );
        publicOk = true;
      } catch (e2) {
        console.warn("Falha ao criar orders_public:", e2?.code || e2, e2?.message || "");
      }
    } else {
      console.warn("Sem permissão para atualizar orders_public:", e?.code || e, e?.message || "");
    }
  }

  // 2) Atualiza o privado (admin/relatórios)
  try {
    await Firestore.updateDoc(privateRef, payload);
  } catch (e) {
    console.warn("Sem permissão para atualizar orders:", e?.code || e, e?.message || "");
  }

  // 3) Feedback/consistência: se não atualizou o público, avisa
  if (!publicOk) {
    console.warn("ATENÇÃO: status não foi gravado em orders_public; o cliente não vai ver a mudança.");
  }
}

/** Renderiza pedidos */
function renderOrders(list) {
  // Limpa
  ordersWrap.innerHTML = "";

  // Diag sempre no topo (não pode sumir ao limpar)
  const diag = document.createElement("div");
  diag.id = "permDiag";
  diag.style.margin = "10px 0";
  ordersWrap.appendChild(diag);

  // Preenche o diag com o estado atual
  checkAdminAccess();

  if (!list || list.length === 0) {
    const p = document.createElement("p");
    p.style.color = "#666";
    p.textContent = "Nenhum pedido ainda.";
    ordersWrap.appendChild(p);
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
          <div style="margin-top:4px;color:#555"><strong>Cliente:</strong> ${o.customer?.name || o.customerName || "-"}</div>
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
  if (!RESTAURANT_ID) {
    console.warn("RESTAURANT_ID vazio; não iniciou listener.");
    return;
  }
  const ref = Firestore.collection(db, "restaurants", RESTAURANT_ID, "orders_public");
  const q = Firestore.query(ref, Firestore.orderBy("createdAt", "desc"));

  unsubOrders = Firestore.onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderOrders(list);
    },
    (err) => {
      console.error("Erro no listener de pedidos (snapshot):", err?.code || err, err?.message || "");
      if (err?.code === "permission-denied") {
        ordersWrap.innerHTML = `
          <div style="padding:12px;border:1px solid #eee;border-radius:12px;background:#fff">
            <strong style="color:#ef4444">Sem permissão para ler pedidos.</strong>
            <div style="margin-top:6px;color:#555">
              Ajuste as regras do Firestore para permitir leitura em
              <code>restaurants/${RESTAURANT_ID}/orders_public</code>.
            </div>
          </div>
        `;
      }
    }
  );
}

/** Auth state */
Auth.onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  loginScreenEl.classList.add("hidden");
  panelEl.classList.remove("hidden");

  // 🔥 Multi-tenant: descobre o restaurante pelo users/{uid}.restaurantId
  try {
    RESTAURANT_ID = await loadRestaurantIdFromUser();
  } catch (e) {
    console.warn("Falha ao carregar restaurantId do usuário:", e?.code || e, e?.message || "");
  }

  await checkAdminAccess();
  await loadRestaurantHeader();
  if (unsubOrders) unsubOrders();
  startOrdersListener();
});
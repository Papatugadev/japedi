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

/** ✅ Cloudinary (upload grátis)
 *  1) Crie conta no Cloudinary
 *  2) Settings > Upload > Upload presets > Add upload preset (Unsigned)
 *  3) Preencha abaixo:
 */
const CLOUDINARY_CLOUD_NAME = "dbrxftz4q";
const CLOUDINARY_UPLOAD_PRESET = "qikjmjnv";
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




/** ===== Upload de imagem do produto (Firebase Storage) ===== */
async function uploadProductImage(file) {
  if (!file) return null;
  if (!RESTAURANT_ID) throw new Error("RESTAURANT_ID vazio");

  const isImage = (file.type || "").startsWith("image/");
  if (!isImage) throw new Error("Arquivo não é imagem");

  const maxMB = 4;
  const maxBytes = maxMB * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`Imagem muito grande. Máx: ${maxMB}MB`);

  if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME === "SEU_CLOUD_NAME") {
    throw new Error("Configure CLOUDINARY_CLOUD_NAME no admin.js");
  }
  if (!CLOUDINARY_UPLOAD_PRESET || CLOUDINARY_UPLOAD_PRESET === "SEU_UPLOAD_PRESET") {
    throw new Error("Configure CLOUDINARY_UPLOAD_PRESET (unsigned) no admin.js");
  }

  // pasta organizada por restaurante
  const folder = `restaurants/${RESTAURANT_ID}/products`;

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", folder);

  // (opcional) ajuda a cachear/identificar
  form.append("context", `alt=${encodeURIComponent(file.name || "produto")}`);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const res = await fetch(endpoint, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || `Falha no upload (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return data.secure_url || data.url || null;
}

/** ===== Tempo ao vivo (badge) ===== */
let __JPED_TIME_TICK = null;

function _tsToMs(ts){
  try { return ts?.toDate ? ts.toDate().getTime() : (typeof ts === "number" ? ts : null); } catch(_) { return null; }
}

function _formatAge(ms){
  const sec = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(sec/60);
  const s = sec % 60;
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}min`;
  const h = Math.floor(m/60);
  const mm = m % 60;
  return `${h}h ${mm}min`;
}

function _startTimeBadges(){
  if (__JPED_TIME_TICK) return;
  __JPED_TIME_TICK = setInterval(() => {
    const now = Date.now();
    document.querySelectorAll(".timePill[data-created-ms]").forEach((el) => {
      const createdMs = Number(el.getAttribute("data-created-ms") || 0);
      if (!createdMs) return;
      const ageMs = now - createdMs;
      const late = ageMs >= 20 * 60 * 1000;
      const label = el.querySelector("[data-age]");
      if (label) label.textContent = _formatAge(ageMs);
      el.classList.toggle("late", late);

      // animação a cada minuto
      const lastMin = Number(el.getAttribute("data-last-min") || -1);
      const curMin = Math.floor(ageMs / 60000);
      if (curMin !== lastMin) {
        el.setAttribute("data-last-min", String(curMin));
        el.classList.remove("pulse");
        void el.offsetWidth;
        el.classList.add("pulse");
      }
    });
  }, 1000);
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
  try { _stopProductsListener(); } catch (_) {}
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

/** ===== Assinatura / Trial (Básico/Gold/Diamante) =====
 * Regras:
 * - plan.status: "trial" | "active" | "expired"
 * - trialEndsAt: timestamp
 * Se expirado e não active -> trava o painel
 */
let SUBSCRIPTION_OK = true;
let SUBSCRIPTION_INFO = null;

function tsToMillis(ts) {
  try { return ts?.toDate ? ts.toDate().getTime() : (typeof ts === "number" ? ts : null); } catch (_) { return null; }
}

function ensureSubGateEl() {
  let el = document.getElementById("subGate");
  if (!el) {
    el = document.createElement("div");
    el.id = "subGate";
    el.style.margin = "10px 0";
    // Coloca acima dos pedidos
    const host = document.getElementById("panel") || document.body;
    host.prepend(el);
  }
  return el;
}

async function checkSubscriptionGate() {
  SUBSCRIPTION_OK = true;
  SUBSCRIPTION_INFO = null;

  if (!RESTAURANT_ID) return;

  try {
    const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID);
    const snap = await Firestore.getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const plan = data.plan || {};
    const status = plan.status || "active";
    const tier = plan.tier || "basic";
    const trialEndsAtMs = tsToMillis(plan.trialEndsAt);

    let expired = false;
    if (status === "trial" && trialEndsAtMs) {
      expired = Date.now() > trialEndsAtMs;
    } else if (status === "expired") {
      expired = true;
    }

    SUBSCRIPTION_INFO = { status, tier, trialEndsAtMs, expired, priceBRL: plan.priceBRL || null };

    // Se expirou e não é active -> bloqueia
    if (expired && status !== "active") {
      SUBSCRIPTION_OK = false;
    }

    const el = ensureSubGateEl();
    if (SUBSCRIPTION_OK) {
      el.innerHTML = "";
      el.style.display = "none";
      return;
    }

    el.style.display = "block";
    const ends = trialEndsAtMs ? new Date(trialEndsAtMs).toLocaleDateString("pt-BR") : "-";
    el.innerHTML = `
      <div style="padding:12px;border:1px solid #fee2e2;background:#fff1f2;border-radius:16px">
        <strong style="color:#991b1b">Assinatura expirada</strong>
        <div style="margin-top:6px;color:#7f1d1d">
          Seu trial terminou em <strong>${ends}</strong>. Para continuar usando o painel, ative um plano.
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="btnPlanBasic" class="btn small">Ativar Básico</button>
          <button id="btnPlanGold" class="btn small">Ativar Gold</button>
          <button id="btnPlanDiamond" class="btn small">Ativar Diamante</button>
        </div>
        <div style="margin-top:8px;color:#7f1d1d;font-size:12px">
          (MVP) Aqui você pode redirecionar para WhatsApp/checkout.
        </div>
      </div>
    `;

    // Botões (MVP): abre WhatsApp do suporte (troque o número)
    const support = "5511999999999";
    const msg = encodeURIComponent(`Olá! Meu restaurante (${RESTAURANT_ID}) expirou. Quero ativar um plano.`);
    const url = `https://wa.me/${support}?text=${msg}`;

    ["btnPlanBasic","btnPlanGold","btnPlanDiamond"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.onclick = () => window.open(url, "_blank");
    });

  } catch (e) {
    console.warn("Falha ao checar assinatura:", e?.code || e, e?.message || "");
  }
}

function guardIfSubscriptionBlocked() {
  if (SUBSCRIPTION_OK) return false;

  // trava ações e lista
  if (ordersWrap) {
    ordersWrap.innerHTML = `
      <div style="padding:12px;border:1px solid #eee;border-radius:16px;background:#fff">
        <strong style="color:#991b1b">Painel bloqueado</strong>
        <div style="margin-top:6px;color:#555">Ative um plano para voltar a receber e gerenciar pedidos.</div>
      </div>
    `;
  }
  return true;
}



/** Atualiza status do pedido */
async function setOrderStatus(orderId, newStatus) {
  if (!SUBSCRIPTION_OK) {
    alert("Assinatura expirada. Ative um plano para mudar status.");
    return;
  }

  if (!ADMIN_OK) {
    console.warn("Usuário não é admin deste restaurante (RID/UID).");
    await checkAdminAccess();
    if (!ADMIN_OK) {
      alert("Sem permissão de admin. Confira o RID/UID no topo.");
      return;
    }
  }

  const privateRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId);
  const publicRef  = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_public", orderId);
  const historyRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_history", orderId);

  // ✅ Se for ENTREGUE: arquiva e remove dos ativos
  if (newStatus === "entregue") {
    // 1) tenta pegar dados do privado, se não der, do público
    let baseData = null;

    try {
      const ps = await Firestore.getDoc(privateRef);
      if (ps.exists()) baseData = ps.data();
    } catch (_) {}

    if (!baseData) {
      try {
        const qs = await Firestore.getDoc(publicRef);
        if (qs.exists()) baseData = qs.data();
      } catch (_) {}
    }

    // 2) salva no histórico (mesmo se baseData vier null, ainda salva meta)
    try {
      await Firestore.setDoc(
        historyRef,
        {
          ...(baseData || {}),
          id: orderId,
          status: "entregue",
          deliveredAt: Firestore.serverTimestamp(),
          archivedAt: Firestore.serverTimestamp(),
          updatedAt: Firestore.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("Erro ao arquivar em orders_history:", e?.code || e, e?.message || "");
      alert("Não consegui arquivar no histórico (orders_history). Veja o console (F12).");
      return; // não apaga se não arquivou
    }

    // 3) apaga dos ativos (some da tela)
    try { await Firestore.deleteDoc(publicRef); } catch (e) {
      console.warn("Erro ao deletar orders_public:", e?.code || e, e?.message || "");
    }
    try { await Firestore.deleteDoc(privateRef); } catch (e) {
      console.warn("Erro ao deletar orders:", e?.code || e, e?.message || "");
    }

    return;
  }

  // ✅ Caso normal: só atualiza status
  const payload = {
    status: newStatus,
    updatedAt: Firestore.serverTimestamp()
  };

  // (se você quiser manter sizes/addons como já tinha antes, pode deixar seu trecho aqui)
  try {
    payload.sizes = _readOptList(sizesBox);
    payload.addons = _readOptList(addonsBox);
  } catch (_) {
    payload.sizes = [];
    payload.addons = [];
  }

  // público (cliente acompanha)
  let publicOk = false;
  try {
    await Firestore.updateDoc(publicRef, payload);
    publicOk = true;
  } catch (e) {
    if (e?.code === "not-found") {
      try {
        await Firestore.setDoc(
          publicRef,
          { ...payload, createdAt: Firestore.serverTimestamp() },
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

  // privado (admin/relatórios)
  try {
    await Firestore.updateDoc(privateRef, payload);
  } catch (e) {
    console.warn("Sem permissão para atualizar orders:", e?.code || e, e?.message || "");
  }

  if (!publicOk) {
    console.warn("ATENÇÃO: status não foi gravado em orders_public; o cliente não vai ver a mudança.");
  }
}


/** ===== Ações dos botões (delegação) ===== */
(function _wireOrderButtons(){
  if (window.__JPED_WIRE_BTNS) return;
  window.__JPED_WIRE_BTNS = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act][data-id]");
    if (!btn) return;

    // não deixar o clique abrir o modal
    e.preventDefault();
    e.stopPropagation();

    const orderId = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");

    try {
      await setOrderStatus(orderId, act);
    } catch (err) {
      console.error(err);
      alert("Erro ao mudar status. Veja o console (F12).");
    }
  });
})();

/** Renderiza pedidos */
function renderOrders(list) {
  // containers das 3 colunas
  const prepEl = document.getElementById("orders-prep");
  const outEl = document.getElementById("orders-out");
  const doneEl = document.getElementById("orders-done");

  // fallback antigo (caso o HTML ainda esteja no formato antigo)
  const legacyWrap = document.getElementById("orders");

  const clear = (el) => { if (el) el.innerHTML = ""; };

  clear(prepEl); clear(outEl); clear(doneEl);
  if (legacyWrap && !prepEl && !outEl && !doneEl) legacyWrap.innerHTML = "";

  // Diag de permissão no topo (sem atrapalhar)
  const attachDiag = (host) => {
    if (!host) return;
    let diag = host.querySelector("#permDiag");
    if (!diag) {
      diag = document.createElement("div");
      diag.id = "permDiag";
      diag.style.margin = "10px 0";
      host.prepend(diag);
    }
  };

  // coloca o diag só na primeira coluna (ou no legacy)
  attachDiag(prepEl || legacyWrap);
  try { checkAdminAccess(); } catch (_) {}

  if (!list || list.length === 0) {
    const target = prepEl || legacyWrap;
    if (target) {
      const p = document.createElement("p");
      p.style.color = "#666";
      p.textContent = "Nenhum pedido ainda.";
      target.appendChild(p);
    }
    return;
  }

  // helper para escolher coluna
  function bucketStatus(s) {
    // pedido novo pode vir "recebido" (ou vazio) => em_preparo
    if (!s || s === "recebido" || s === "em_preparo") return "em_preparo";
    if (s === "saiu_pra_entrega") return "saiu_pra_entrega";
    if (s === "entregue") return "entregue";
    return "em_preparo";
  }

  function hostFor(status) {
    if (!prepEl && !outEl && !doneEl) return legacyWrap;
    if (status === "saiu_pra_entrega") return outEl;
    if (status === "entregue") return doneEl;
    return prepEl;
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

    const col = bucketStatus(o.status);

    // botões por coluna (pedido novo vai pra em_preparo)
    let actions = "";
    if (col === "em_preparo") {
      actions = `
        <button class="btn small" data-act="saiu_pra_entrega" data-id="${o.id}">Despachar</button>
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      `;
    } else if (col === "saiu_pra_entrega") {
      actions = `
        <button class="btn small" data-act="entregue" data-id="${o.id}">Entregue</button>
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      `;
    } else {
      // entregue
      actions = `
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      `;
    }

    
const createdMs = _tsToMs(o.createdAt) || Date.now();
const ageMs = Date.now() - createdMs;
const late = ageMs >= 20 * 60 * 1000;

div.dataset.id = o.id;

div.innerHTML = `
  <div class="cardTop">
    <div class="timePill ${late ? "late" : ""} pulse" data-created-ms="${createdMs}" data-last-min="-1">
      <span class="timePillDot"></span>
      <span data-age>${_formatAge(ageMs)}</span>
    </div>
  </div>

  <div class="cardBody">
    <div class="cardCustomer">${o.customer?.name || o.customerName || "Cliente"}</div>
    <div class="cardOrderNum">#${o.orderNumber || "----"}</div>
  </div>

  <div class="cardActions">
    ${actions}
  </div>
`;const host = hostFor(col);
    if (host) host.appendChild(div);
  }
}


/** ===== Modal de detalhes do pedido ===== */
let __JPED_OPEN_ORDER_ID = null;

function _ensureModal(){
  let modal = document.getElementById("orderModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "orderModal";
  modal.className = "orderModal hidden";
  modal.innerHTML = `
    <div class="orderModalContent" role="dialog" aria-modal="true">
      <button type="button" class="modalClose" id="orderModalClose" aria-label="Fechar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      <div class="modalHeader">
        <div class="modalOrderNum" id="modalOrderNum">#----</div>
        <div class="modalCustomer" id="modalCustomer">Cliente</div>
        <div class="modalMeta" id="modalMeta"></div>
      </div>

      <div class="modalSection">
        <div class="modalTitle">Itens</div>
        <div class="modalItems" id="modalItems"></div>
      </div>

      <div class="modalSection">
        <div class="modalTitle">Entrega</div>
        <div class="modalInfo" id="modalDelivery"></div>
      </div>

      <!-- Chat: botão flutuante + drawer lateral -->
      <button type="button" class="chatFab" id="chatFab" aria-label="Abrir chat">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
        <span class="chatFabBadge hidden" id="chatFabBadge">0</span>
      </button>

      <div class="chatDrawerBackdrop hidden" id="chatDrawerBackdrop" aria-hidden="true"></div>

      <aside class="chatDrawer hidden" id="chatDrawer" aria-label="Chat do pedido">
        <div class="chatDrawerHead">
          <div class="chatDrawerTitle">Chat</div>
          <button type="button" class="chatDrawerClose" id="chatDrawerClose" aria-label="Fechar chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div class="chatDrawerBody">
          <div class="modalChatMessages" id="modalChatMessages"></div>
        </div>

        <div class="chatDrawerFoot">
          <div class="modalChatInput">
            <input id="modalChatText" class="input" placeholder="Escreva para o cliente..." />
            <button type="button" class="btn small" id="modalChatSend">Enviar</button>
          </div>
          <div class="modalChatHint">O cliente vê em tempo real na tela de acompanhar pedido.</div>
        </div>
      </aside>


      <div class="modalFooter">
        <button type="button" class="btn small" id="modalDispatch">Despachar</button>
        <button type="button" class="btn small" id="modalDelivered">Entregue</button>
        <button type="button" class="ghost small danger" id="modalCancel">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => closeOrderModal();
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector("#orderModalClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });


  // ===== Chat drawer (lateral) =====
  const fab = modal.querySelector("#chatFab");
  const drawer = modal.querySelector("#chatDrawer");
  const back = modal.querySelector("#chatDrawerBackdrop");
  const btnCloseChat = modal.querySelector("#chatDrawerClose");

  const openChat = () => {
    if (!drawer || !back) return;
    drawer.classList.remove("hidden");
    back.classList.remove("hidden");
    const bd = modal.querySelector("#chatFabBadge");
    if (bd) { bd.textContent = "0"; bd.classList.add("hidden"); }

    // foca no input
    try{
      const input = modal.querySelector("#modalChatText");
      if (input) setTimeout(() => input.focus(), 0);
    }catch(_){}
  };
  const closeChat = () => {
    if (!drawer || !back) return;
    drawer.classList.add("hidden");
    back.classList.add("hidden");
  };

  // deixa disponível para fechar quando fechar o modal
  modal.__closeChat = closeChat;

  if (fab) fab.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openChat(); });
  if (btnCloseChat) btnCloseChat.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); closeChat(); });
  if (back) back.addEventListener("click", closeChat);

  return modal;
}

function closeOrderModal(){
  const modal = document.getElementById("orderModal");
  if (!modal) return;
  try { if (modal.__closeChat) modal.__closeChat(); } catch (_) {}
  modal.classList.add("hidden");
  __JPED_OPEN_ORDER_ID = null;
  // para o realtime do chat quando fecha
  try { stopAdminChat(); } catch (_) {}
}

/** ===== Chat do pedido (admin) ===== */
let __JPED_CHAT_UNSUB = null;

function stopAdminChat(){
  if (__JPED_CHAT_UNSUB) {
    try { __JPED_CHAT_UNSUB(); } catch(_) {}
    __JPED_CHAT_UNSUB = null;
  }
}

function startAdminChat(orderId){
  stopAdminChat();

  const box = document.getElementById("modalChatMessages");
  if (!box) return;

  // realtime
  const msgsRef = Firestore.collection(db, "restaurants", RESTAURANT_ID, "chats", orderId, "messages");
  const q = Firestore.query(msgsRef, Firestore.orderBy("createdAt","asc"));

  __JPED_CHAT_UNSUB = Firestore.onSnapshot(q, (snap) => {
    box.innerHTML = "";
    snap.forEach(d => {
      const m = d.data() || {};
      const div = document.createElement("div");
      div.className = "chatMsg " + (m.from === "restaurant" ? "me" : "them");
      div.textContent = m.text || "";
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;

    // ===== Unread badge (se drawer fechado) =====
    try{
      const modal = document.getElementById("orderModal");
      const drawer = modal ? modal.querySelector("#chatDrawer") : null;
      const badge = modal ? modal.querySelector("#chatFabBadge") : null;
      if (modal && badge && drawer) {
        const open = !drawer.classList.contains("hidden");
        const seen = Number(modal.__chatSeenCount || 0);
        const total = snap.size || 0;
        if (open) {
          modal.__chatSeenCount = total;
          badge.textContent = "0";
          badge.classList.add("hidden");
        } else {
          const unread = Math.max(0, total - seen);
          badge.textContent = String(unread);
          badge.classList.toggle("hidden", unread === 0);
        }
      }
    }catch(_){}

  }, (err) => {
    console.warn("Erro chat admin (snapshot):", err?.code || err, err?.message || "");
  });
}

async function sendAdminChat(orderId, text){
  if (!text) return;
  const ref = Firestore.collection(db, "restaurants", RESTAURANT_ID, "chats", orderId, "messages");
  await Firestore.addDoc(ref, {
    from: "restaurant",
    text,
    createdAt: Firestore.serverTimestamp(),
    uid: auth.currentUser?.uid || null
  });
  // atualiza chat doc (opcional)
  try{
    const chatRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "chats", orderId);
    await Firestore.setDoc(chatRef, { updatedAt: Firestore.serverTimestamp() }, { merge: true });
  }catch(_){}
}


async function openOrderModal(orderId){
  const modal = _ensureModal();
  __JPED_OPEN_ORDER_ID = orderId;

  // garante que o chat comece fechado (não altera o layout do pedido)
  try { if (modal.__closeChat) modal.__closeChat(); } catch (_) {}


  // reset unread when abre um pedido novo
  try{ modal.__chatSeenCount = 0; const b = modal.querySelector('#chatFabBadge'); if (b) { b.textContent='0'; b.classList.add('hidden'); } }catch(_){}
  // tenta pegar privado (completo). Se não puder, usa público.
  let data = null;
  try{
    const priv = Firestore.doc(db,"restaurants",RESTAURANT_ID,"orders",orderId);
    const ps = await Firestore.getDoc(priv);
    if (ps.exists()) data = ps.data();
  }catch(_){}

  if(!data){
    try{
      const pub = Firestore.doc(db,"restaurants",RESTAURANT_ID,"orders_public",orderId);
      const qs = await Firestore.getDoc(pub);
      if (qs.exists()) data = qs.data();
    }catch(_){}
  }
  if(!data) return;

  const orderNum = data.orderNumber || "----";
  const customerName = data.customer?.name || data.customerName || "Cliente";
  const phone = data.customer?.phone || "-";
  const address = data.customer?.address || "-";
  const status = data.status || "recebido";
  const subtotal = data.totals?.subtotal ?? 0;

  modal.querySelector("#modalOrderNum").textContent = `#${orderNum}`;
  modal.querySelector("#modalCustomer").textContent = customerName;
  modal.querySelector("#modalMeta").textContent = `${statusLabel(status)} • ${brl(subtotal)}`;

  const items = Array.isArray(data.items) ? data.items : [];
  modal.querySelector("#modalItems").innerHTML = items.length
    ? items.map(i => `
        <div class="modalItem">
          <div class="miLeft">
            <div class="miName">${i.name || "-"}</div>
          </div>
          <div class="miRight">${i.qty || 0}x</div>
        </div>
      `).join("")
    : `<div class="modalEmpty">Sem itens</div>`;

  modal.querySelector("#modalDelivery").innerHTML = `
    <div><strong>Whats:</strong> ${phone}</div>
    <div style="margin-top:6px"><strong>Endereço:</strong> ${address}</div>
  `;

  // ações no modal
  modal.querySelector("#modalDispatch").onclick = async () => { await setOrderStatus(orderId,"saiu_pra_entrega"); closeOrderModal(); };
  modal.querySelector("#modalDelivered").onclick = async () => { await setOrderStatus(orderId,"entregue"); closeOrderModal(); };
  modal.querySelector("#modalCancel").onclick = async () => { await setOrderStatus(orderId,"cancelado"); closeOrderModal(); };

  // ===== Chat (admin) =====
  try {
    startAdminChat(orderId);

    const sendBtn = modal.querySelector("#modalChatSend");
    const input = modal.querySelector("#modalChatText");
    if (sendBtn && input) {
      sendBtn.onclick = async () => {
        const msg = (input.value || "").trim();
        if (!msg) return;
        sendBtn.disabled = true;
        try {
          await sendAdminChat(orderId, msg);
          input.value = "";
        } catch (e) {
          console.warn("Falha ao enviar chat (admin):", e?.code || e, e?.message || "");
          alert("Não deu pra enviar a mensagem. Veja o console (F12).");
        } finally {
          sendBtn.disabled = false;
        }
      };

      // Enter envia
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          sendBtn.click();
        }
      };
    }
  } catch (e) {
    console.warn("Chat admin não iniciou:", e?.code || e, e?.message || "");
  }

  modal.classList.remove("hidden");
}

/** Clique no card abre modal (botões não abrem) */
(function _wireCardClick(){
  if (window.__JPED_WIRE_CARD) return;
  window.__JPED_WIRE_CARD = true;

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-act][data-id]")) return; // botão
    const card = e.target.closest(".order");
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    openOrderModal(id);
  });
})();

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
    
      _startTimeBadges();},
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

  await checkSubscriptionGate();
  if (guardIfSubscriptionBlocked()) return;

  if (unsubOrders) unsubOrders();
  startOrdersListener();});

/* ===== Menu lateral (telas) ===== */
(function(){
  const buttons = Array.from(document.querySelectorAll(".menuItem"));
  if (!buttons.length) return;

  const pages = Array.from(document.querySelectorAll(".page"));
  const titleEl = document.getElementById("pageTitle");

  function show(page){
    buttons.forEach(b => b.classList.toggle("active", b.dataset.page === page));
    pages.forEach(p => p.classList.remove("active"));
    const target = document.getElementById("page-" + page);
    if (target) target.classList.add("active");
    if (titleEl) {
      const map = { orders:"Pedidos", products:"Produtos", finance:"Financeiro", settings:"Configurações" };
      titleEl.textContent = map[page] || "Pedidos";
    }

    // ✅ Inicia o CRUD de produtos só quando abre a tela
    if (page === "products") {
      try { _startProductsListener(); } catch (_) {}
    }
  }

  buttons.forEach(btn => btn.addEventListener("click", () => show(btn.dataset.page)));
  // padrão
  const first = buttons.find(b => b.dataset.page === "orders") || buttons[0];
  if (first) show(first.dataset.page);
})();

// segurança: inicia o ticker mesmo se o render demorar

/* ===== Produtos: CRUD (criar/editar) ===== */
let unsubProducts = null;
let __JPED_PRODUCTS_CACHE = [];
let __JPED_PRODUCTS_READY = false;

function _num(v){
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function _productsCol(){
  return Firestore.collection(db, "restaurants", RESTAURANT_ID, "products");
}

function _prodCanWrite(){
  if (!SUBSCRIPTION_OK) {
    alert("Assinatura expirada. Ative um plano para editar produtos.");
    return false;
  }
  if (!ADMIN_OK) return false;
  return true;
}

async function _ensureAdminForProducts(){
  if (ADMIN_OK) return true;
  try { await checkAdminAccess(); } catch(_) {}
  if (!ADMIN_OK) {
    alert("Sem permissão de admin para editar produtos.");
    return false;
  }
  return true;
}

function _renderProducts(list){
  const host = document.getElementById("productsList");
  const empty = document.getElementById("productsEmpty");
  if (!host) return;

  host.innerHTML = "";

  const q = (document.getElementById("prodSearch")?.value || "").trim().toLowerCase();
  const filtered = (list || []).filter(p => {
    if (!q) return true;
    const hay = `${p.name||""} ${p.category||""} ${p.desc||""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  for (const p of filtered) {
    const div = document.createElement("div");
    div.className = "prodCard";
    const active = p.active !== false; // default true
    div.innerHTML = `
      <div class="prodCardTop">
        <div>
          <div class="prodName">${(p.name || "Sem nome")}</div>
          <div class="prodMeta">
            <span class="badge small ${active ? "good" : "off"}">
              <span class="badgeDot" style="background:${active ? "#22c55e" : "#94a3b8"}"></span>
              ${active ? "Ativo" : "Inativo"}
            </span>
            ${p.category ? `<span class="badge small">${p.category}</span>` : ""}
          </div>
        </div>
        <div class="prodPrice">${brl(p.price ?? 0)}</div>
      </div>

      ${p.desc ? `<div class="muted">${String(p.desc).slice(0, 120)}${String(p.desc).length > 120 ? "…" : ""}</div>` : ""}

      <div class="prodActions">
        <button class="ghost small" type="button" data-prod-act="toggle" data-id="${p.id}">
          ${active ? "Desativar" : "Ativar"}
        </button>
        <button class="btn small" type="button" data-prod-act="edit" data-id="${p.id}">Editar</button>
        <button class="ghost small danger" type="button" data-prod-act="del" data-id="${p.id}">Excluir</button>
      </div>
    `;
    host.appendChild(div);
  }
}

function _startProductsListener(){
  if (__JPED_PRODUCTS_READY) return;
  __JPED_PRODUCTS_READY = true;

  const search = document.getElementById("prodSearch");
  const btnNew = document.getElementById("btnNewProduct");

  if (search) {
    search.addEventListener("input", () => _renderProducts(__JPED_PRODUCTS_CACHE));
  }
  if (btnNew) {
    btnNew.addEventListener("click", async () => {
      if (!await _ensureAdminForProducts()) return;
      openProductModal(null);
    });
  }

  // Delegação: botões nos cards
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-prod-act][data-id]");
    if (!btn) return;

    const act = btn.getAttribute("data-prod-act");
    const id = btn.getAttribute("data-id");
    const item = __JPED_PRODUCTS_CACHE.find(x => x.id === id) || null;

    if (!await _ensureAdminForProducts()) return;

    if (act === "edit") {
      openProductModal(item);
      return;
    }

    if (act === "del") {
      if (!item) return;
      const ok = confirm(`Excluir o produto "${item.name || "Sem nome"}"?`);
      if (!ok) return;
      if (!_prodCanWrite()) return;

      try{
        await Firestore.deleteDoc(Firestore.doc(db,"restaurants",RESTAURANT_ID,"products",id));
      }catch(err){
        console.warn("Falha ao excluir produto:", err?.code || err, err?.message || "");
        alert("Não foi possível excluir. Veja o console (F12).");
      }
      return;
    }

    if (act === "toggle") {
      if (!item) return;
      if (!_prodCanWrite()) return;

      try{
        await Firestore.updateDoc(
          Firestore.doc(db,"restaurants",RESTAURANT_ID,"products",id),
          { active: !(item.active !== false), updatedAt: Firestore.serverTimestamp() }
        );
      }catch(err){
        console.warn("Falha ao ativar/desativar:", err?.code || err, err?.message || "");
        alert("Não foi possível atualizar. Veja o console (F12).");
      }
      return;
    }
  });

  // Realtime
  if (!RESTAURANT_ID) return;

  const ref = _productsCol();
  const q = Firestore.query(ref, Firestore.orderBy("name","asc"));

  unsubProducts = Firestore.onSnapshot(q, (snap) => {
    __JPED_PRODUCTS_CACHE = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderProducts(__JPED_PRODUCTS_CACHE);
  }, (err) => {
    console.warn("Erro ao ouvir produtos:", err?.code || err, err?.message || "");
  });
}

function _stopProductsListener(){
  if (unsubProducts) {
    try { unsubProducts(); } catch(_) {}
    unsubProducts = null;
  }
  __JPED_PRODUCTS_READY = false;
}

/* ===== Modal: criar/editar produto ===== */
function _ensureProductModal(){
  let modal = document.getElementById("prodModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "prodModal";
  modal.className = "prodModal hidden";
  modal.innerHTML = `
    <div class="prodModalContent" role="dialog" aria-modal="true">
      <button type="button" class="modalClose" id="prodModalClose" aria-label="Fechar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      <div class="modalHeader">
        <div class="modalOrderNum" id="prodModalTitle">Novo produto</div>
        <div class="modalMeta" id="prodModalSub">Preencha os dados abaixo.</div>
      </div>

      <div class="modalSection">
        <div class="formGrid">
          <div class="formRow">
            <div class="label">Nome</div>
            <input id="pName" class="input" placeholder="Ex: X-Salada" />
          </div>

          <div class="formRow">
            <div class="label">Preço (R$)</div>
            <input id="pPrice" class="input" inputmode="decimal" placeholder="Ex: 25,90" />
          </div>

          <div class="formRow">
            <div class="label">Categoria</div>
            <input id="pCategory" class="input" placeholder="Ex: Lanches" />
          </div>

          <div class="formRow">
            <div class="label">Imagem (URL) (opcional)</div>
            <input id="pImage" class="input" placeholder="https://..." />
          </div>

          <div class="formRow">
            <div class="label">Upload da imagem (opcional)</div>
            <input id="pImageFile" class="input" type="file" accept="image/*" />
            <div class="muted" id="pImageStatus" style="margin-top:6px"></div>

            <div class="prodImgWrap" style="margin-top:10px;display:flex;justify-content:center">
              <img id="pImagePreview" alt="Preview" class="prodImgPreview"
                   style="display:none;max-width:100%;max-height:200px;border-radius:14px;border:1px solid #e5e7eb;background:#fff" />
            </div>
          </div>
        </div>

        <div class="formRow" style="margin-top:10px">
          <div class="label">Descrição (opcional)</div>
          <textarea id="pDesc" class="input textarea" placeholder="Ex: pão, hamburguer, queijo..."></textarea>
        </div>

        
        <div class="formRow" style="margin-top:14px">
          <div class="label">Tamanhos (opcional)</div>
          <div class="muted" style="margin-top:-2px">Defina opções de tamanho e o preço final de cada tamanho.</div>
          <div id="pSizes" class="optList"></div>
          <button type="button" class="ghost small" id="btnAddSize">+ Adicionar tamanho</button>
        </div>

        <div class="formRow" style="margin-top:14px">
          <div class="label">Adicionais (opcional)</div>
          <div class="muted" style="margin-top:-2px">Itens extras que o cliente pode escolher.</div>
          <div id="pAddons" class="optList"></div>
          <button type="button" class="ghost small" id="btnAddAddon">+ Adicionar adicional</button>
        </div>
<div class="toggleRow" style="margin-top:10px">
          <input id="pActive" type="checkbox" />
          <div>
            <div style="font-weight:900;color:#0f172a">Ativo</div>
            <div class="muted">Se desativar, some do cardápio do cliente.</div>
          </div>
        </div>
      </div>

      <div class="modalFooter">
        <button type="button" class="ghost small" id="prodCancel">Cancelar</button>
        <button type="button" class="btn small" id="prodSave">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => closeProductModal();
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector("#prodModalClose").addEventListener("click", close);
  modal.querySelector("#prodCancel").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  return modal;
}


/* ===== Produtos: opções (tamanhos / adicionais) ===== */
function _optRow(kind, data){
  const row = document.createElement("div");
  row.className = "optRow";
  const name = (data?.name || "").trim();
  const price = (data?.price ?? "") === "" ? "" : String(data?.price ?? "");
  const phName = kind === "size" ? "Ex: Pequeno" : "Ex: Bacon";
  const phPrice = kind === "size" ? "Preço final (ex: 29,90)" : "Preço (ex: 3,00)";

  row.innerHTML = `
    <input class="input optName" placeholder="${phName}" value="${name.replaceAll('"','&quot;')}" />
    <input class="input optPrice" inputmode="decimal" placeholder="${phPrice}" value="${price.replaceAll('"','&quot;')}" />
    <button type="button" class="ghost small danger optDel" aria-label="Remover">Remover</button>
  `;

  row.querySelector(".optDel")?.addEventListener("click", () => row.remove());
  return row;
}

function _readOptList(containerEl){
  const out = [];
  if (!containerEl) return out;
  containerEl.querySelectorAll(".optRow").forEach((row) => {
    const name = (row.querySelector(".optName")?.value || "").trim();
    const price = _num(row.querySelector(".optPrice")?.value || "");
    if (!name) return;
    out.push({ name, price });
  });
  return out;
}

let __JPED_EDIT_PROD_ID = null;

function closeProductModal(){
  const modal = document.getElementById("prodModal");
  if (!modal) return;
  modal.classList.add("hidden");
  __JPED_EDIT_PROD_ID = null;
}

function openProductModal(prod){
  const modal = _ensureProductModal();
  __JPED_EDIT_PROD_ID = prod?.id || null;

  const title = modal.querySelector("#prodModalTitle");
  const sub = modal.querySelector("#prodModalSub");
  title.textContent = __JPED_EDIT_PROD_ID ? "Editar produto" : "Novo produto";
  sub.textContent = __JPED_EDIT_PROD_ID ? `ID: ${__JPED_EDIT_PROD_ID}` : "Preencha os dados abaixo.";

  modal.querySelector("#pName").value = prod?.name || "";
  modal.querySelector("#pPrice").value = (prod?.price ?? "") === "" ? "" : String(prod?.price ?? "");
  modal.querySelector("#pCategory").value = prod?.category || "";
  modal.querySelector("#pImage").value = prod?.imageUrl || "";

  // ===== Upload + Preview =====
  const urlInput = modal.querySelector("#pImage");
  const fileInput = modal.querySelector("#pImageFile");
  const previewImg = modal.querySelector("#pImagePreview");
  const statusEl = modal.querySelector("#pImageStatus");

  function setPreview(src) {
    if (!previewImg) return;
    if (!src) {
      previewImg.style.display = "none";
      previewImg.removeAttribute("src");
      return;
    }
    previewImg.src = src;
    previewImg.style.display = "block";
  }

  // preview inicial (se já tem url salva)
  setPreview((urlInput?.value || "").trim());

  // preview quando digita URL
  if (urlInput) {
    urlInput.oninput = () => setPreview((urlInput.value || "").trim());
  }

  // upload quando escolhe arquivo
  if (fileInput) {
    fileInput.value = ""; // sempre limpa ao abrir modal

    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;

      let localUrl = "";
      try {
        localUrl = URL.createObjectURL(f);
        setPreview(localUrl);
      } catch (_) {}

      if (statusEl) statusEl.textContent = "Enviando imagem...";

      // trava inputs durante upload
      if (urlInput) urlInput.disabled = true;
      fileInput.disabled = true;

      try {
        const finalUrl = await uploadProductImage(f);

        // coloca a URL final no campo e no preview
        if (urlInput) urlInput.value = finalUrl || "";
        setPreview(finalUrl || "");

        if (statusEl) statusEl.textContent = "Imagem enviada ✅";
      } catch (e) {
        console.warn("Upload imagem falhou:", e?.code || e, e?.message || e);
        if (statusEl) statusEl.textContent = "Falha ao enviar imagem ❌";
        alert(e?.message || "Não foi possível enviar a imagem.");
      } finally {
        if (urlInput) urlInput.disabled = false;
        fileInput.disabled = false;
        try { if (localUrl) URL.revokeObjectURL(localUrl); } catch (_) {}
      }
    };
  }

  modal.querySelector("#pDesc").value = prod?.desc || "";
  modal.querySelector("#pActive").checked = (prod?.active !== false);

  // ===== Tamanhos / Adicionais =====
  const sizesBox = modal.querySelector("#pSizes");
  const addonsBox = modal.querySelector("#pAddons");
  const btnAddSize = modal.querySelector("#btnAddSize");
  const btnAddAddon = modal.querySelector("#btnAddAddon");

  if (sizesBox) sizesBox.innerHTML = "";
  if (addonsBox) addonsBox.innerHTML = "";

  const sizes = Array.isArray(prod?.sizes) ? prod.sizes : [];
  const addons = Array.isArray(prod?.addons) ? prod.addons : [];

  // preenche
  if (sizesBox) {
    (sizes || []).forEach(s => sizesBox.appendChild(_optRow("size", s)));
  }
  if (addonsBox) {
    (addons || []).forEach(a => addonsBox.appendChild(_optRow("addon", a)));
  }

  // se não tiver nada, cria 1 linha opcional (fica mais fácil pro usuário)
  if (sizesBox && !sizes.length) sizesBox.appendChild(_optRow("size", { name: "", price: "" }));
  if (addonsBox && !addons.length) addonsBox.appendChild(_optRow("addon", { name: "", price: "" }));

  if (btnAddSize && sizesBox) {
    btnAddSize.onclick = () => sizesBox.appendChild(_optRow("size", { name: "", price: "" }));
  }
  if (btnAddAddon && addonsBox) {
    btnAddAddon.onclick = () => addonsBox.appendChild(_optRow("addon", { name: "", price: "" }));
  }


  const saveBtn = modal.querySelector("#prodSave");
  saveBtn.onclick = async () => {
    if (!await _ensureAdminForProducts()) return;
    if (!_prodCanWrite()) return;

    const payload = {
      name: (modal.querySelector("#pName").value || "").trim(),
      price: _num(modal.querySelector("#pPrice").value),
      category: (modal.querySelector("#pCategory").value || "").trim(),
      imageUrl: (modal.querySelector("#pImage").value || "").trim(),
      desc: (modal.querySelector("#pDesc").value || "").trim(),
      active: !!modal.querySelector("#pActive").checked,
      updatedAt: Firestore.serverTimestamp()
    };

    // opções (tamanhos / adicionais)
    try{
      payload.sizes = _readOptList(sizesBox);
      payload.addons = _readOptList(addonsBox);
    }catch(_){
      payload.sizes = [];
      payload.addons = [];
    }


    if (!payload.name) {
      alert("Coloque um nome para o produto.");
      return;
    }

    saveBtn.disabled = true;
    try{
      if (__JPED_EDIT_PROD_ID) {
        await Firestore.updateDoc(
          Firestore.doc(db,"restaurants",RESTAURANT_ID,"products",__JPED_EDIT_PROD_ID),
          payload
        );
      } else {
        await Firestore.addDoc(_productsCol(), {
          ...payload,
          createdAt: Firestore.serverTimestamp()
        });
      }
      closeProductModal();
    }catch(err){
      console.warn("Falha ao salvar produto:", err?.code || err, err?.message || "");
      alert("Não foi possível salvar. Veja o console (F12).");
    }finally{
      saveBtn.disabled = false;
    }
  };

  modal.classList.remove("hidden");
}


document.addEventListener("DOMContentLoaded", () => {
  try { _startTimeBadges(); } catch (_) {}
});
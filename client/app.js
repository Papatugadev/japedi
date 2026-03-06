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
   STATE (precisa existir ANTES do onAuthStateChanged)
   ========================= */

const state = {
  slug: null,
  restaurant: null,
  config: null,
  isOpen: true,
  showImages: true,
  checkoutMode: "delivery",
  paymentMethod: "pix",
  couponCode: "",
  products: [],
  cart: [], // [{id,name,price,qty}]
  currentOrderId: null,
  currentOrderNumber: null,
  customerUid: null,
  unsubTrack: null,
  unsubChat: null,
  selectedCategory: "Todos",
  categories: [],

  // (adicionado) Chat unread / notificações
  chatUnread: 0,
  chatInitialized: false,
  chatLastSeenRestaurantMs: 0,
  chatToastTimer: null
};

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

/** Util: formatar BRL */
function moneyBRL(value) {
  const v = Number(value || 0);
  const cur = (state?.config?.theme?.currency || "BRL").toString().trim() || "BRL";
  return v.toLocaleString("pt-BR", { style: "currency", currency: cur });
}

// ============================
// Chat FAB: badge + popup + som (adicionado sem remover nada)
// ============================
function isChatDrawerOpen() {
  const d = document.getElementById("chatDrawer");
  return !!(d && !d.classList.contains("hidden"));
}

function setChatUnread(n) {
  state.chatUnread = Math.max(0, Number(n || 0));
  const badge = document.getElementById("chatUnreadBadge");
  if (!badge) return;
  if (state.chatUnread > 0) {
    badge.textContent = String(state.chatUnread);
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "0";
    badge.classList.add("hidden");
  }
}

function showChatToast(text) {
  const toast = document.getElementById("chatToast");
  if (!toast) return;
  toast.textContent = text || "Nova mensagem";
  toast.classList.remove("hidden");
  // pequena animação
  requestAnimationFrame(() => toast.classList.add("show"));
  if (state.chatToastTimer) clearTimeout(state.chatToastTimer);
  state.chatToastTimer = setTimeout(() => {
    try { toast.classList.remove("show"); } catch(_) {}
    setTimeout(() => { try { toast.classList.add("hidden"); } catch(_) {} }, 180);
  }, 2400);
}

function resetChatUnread() {
  setChatUnread(0);
  const toast = document.getElementById("chatToast");
  if (toast) {
    try { toast.classList.remove("show"); } catch(_) {}
    try { toast.classList.add("hidden"); } catch(_) {}
  }
}

function playChatPing() {
  // Beep simples via WebAudio (sem arquivo externo).
  // Pode ser bloqueado até o usuário interagir (normal do navegador).
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o.start(now);
    o.stop(now + 0.25);
    o.onended = () => { try { ctx.close(); } catch(_) {} };
  } catch(_) {}
}

/** Util: gera número de pedido (4 dígitos) para exibir como #1234 */
function genOrderNumber4() {
  return Math.floor(1000 + Math.random() * 9000);
}

/** Pega slug por ?slug=... (recomendado) ou ?r=... (compat) ou /r/slug */
function getSlug() {
  const params = new URLSearchParams(window.location.search);

  // ✅ preferido
  const fromSlug = params.get("slug");
  if (fromSlug) return fromSlug;

  // ✅ compat antigo
  const fromR = params.get("r");
  if (fromR) return fromR;

  // ✅ path: /r/slug
  const parts = (window.location.pathname || "/").split("/").filter(Boolean);
  if (parts[0] === "r" && parts[1]) return parts[1];

  return null;
}

function saveLastSlug(slug){
  try { localStorage.setItem("japed:lastSlug", String(slug || "")); } catch(_) {}
}

function loadLastSlug(){
  try {
    const s = localStorage.getItem("japed:lastSlug");
    return (s && String(s).trim()) ? String(s).trim() : null;
  } catch(_) {
    return null;
  }
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
   CONFIG (restaurants/{rid}/config/app)
   ========================= */

async function fetchAppConfig(restaurantId){
  try{
    const ref = Firestore.doc(db, "restaurants", restaurantId, "config", "app");
    const snap = await Firestore.getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : {};
  }catch(e){
    console.warn("Falha ao carregar config/app:", e?.code || e, e?.message || "");
    return {};
  }
}

// Realtime: atualiza config em tempo real (quando mudar no admin)
let __JPED_UNSUB_CONFIG = null;

function startConfigListener(restaurantId){
  try{
    if (__JPED_UNSUB_CONFIG) { try{ __JPED_UNSUB_CONFIG(); }catch(_){} __JPED_UNSUB_CONFIG=null; }
    const ref = Firestore.doc(db, "restaurants", restaurantId, "config", "app");
    __JPED_UNSUB_CONFIG = Firestore.onSnapshot(ref, (snap) => {
      const cfg = snap.exists() ? (snap.data() || {}) : {};
      applyConfigToClient(cfg);
    }, (err) => {
      console.warn("Erro config realtime:", err?.code || err, err?.message || "");
    });
  }catch(e){
    console.warn("Falha ao iniciar listener de config:", e?.code || e, e?.message || "");
  }
}

function _setCssVar(name, value){
  try{
    if (!value) return;
    document.documentElement.style.setProperty(name, String(value).trim());
  }catch(_){}
}

function _hexToRgb(hex){
  try{
    let h = String(hex || "").trim();
    if (!h) return null;
    if (h.startsWith("rgb")) return null; // já é rgb/rgba
    if (h[0] === "#") h = h.slice(1);
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    if ([r,g,b].some(n => Number.isNaN(n))) return null;
    return { r, g, b };
  }catch(_){ return null; }
}

function _isLightColor(hex){
  const rgb = _hexToRgb(hex);
  if (!rgb) return false;
  // luminância relativa (aprox) para escolher texto preto/branco
  const y = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return y > 170;
}

function _setOnPrimary(primaryHex){
  try{
    if (!primaryHex) return;
    const on = _isLightColor(primaryHex) ? "#111111" : "#ffffff";
    document.documentElement.style.setProperty("--onPrimary", on);
  }catch(_){}
}

/**
 * ✅ Banner PROMO (única fonte de verdade)
 * - Cria abaixo do header.topbar
 * - applyConfigToClient controla mostrar/ocultar e textos
 */
function _ensurePromoBanner(){
  try{
    let banner = document.getElementById("promoBanner");
    if (banner) return banner;

    const header = document.querySelector("header.topbar");
    if (!header) return null;

    banner = document.createElement("div");
    banner.id = "promoBanner";
    banner.className = "promoBanner hidden";

    banner.innerHTML = `
      <div class="promoGlow"></div>

      <div class="promoCard promoPro" role="note" aria-label="Promoção">
        <div class="promoLeft">
          <div class="promoBadge">🔥 PROMO</div>

          <div class="promoTitle" id="promoTitleText">Promoção</div>
          <div class="promoSub" id="promoSubText"></div>

          <div class="promoRow">
            <button class="promoCouponBtn" id="promoCopyBtn" type="button" aria-label="Copiar cupom">
              <span class="promoCouponLabel" id="promoCouponText">CUPOM: —</span>
              <span class="promoCopyIcon" aria-hidden="true">📋</span>
            </button>

            <div class="promoMini" id="promoCountdown" style="display:none"></div>
          </div>
        </div>

        <div class="promoRight">
          <div class="promoIcon">✨</div>
        </div>
      </div>
    `;

    header.insertAdjacentElement("afterend", banner);

    // Clique pra copiar
    const btn = banner.querySelector("#promoCopyBtn");
    if (btn){
      btn.addEventListener("click", async () => {
        const code = (btn.getAttribute("data-coupon") || "").trim();
        if (!code) return;
        try{
          await _copyText(code);
          _toast(`Cupom copiado: ${code} ✅`);
          try{ if (navigator.vibrate) navigator.vibrate(30); }catch(_){}
        }catch(_){
          _toast("Não deu pra copiar automaticamente. Segure e copie.");
        }
      });
    }

    return banner;
  }catch(_){
    return null;
  }
}

// ===== util: copiar =====
async function _copyText(text){
  if (navigator.clipboard && window.isSecureContext){
    await navigator.clipboard.writeText(text);
    return true;
  }
  // fallback antigo
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy_failed");
  return true;
}

// ===== util: toast =====
let __JPED_TOAST_T = null;
function _toast(msg){
  try{
    let el = document.getElementById("toast");
    if (!el){
      el = document.createElement("div");
      el.id = "toast";
      el.style.position = "fixed";
      el.style.left = "50%";
      el.style.bottom = "18px";
      el.style.transform = "translateX(-50%)";
      el.style.zIndex = "99999";
      el.style.padding = "10px 14px";
      el.style.borderRadius = "999px";
      el.style.background = "rgba(15,23,42,.92)";
      el.style.color = "#fff";
      el.style.fontWeight = "800";
      el.style.fontSize = "13px";
      el.style.boxShadow = "0 12px 30px rgba(0,0,0,.22)";
      el.style.opacity = "0";
      el.style.transition = "opacity .18s ease, transform .18s ease";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";

    clearTimeout(__JPED_TOAST_T);
    __JPED_TOAST_T = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(10px)";
    }, 1700);
  }catch(_){}
}

function _ensureOpenPill(){
  try{
    let pill = document.getElementById("openPill");
    if (pill) return pill;
    const header = document.querySelector(".brand");
    if (!header) return null;
    pill = document.createElement("div");
    pill.id = "openPill";
    pill.className = "openPill";
    pill.innerHTML = `<span class="dot"></span><span id="openPillText">Aberto</span>`;
    header.appendChild(pill);
    return pill;
  }catch(_){ return null; }
}


// ============================
// Identidade (logo + fundo) via config.restaurant.logoUrl / coverUrl
// (adicionado sem remover nada)
// ============================
function _applyBrandIdentity(r){
  try{
    r = r || {};
    const logoUrl = String(r.logoUrl || r.logo || "").trim();
    const coverUrl = String(r.coverUrl || r.cover || r.backgroundUrl || "").trim();

    const header = document.querySelector("header.topbar");
    const coverEl = document.getElementById("brandCover");
    const logoEl = document.getElementById("brandLogo");

    if (coverEl){
      if (coverUrl){
        coverEl.style.backgroundImage = `url("${coverUrl.replace(/"/g, '\"')}")`;
        coverEl.classList.remove("hidden");
        if (header) header.classList.add("hasCover");
      } else {
        coverEl.style.backgroundImage = "";
        coverEl.classList.add("hidden");
        if (header) header.classList.remove("hasCover");
      }
    }

    if (logoEl){
      if (logoUrl){
        logoEl.src = logoUrl;
        logoEl.classList.remove("hidden");
      } else {
        logoEl.removeAttribute("src");
        logoEl.classList.add("hidden");
      }
    }
  }catch(_){}
}

function applyConfigToClient(cfg){
  cfg = cfg || {};
  state.config = cfg;

  // aplica identidade mesmo antes do render (se existir)
  try { _applyBrandIdentity(cfg?.restaurant || {}); } catch(_) {}

  const r = cfg.restaurant || {};
  const hours = cfg.hours || {};
  const delivery = cfg.delivery || {};
  const pay = cfg.payments || {};
  const promo = cfg.promo || {};
  const theme = cfg.theme || {};
  const adv = cfg.advanced || {};

  // flags
  state.isOpen = (hours.isOpen !== false);
  state.showImages = (theme.showImages !== false);

  // tema (DESATIVADO)
  // Você pediu para NÃO mudar a cor do app pelo painel admin.
  // A cor fica fixa no CSS (:root --primary).
  // _setCssVar("--accent", (theme.primary || "").trim());
  // _setCssVar("--primary", (theme.primary || "").trim());
  // _setOnPrimary((theme.primary || "").trim());

  // esconder imagens e menu compacto
  document.body.classList.toggle("noImages", !state.showImages);
  document.body.classList.toggle("compactMenu", !!theme.compactMenu);

  // sobrescreve infos do restaurante no state.restaurant (sem apagar outras)
  if (state.restaurant){
    if (r.name) state.restaurant.name = r.name;
    if (r.desc) state.restaurant.desc = r.desc;
    if (r.whatsapp) state.restaurant.whatsapp = r.whatsapp;
    if (r.instagram) state.restaurant.instagram = r.instagram;
  }

  // aplica logo/fundo (identidade)
  try { _applyBrandIdentity(Object.assign({}, state.restaurant || {}, r || {})); } catch(_) {}

  // pill aberto/fechado
  const pill = _ensureOpenPill();
  if (pill){
    const txt = document.getElementById("openPillText");
    pill.classList.toggle("isClosed", !state.isOpen);
    if (txt) txt.textContent = state.isOpen ? "Aberto" : "Fechado";
  }

  // ✅ banner promo (único)
// ✅ banner promo (único)
const banner = _ensurePromoBanner();
if (banner){
  const on = !!promo.enabled;

  const title = (promo.title || "").trim();
  const sub = (promo.subtitle || promo.notice || "").trim();
  const code = (promo.couponCode || "").trim();
  const pct = promo.couponPct || "";
  const endsAtMs = _parsePromoEndsAt(promo.endsAt);

  const expired = !!(endsAtMs && Date.now() >= endsAtMs);

  const t = banner.querySelector("#promoTitleText");
  const s = banner.querySelector("#promoSubText");
  const couponText = banner.querySelector("#promoCouponText");
  const couponBtn = banner.querySelector("#promoCopyBtn");

  const shouldShow = on && !expired && (title || sub || code);

  if (!shouldShow){
    banner.classList.add("hidden");
  } else {
    banner.classList.remove("hidden");

    if (t) t.textContent = title || "Promoção";
    if (s) s.textContent = sub || "";

    if (couponText){
      if (code){
        couponText.textContent = `CUPOM: ${code}${pct ? " • " + pct + "%" : ""}`;
      } else {
        couponText.textContent = "";
      }
    }

    if (couponBtn){
      couponBtn.setAttribute("data-coupon", code || "");
      couponBtn.style.display = code ? "inline-flex" : "none";
    }

    _startPromoCountdown(endsAtMs);
  }
}
  const couponEl = banner.querySelector("#promoCoupon");
if (couponEl) {
  const code = (promo.couponCode || "").trim();
  const pct = promo.couponPct || "";

  if (code) {
    couponEl.textContent = `CUPOM: ${code}${pct ? " • " + pct + "%" : ""}`;
  } else {
    couponEl.textContent = "";
  }
}
  if (banner){
    const on = !!promo.enabled;
    const title = (promo.title || "").trim();
    const sub = (promo.subtitle || promo.notice || "").trim();
    if (on && (title || sub)){
      banner.classList.remove("hidden");
      const t = banner.querySelector(".promoTitle");
      const s = banner.querySelector(".promoSub");
      if (t) t.textContent = title || "Promoção";
      if (s) s.textContent = sub || "";
    } else {
      banner.classList.add("hidden");
    }
  }

  // defaults do checkout com base nas configs
  // modo: se pickup habilitado, mantém último; se não, força delivery
  if (!delivery.pickup) state.checkoutMode = "delivery";
  // método pagamento: prioriza PIX se tem chave, senão dinheiro, senão cartão
  const hasPix = !!String(pay.pixKey || "").trim();
  const hasCash = (pay.cash !== false);
  const hasCard = !!pay.cardOnDelivery;

  if (hasPix) state.paymentMethod = "pix";
  else if (hasCash) state.paymentMethod = "cash";
  else if (hasCard) state.paymentMethod = "card";
  else state.paymentMethod = "cash";

  // link externo menuUrl (opcional)
  try{
    if (adv.menuUrl){
      let btn = document.getElementById("menuUrlBtn");
      const header = document.querySelector(".brand");
      if (!btn && header){
        btn = document.createElement("a");
        btn.id = "menuUrlBtn";
        btn.className = "menuUrlBtn";
        btn.target = "_blank";
        btn.rel = "noopener";
        btn.textContent = "Ver cardápio";
        header.appendChild(btn);
      }
      if (btn){
        btn.href = adv.menuUrl;
        btn.classList.remove("hidden");
      }
    }
  }catch(_){}

  // atualiza UI que depende de config
  try { updateCheckoutUIFromConfig(); } catch(_) {}
  try { updateCheckoutTotals(); } catch(_) {}
}

/* =========================
   CARRINHO (LÓGICA)
   ========================= */

function addToCart(productId) {
  // respeita config aberto/fechado
  if (state.config && state.isOpen === false) {
    const msg = state.config?.hours?.autoMsg || "Restaurante fechado no momento.";
    alert(msg);
    return;
  }
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
   MODAL PRODUTO (TAMANHOS + ADICIONAIS)
   ========================= */

let modalProduct = null;
let modalSelectedSizeIndex = 0;
let modalSelectedAddonIdx = new Set();

function openProductModal(productId){
  const p = state.products.find(x => x.id === productId);
  if (!p) return;

  modalProduct = p;
  modalSelectedSizeIndex = 0;
  modalSelectedAddonIdx = new Set();

  // Preenche UI
  const modal = document.getElementById("productModal");
  if (!modal) {
    // fallback: adiciona direto se modal não existir
    addToCart(productId);
    return;
  }

  document.getElementById("pmName").textContent = p.name || "Produto";
  document.getElementById("pmDesc").textContent = (p.desc || "").toString();

  const img = (p.imageUrl || p.image || p.img || p.photo || "").trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c";
  const imgEl = document.getElementById("pmImage");
  if (imgEl) {
    imgEl.src = img;
    imgEl.alt = p.name || "Produto";
  }

  renderProductModalOptions();
  updateProductModalTotal();

  modal.classList.remove("hidden");
}

function closeProductModal(){
  const modal = document.getElementById("productModal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function productModalGetBasePrice(){
  if (!modalProduct) return 0;

  const sizes = Array.isArray(modalProduct.sizes) ? modalProduct.sizes : [];
  if (sizes.length > 0) {
    const s = sizes[Math.max(0, Math.min(modalSelectedSizeIndex, sizes.length - 1))] || {};
    return Number(s.price || 0);
  }
  return Number(modalProduct.price || 0);
}

function productModalGetAddonsTotal(){
  if (!modalProduct) return 0;
  const addons = Array.isArray(modalProduct.addons) ? modalProduct.addons : [];
  let sum = 0;
  for (const idx of modalSelectedAddonIdx) {
    const a = addons[idx];
    if (a) sum += Number(a.price || 0);
  }
  return sum;
}

function updateProductModalTotal(){
  const totalEl = document.getElementById("pmTotal");
  if (!totalEl) return;
  const total = productModalGetBasePrice() + productModalGetAddonsTotal();
  totalEl.textContent = moneyBRL(total);
}

function renderProductModalOptions(){
  if (!modalProduct) return;

  // Tamanhos
  const sizesBox = document.getElementById("pmSizesBox");
  if (sizesBox) {
    const sizes = Array.isArray(modalProduct.sizes) ? modalProduct.sizes : [];
    sizesBox.innerHTML = "";

    if (sizes.length > 0) {
      const title = document.createElement("div");
      title.innerHTML = `<div class="pmTitle">Tamanho</div>`;
      sizesBox.appendChild(title);

      sizes.forEach((s, i) => {
        const row = document.createElement("label");
        row.className = "pmRow";
        row.innerHTML = `
          <span class="pmLeft">
            <input type="radio" name="pmSize" value="${i}" ${i === modalSelectedSizeIndex ? "checked" : ""}>
            <span>${(s?.name || "Opção")}</span>
          </span>
          <strong>${moneyBRL(s?.price)}</strong>
        `;
        sizesBox.appendChild(row);
      });

      sizesBox.querySelectorAll('input[name="pmSize"]').forEach((r) => {
        r.addEventListener("change", () => {
          modalSelectedSizeIndex = Number(r.value || 0);
          updateProductModalTotal();
        });
      });
    }
  }

  // Adicionais
  const addonsBox = document.getElementById("pmAddonsBox");
  if (addonsBox) {
    const addons = Array.isArray(modalProduct.addons) ? modalProduct.addons : [];
    addonsBox.innerHTML = "";

    if (addons.length > 0) {
      const title = document.createElement("div");
      title.innerHTML = `<div class="pmTitle">Adicionais</div>`;
      addonsBox.appendChild(title);

      addons.forEach((a, i) => {
        const row = document.createElement("label");
        row.className = "pmRow";
        row.innerHTML = `
          <span class="pmLeft">
            <input type="checkbox" name="pmAddon" value="${i}">
            <span>${(a?.name || "Adicional")}</span>
          </span>
          <strong>+ ${moneyBRL(a?.price)}</strong>
        `;
        addonsBox.appendChild(row);
      });

      addonsBox.querySelectorAll('input[name="pmAddon"]').forEach((c) => {
        c.addEventListener("change", () => {
          const idx = Number(c.value || 0);
          if (c.checked) modalSelectedAddonIdx.add(idx);
          else modalSelectedAddonIdx.delete(idx);
          updateProductModalTotal();
        });
      });
    }
  }
}

function addConfiguredToCart(){
  if (!modalProduct) return;

  const sizes = Array.isArray(modalProduct.sizes) ? modalProduct.sizes : [];
  const addons = Array.isArray(modalProduct.addons) ? modalProduct.addons : [];

  const chosenSize = sizes.length > 0
    ? (sizes[Math.max(0, Math.min(modalSelectedSizeIndex, sizes.length - 1))] || null)
    : null;

  const chosenAddons = [];
  for (const idx of modalSelectedAddonIdx) {
    const a = addons[idx];
    if (a) chosenAddons.push({ name: a.name || "Adicional", price: Number(a.price || 0) });
  }

  const basePrice = chosenSize ? Number(chosenSize.price || 0) : Number(modalProduct.price || 0);
  const addonsTotal = chosenAddons.reduce((acc, a) => acc + Number(a.price || 0), 0);
  const unitPrice = basePrice + addonsTotal;

  const optionsParts = [];
  if (chosenSize?.name) optionsParts.push(chosenSize.name);
  if (chosenAddons.length) optionsParts.push(chosenAddons.map(a => a.name).join(", "));
  const optionsText = optionsParts.join(" • ");

  state.cart.push({
    // id único por configuração (permite 2 do mesmo produto com opções diferentes)
    id: `${modalProduct.id}_${Date.now()}`,
    productId: modalProduct.id,
    name: modalProduct.name || "Produto",
    optionsText,
    price: unitPrice,
    qty: 1,
    meta: {
      size: chosenSize ? { name: chosenSize.name || "", price: Number(chosenSize.price || 0) } : null,
      addons: chosenAddons
    }
  });

  renderCartUI();
  closeProductModal();
}

/* =========================
   UI (RENDER)
   ========================= */
function buildCategories(){
  const set = new Set();

  state.products.forEach(p=>{
    if(p.category) set.add(p.category);
  });

  state.categories = ["Todos", ...Array.from(set).sort()];

  const bar = document.getElementById("categoryBar");
  const list = document.getElementById("categoryList");

  if(!list) return;
  if (bar) bar.classList.remove("hidden");

  list.innerHTML="";

  state.categories.forEach(cat=>{
    const chip=document.createElement("div");
    chip.className="categoryChip";
    if(cat===state.selectedCategory) chip.classList.add("active");

    chip.textContent=cat;

    chip.onclick=()=>{
      state.selectedCategory=cat;
      buildCategories();
      renderProducts();
    };

    list.appendChild(chip);
  });
}

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
  // Identidade: no topo preferimos a descrição (sem exibir WhatsApp aqui)
  descEl.textContent = (state.restaurant.desc || "").toString();

  wrap.innerHTML = "";

  let activeProducts = state.products
    .filter(p => p.active !== false);

  if(state.selectedCategory !== "Todos"){
    activeProducts = activeProducts.filter(
      p => (p.category || "Outros") === state.selectedCategory
    );
  }

  activeProducts = activeProducts.sort(
    (a,b)=> (a.name||"").localeCompare(b.name||"")
  );

  for (const p of activeProducts){
    const img = (p.imageUrl || p.image || p.img || p.photo || "").trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c";
    const div = document.createElement("div");
    div.className = "productCard";

    div.innerHTML = `
      <img class="productImg" src="${img}" alt="${p.name || 'Produto'}" loading="lazy" decoding="async">

      <div class="productContent">
        <div class="productTitle">${p.name || "Produto"}</div>

        <div class="productDesc">
          ${(p.desc || "Delicioso prato preparado na hora").toString()}
        </div>

        <div class="productFooter">
          <div class="productPrice">${moneyBRL(p.price)}</div>
          <button class="addButton" type="button" data-add="${p.id}">+</button>
        </div>
      </div>
    `;

    wrap.appendChild(div);
  }
  wrap.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => openProductModal(btn.getAttribute("data-add")));
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
          ${item.optionsText ? '<div class="muted" style="margin-top:4px;font-size:12px">' + item.optionsText + '</div>' : ''}
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
  // compat: antes era drawer, agora é tela
  showTab("cart");
}

function closeCartDrawer() {
  // compat
  showTab("menu");
}

/* =========================
   Checkout modal open/close
   ========================= */

function openCheckout() {
  // respeita config aberto/fechado
  if (state.config && state.isOpen === false) {
    const msg = state.config?.hours?.autoMsg || "Restaurante fechado no momento.";
    alert(msg);
    return;
  }
  ensureCheckoutUI();
  updateCheckoutUIFromConfig();
  updateCheckoutTotals();
  document.getElementById("checkoutModal")?.classList?.remove("hidden");
}

function closeCheckout() {
  document.getElementById("checkoutModal")?.classList?.add("hidden");
}

function clearCheckoutInputs() {
  document.getElementById("custName").value = "";
  document.getElementById("custPhone").value = "";
  document.getElementById("custAddr").value = "";
}

let __checkoutUIReady = false;

function ensureCheckoutUI(){
  if (__checkoutUIReady) return;
  __checkoutUIReady = true;

  const content = document.querySelector("#checkoutModal .modal__content");
  if (!content) return;

  // Bloco: Entrega / Retirada
  if (!document.getElementById("coModeBox")){
    const box = document.createElement("div");
    box.id = "coModeBox";
    box.className = "coBox";
    box.innerHTML = `
      <div class="coTitle">Entrega</div>
      <div class="coChips" id="coModeChips"></div>
      <div class="coHint muted" id="coModeHint" style="margin-top:6px"></div>
    `;
    content.insertAdjacentElement("afterbegin", box);
  }

  // Bloco: Pagamento
  if (!document.getElementById("coPayBox")){
    const box = document.createElement("div");
    box.id = "coPayBox";
    box.className = "coBox";
    box.innerHTML = `
      <div class="coTitle">Pagamento</div>
      <div class="coChips" id="coPayChips"></div>
      <div class="muted" id="coPayNote" style="margin-top:6px"></div>
    `;
    content.appendChild(box);
  }

  // Cupom
  if (!document.getElementById("coCouponBox")){
    const box = document.createElement("div");
    box.id = "coCouponBox";
    box.className = "coBox";
    box.innerHTML = `
      <div class="coTitle">Cupom</div>
      <div class="coRow">
        <input id="coCouponInput" class="input" placeholder="Digite o cupom (opcional)" />
        <button id="coApplyCoupon" class="ghost" type="button">Aplicar</button>
      </div>
      <div class="muted" id="coCouponMsg" style="margin-top:6px"></div>
    `;
    content.appendChild(box);
  }

  // Totais (sub + entrega + desconto + total)
  if (!document.getElementById("coTotalsBox")){
    const footer = document.querySelector("#checkoutModal .modal__footer");
    if (footer){
      const totals = document.createElement("div");
      totals.id = "coTotalsBox";
      totals.className = "coTotals";
      totals.innerHTML = `
        <div class="coLine"><span class="muted">Subtotal</span><strong id="coSub">-</strong></div>
        <div class="coLine" id="coDeliveryLine"><span class="muted">Entrega</span><strong id="coDelivery">-</strong></div>
        <div class="coLine hidden" id="coDiscountLine"><span class="muted">Desconto</span><strong id="coDiscount">-</strong></div>
        <div class="coLine coTotal"><span>Total</span><strong id="coTotal">-</strong></div>
        <div class="muted" id="coMinWarn" style="margin-top:8px;font-size:12px"></div>
      `;
      footer.insertAdjacentElement("afterbegin", totals);
    }
  }

  // listeners
  const couponInput = document.getElementById("coCouponInput");
  const applyBtn = document.getElementById("coApplyCoupon");
  if (applyBtn && couponInput){
    applyBtn.addEventListener("click", () => {
      state.couponCode = (couponInput.value || "").trim();
      validateCouponAndUpdateUI(true);
    });
    couponInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        state.couponCode = (couponInput.value || "").trim();
        validateCouponAndUpdateUI(true);
      }
    });
  }
}

function updateCheckoutUIFromConfig(){
  ensureCheckoutUI();
  const cfg = state.config || {};
  const delivery = cfg.delivery || {};
  const pay = cfg.payments || {};
  const promo = cfg.promo || {};
  const hours = cfg.hours || {};

  // Entrega / Retirada
  const modeChips = document.getElementById("coModeChips");
  const modeHint = document.getElementById("coModeHint");
  if (modeChips){
    modeChips.innerHTML = "";
    const opts = [];
    opts.push({ id:"delivery", label:"Entrega" });
    if (delivery.pickup) opts.push({ id:"pickup", label:"Retirada" });

    opts.forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.checkoutMode === o.id ? " is-active" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => {
        state.checkoutMode = o.id;
        updateCheckoutUIFromConfig();
        updateCheckoutTotals();
      });
      modeChips.appendChild(b);
    });
  }
  if (modeHint){
    const fee = Number(delivery.fee || 0);
    const eta = Number(delivery.etaMin || 0);
    if (state.checkoutMode === "pickup"){
      modeHint.textContent = "Retirada no balcão.";
    } else {
      const parts = [];
      if (fee > 0) parts.push(`Taxa: ${moneyBRL(fee)}`);
      if (eta > 0) parts.push(`Entrega: ~${eta} min`);
      if (hours.prepMin) parts.push(`Preparo: ~${hours.prepMin} min`);
      modeHint.textContent = parts.join(" • ");
    }
  }

  // Bairros (opcional) - se tiver lista, mostra um select para facilitar
  try{
    const nbs = Array.isArray(delivery.neighborhoods) ? delivery.neighborhoods.filter(Boolean) : [];
    let sel = document.getElementById("coNeighborhood");
    if (nbs.length){
      const addr = document.getElementById("custAddr");
      if (addr && !sel){
        // cria bloco acima do endereço
        const label = document.createElement("label");
        label.className = "label";
        label.textContent = "Bairro";
        sel = document.createElement("select");
        sel.id = "coNeighborhood";
        sel.className = "input";
        sel.innerHTML = `<option value="">Selecione (opcional)</option>` + nbs.map(x => `<option value="${String(x).replace(/"/g,'&quot;')}">${x}</option>`).join("");
        sel.addEventListener("change", () => {
          const v = (sel.value || "").trim();
          if (!v) return;
          // tenta adicionar o bairro no início do endereço se não tiver
          const cur = (addr.value || "");
          if (!cur.toLowerCase().includes(v.toLowerCase())){
            addr.value = (cur ? (cur + "\n") : "") + "Bairro: " + v;
          }
        });
        // insere antes do label do endereço (que é o label anterior do textarea)
        addr.insertAdjacentElement("beforebegin", sel);
        addr.insertAdjacentElement("beforebegin", label);
      }
    } else {
      // se não tem bairros, remove o select se existir
      if (sel){
        const prev = sel.previousElementSibling;
        if (prev && prev.classList.contains("label")) prev.remove();
        sel.remove();
      }
    }
  }catch(_){}

  // Pagamento
  const payChips = document.getElementById("coPayChips");
  const payNote = document.getElementById("coPayNote");
  if (payChips){
    payChips.innerHTML = "";
    const opts = [];
    if (String(pay.pixKey || "").trim()) opts.push({ id:"pix", label:"PIX" });
    if (pay.cash !== false) opts.push({ id:"cash", label:"Dinheiro" });
    if (pay.cardOnDelivery) opts.push({ id:"card", label:"Cartão" });

    // garante método válido
    if (!opts.find(o => o.id === state.paymentMethod)){
      state.paymentMethod = opts[0]?.id || "cash";
    }

    opts.forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.paymentMethod === o.id ? " is-active" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => {
        state.paymentMethod = o.id;
        updateCheckoutUIFromConfig();
        updateCheckoutTotals();
      });
      payChips.appendChild(b);
    });
  }
  if (payNote){
    const parts = [];
    if (state.paymentMethod === "pix" && (pay.pixName || pay.pixKey)){
      parts.push(`Chave PIX: ${pay.pixKey || ""}`.trim());
      if (pay.pixName) parts.push(`Nome: ${pay.pixName}`);
    }
    if (pay.note) parts.push(pay.note);
    payNote.textContent = parts.join(" • ");
  }

  // Cupom
  const couponBox = document.getElementById("coCouponBox");
  if (couponBox){
    const show = !!(promo.enabled && promo.couponCode && promo.couponPct);
    couponBox.classList.toggle("hidden", !show);
    if (!show){
      state.couponCode = "";
      const inp = document.getElementById("coCouponInput");
      if (inp) inp.value = "";
      const msg = document.getElementById("coCouponMsg");
      if (msg) msg.textContent = "";
    }
  }
}

function validateCouponAndUpdateUI(showAlerts){
  const cfg = state.config || {};
  const promo = cfg.promo || {};
  const msg = document.getElementById("coCouponMsg");

  const code = (state.couponCode || "").trim();
  const expected = (promo.couponCode || "").trim();
  const pct = Number(promo.couponPct || 0);
  const endsAtMs = _parsePromoEndsAt(promo.endsAt);
  const expired = !!(endsAtMs && Date.now() >= endsAtMs);

  let ok = false;
  if (promo.enabled && !expired && expected && pct > 0 && code){
    ok = code.toLowerCase() === expected.toLowerCase();
  }

  if (msg){
    if (!code){
      msg.textContent = "";
    } else if (expired){
      msg.textContent = "Cupom expirado ⏰";
    } else if (ok){
      msg.textContent = `Cupom aplicado: ${pct}% OFF ✅`;
    } else {
      msg.textContent = "Cupom inválido ❌";
    }
  }

  if (showAlerts && code && expired) {
    alert("Esse cupom expirou.");
  } else if (showAlerts && code && !ok && !expired) {
    alert("Cupom inválido.");
  }

  updateCheckoutTotals();
}
function computeOrderTotals(){
  const cfg = state.config || {};
  const delivery = cfg.delivery || {};
  const promo = cfg.promo || {};

  const { subtotal, qty } = cartTotals();

  // taxa de entrega (só no modo delivery)
  const deliveryFee = (state.checkoutMode === "delivery") ? Number(delivery.fee || 0) : 0;

  // cupom (%)
let discount = 0;
const code = (state.couponCode || "").trim();
const expected = (promo.couponCode || "").trim();
const pct = Number(promo.couponPct || 0);
const endsAtMs = _parsePromoEndsAt(promo.endsAt);
const expired = !!(endsAtMs && Date.now() >= endsAtMs);

const couponOk = !!(
  promo.enabled &&
  !expired &&
  expected &&
  pct > 0 &&
  code &&
  code.toLowerCase() === expected.toLowerCase()
);

if (couponOk) {
  discount = Math.round((subtotal * (pct / 100)) * 100) / 100;
}

  const total = Math.max(0, (subtotal + deliveryFee) - discount);

  // pedido mínimo (somente delivery)
  const minOrder = Number(delivery.minOrder || 0);
  const minOk = !(state.checkoutMode === "delivery" && minOrder > 0 && subtotal < minOrder);

  return {
    qty,
    subtotal,
    deliveryFee,
    discount,
    total,
    couponOk,
    couponPct: couponOk ? pct : 0,
    minOk,
    minOrder
  };
}

function updateCheckoutTotals(){
  ensureCheckoutUI();

  const { subtotal, deliveryFee, discount, total, couponOk, couponPct } = computeOrderTotals();
  const cfg = state.config || {};
  const delivery = cfg.delivery || {};

  const subEl = document.getElementById("coSub");
  const delEl = document.getElementById("coDelivery");
  const delLine = document.getElementById("coDeliveryLine");
  const discEl = document.getElementById("coDiscount");
  const discLine = document.getElementById("coDiscountLine");
  const totalEl = document.getElementById("coTotal");
  const warnEl = document.getElementById("coMinWarn");

  if (subEl) subEl.textContent = moneyBRL(subtotal);
  if (delEl) delEl.textContent = deliveryFee ? moneyBRL(deliveryFee) : "R$ 0,00";
  if (delLine) delLine.classList.toggle("hidden", state.checkoutMode !== "delivery");

  if (discLine){
    discLine.classList.toggle("hidden", !couponOk || discount <= 0);
  }
  if (discEl){
    discEl.textContent = couponOk ? `- ${moneyBRL(discount)} (${couponPct}%)` : "-";
  }
  if (totalEl) totalEl.textContent = moneyBRL(total);

  if (warnEl){
    const min = Number(delivery.minOrder || 0);
    if (state.checkoutMode === "delivery" && min > 0 && subtotal < min){
      warnEl.textContent = `Pedido mínimo para entrega: ${moneyBRL(min)} (falta ${moneyBRL(min - subtotal)}).`;
    } else {
      warnEl.textContent = "";
    }
  }

  // Ajusta campo endereço (retirada não exige)
  try{
    const addr = document.getElementById("custAddr");
    if (addr){
      addr.placeholder = (state.checkoutMode === "pickup")
        ? "Observação (opcional)"
        : "Rua, número, bairro...";
    }
  }catch(_){}
}

/* =========================
   Criar pedido no Firestore
   ========================= */

async function createOrder() {
  await ensureAnonAuth();

  // garante uid atual (rules do chat exigem customerUid == request.auth.uid)
  const uid = auth.currentUser?.uid || state.customerUid;
  state.customerUid = uid;

  // ✅ Respeita config: aberto/fechado
  if (state.config && state.isOpen === false) {
    const msg = state.config?.hours?.autoMsg || "Restaurante fechado no momento.";
    alert(msg);
    return;
  }

  // ✅ rules do chat exigem customerUid == request.auth.uid
  if (!state.customerUid) return alert("Falha no login anônimo. Recarregue a página e tente novamente.");

  const name = (document.getElementById("custName").value || "").trim();
  const phone = (document.getElementById("custPhone").value || "").trim();
  const address = (document.getElementById("custAddr").value || "").trim();

  if (state.checkoutMode === "delivery" && !address) return alert("Digite seu endereço.");

  if (!name) return alert("Digite seu nome.");
  if (state.cart.length === 0) return alert("Carrinho vazio.");

  const totalsCalc = computeOrderTotals();
  const { subtotal, qty, deliveryFee, discount, total, couponOk, couponPct, minOk, minOrder } = totalsCalc;

  if (!minOk) {
    alert(`Pedido mínimo para entrega: ${moneyBRL(minOrder)}.`);
    return;
  }

  // ✅ Checkout snapshot (NUNCA pode ter undefined, senão o Firestore recusa)
  const checkout = {
    mode: (state.checkoutMode || "delivery"),
    paymentMethod: (state.paymentMethod || null),
    couponCode: ((state.couponCode || "").trim() || null),
    couponOk: !!couponOk,
    couponPct: Number(couponPct || 0),
    deliveryFee: Number(deliveryFee || 0),
    discount: Number(discount || 0),
    total: Number(total || 0),
    // no modo retirada, usamos o campo "address" como observação opcional
    deliveryAddress: (state.checkoutMode === "delivery" ? (address || "") : null),
    pickupNote: (state.checkoutMode === "pickup" ? (address || "") : null)
  };

  const orderData = {
    status: "recebido",
    createdAt: Firestore.serverTimestamp(),
    updatedAt: Firestore.serverTimestamp(),
    orderNumber: genOrderNumber4(),
    customer: { name, phone, address },
    checkout,
    items: state.cart.map(i => ({
      id: i.id,
      productId: i.productId || i.id,
      name: i.name,
      price: i.price,
      qty: i.qty,
      optionsText: i.optionsText || "",
      meta: i.meta || null
    })),
    totals: { qty, subtotal, deliveryFee, discount, total, couponOk, couponPct, couponCode: (state.couponCode||'').trim(), checkoutMode: state.checkoutMode || 'delivery', paymentMethod: state.paymentMethod || null }
  };

  const ordersRef = Firestore.collection(db, "restaurants", state.restaurant.id, "orders");
  const newDoc = await Firestore.addDoc(ordersRef, orderData);

  state.currentOrderNumber = orderData.orderNumber;

  try { saveLastOrder(newDoc.id, orderData.orderNumber); } catch (_) {}

  // ✅ tracking público PRECISA vir antes do chat (rules do chat usa exists(orders_public/{orderId}))
  let publicOk = false;
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
        checkout: orderData.checkout, // ✅ agora sempre existe e sem undefined
        customerName: orderData.customer?.name || "",
        // ✅ Para o cliente conseguir ver os itens na aba Pedidos
        // (sem precisar de permissão de leitura no /orders)
        items: orderData.items
      },
      { merge: true }
    );
    publicOk = true;
  } catch (e) {
    console.warn("Não foi possível gravar orders_public (rules):", e?.code || e, e?.message || "");
  }

  // Se não conseguiu gravar o público, o chat também vai falhar (rule usa exists()).
  if (!publicOk) {
    throw new Error("Falha ao criar pedido: não consegui gravar orders_public (permissão/dados).");
  }

  // cria/garante chat do pedido (agora o exists() da rule já passa)
  try {
    const chatRef = Firestore.doc(db, "restaurants", state.restaurant.id, "chats", newDoc.id);
    await Firestore.setDoc(
      chatRef,
      {
        customerUid: state.customerUid,
        createdAt: Firestore.serverTimestamp(),
        status: "open",
        updatedAt: Firestore.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("Não foi possível criar chat (rules):", e?.code || e, e?.message || "");
  }

  return newDoc.id;
}

/* =========================
   Tabs + Chat Drawer + Tracking
   ========================= */

function showTab(name){
  const menuView = document.getElementById("menuView");
  const ordersView = document.getElementById("ordersView");
  const cartView = document.getElementById("cartView");
  const profileView = document.getElementById("profileView");
  const pill = document.querySelector(".bottomnav__pill");

  const tabMenu = document.getElementById("tabMenu");
  const tabOrders = document.getElementById("tabOrders");
  const tabCart = document.getElementById("openCartBtn");
  const tabProfile = document.getElementById("tabProfile");

  const safeName = (name === "orders" && !state.currentOrderId) ? "menu" : name;

  const isMenu = safeName === "menu";
  const isOrders = safeName === "orders";
  const isCart = safeName === "cart";
  const isProfile = safeName === "profile";

  menuView?.classList?.toggle("hidden", !isMenu);
  ordersView?.classList?.toggle("hidden", !isOrders);
  cartView?.classList?.toggle("hidden", !isCart);
  profileView?.classList?.toggle("hidden", !isProfile);

  tabMenu?.classList?.toggle("is-active", isMenu);
  tabOrders?.classList?.toggle("is-active", isOrders);
  tabCart?.classList?.toggle("is-active", isCart);
  tabProfile?.classList?.toggle("is-active", isProfile);

  if (pill){
    pill.setAttribute(
      "data-active",
      isProfile ? "profile" : isCart ? "cart" : isOrders ? "orders" : "menu"
    );
  }

  if (isCart) {
    try { renderCartUI(); } catch(_) {}
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

  const codeEl = document.getElementById("orderCode");
  if (codeEl) codeEl.textContent = orderId || "-";
}

function normalizeOrderStatus(raw){
  const s = String(raw || "").toLowerCase();
  if (!s) return "em_preparo";
  if (s === "pronto") return "saiu_pra_entrega";
  if (s.includes("saiu")) return "saiu_pra_entrega";
  if (s.includes("entreg")) return "entregue";
  if (s.includes("preparo") || s.includes("receb")) return "em_preparo";
  if (s.includes("cancel")) return "cancelado";
  return s;
}

function statusLabel(status){
  const s = normalizeOrderStatus(status);
  if (s === "em_preparo") return "Em preparo";
  if (s === "saiu_pra_entrega") return "Saiu pra entrega";
  if (s === "entregue") return "Entregue";
  if (s === "cancelado") return "Cancelado";
  return String(status || "-");
}

function renderStatusTimeline(status){
  const s = normalizeOrderStatus(status);
  const steps = ["em_preparo", "saiu_pra_entrega", "entregue"];
  let idx = steps.indexOf(s);
  if (idx < 0) idx = 0;

  const root = document.getElementById("statusTimeline");
  if (!root) return;

  root.querySelectorAll(".statusStep").forEach((el) => {
    const step = el.getAttribute("data-step");
    const sidx = steps.indexOf(step);
    el.classList.remove("is-done","is-active");
    if (sidx < idx) el.classList.add("is-done");
    if (sidx === idx) el.classList.add("is-active");
  });

  const fill1 = document.getElementById("statusLineFill");
  const fill2 = document.getElementById("statusLineFill2");
  if (fill1) fill1.style.width = (idx >= 1 ? "100%" : "0%");
  if (fill2) fill2.style.width = (idx >= 2 ? "100%" : "0%");
}

function renderOrderItems(items){
  const box = document.getElementById("orderItemsList");
  if (!box) return;
  box.innerHTML = "";

  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0){
    box.innerHTML = `<div class="muted">Itens não disponíveis neste pedido.</div>`;
    return;
  }

  for (const it of arr){
    const name = it?.name || "Item";
    const qty = Number(it?.qty || 0) || 0;
    const price = Number(it?.price || 0) || 0;
    const row = document.createElement("div");
    row.className = "orderItemRow";
    row.innerHTML = `
      <div>
        <strong>${name}</strong>
        <div class="orderItemMeta">${moneyBRL(price)} cada</div>
      </div>
      <div class="orderItemQty">x${qty}</div>
    `;
    box.appendChild(row);
  }
}

function renderOrderTotal(totals){
  const el = document.getElementById("orderTotal");
  if (!el) return;
  const sub = Number(totals?.subtotal ?? totals?.total ?? 0);
  el.textContent = sub ? moneyBRL(sub) : "-";
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

      const friendly = statusLabel(data.status);
      document.getElementById("trackStatus").textContent = friendly;
      renderStatusTimeline(data.status);

      const updated = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
      document.getElementById("trackUpdated").textContent =
        updated ? `Atualizado: ${updated.toLocaleString("pt-BR")}` : "";

      renderOrderTotal(data.totals);
      renderOrderItems(data.items);
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
      // (adicionado) Notificação de nova mensagem (som + badge + popup)
      try {
        // Se o chat estiver aberto, considera como "lido"
        if (isChatDrawerOpen()) {
          // tenta atualizar lastSeen com o último msg do restaurante presente no snapshot
          let lastR = 0;
          snap.forEach((d) => {
            const m2 = d.data() || {};
            if (m2.from !== "customer") {
              const ms = (m2.createdAt && m2.createdAt.toDate) ? m2.createdAt.toDate().getTime() : 0;
              if (ms > lastR) lastR = ms;
            }
          });
          if (lastR) state.chatLastSeenRestaurantMs = lastR;
          setChatUnread(0);
          state.chatInitialized = true;
        } else {
          // Primeira carga não notifica
          if (!state.chatInitialized) {
            let lastR0 = 0;
            snap.forEach((d) => {
              const m2 = d.data() || {};
              if (m2.from !== "customer") {
                const ms = (m2.createdAt && m2.createdAt.toDate) ? m2.createdAt.toDate().getTime() : 0;
                if (ms > lastR0) lastR0 = ms;
              }
            });
            state.chatInitialized = true;
            state.chatLastSeenRestaurantMs = lastR0 || state.chatLastSeenRestaurantMs || 0;
          } else {
            // Mudanças novas
            const changes = (snap.docChanges ? snap.docChanges() : []);
            let newCount = 0;
            let newestMs = state.chatLastSeenRestaurantMs || 0;
            for (const ch of changes) {
              if (ch.type !== "added") continue;
              const m2 = (ch.doc && ch.doc.data) ? (ch.doc.data() || {}) : {};
              if (m2.from === "customer") continue;
              const ms = (m2.createdAt && m2.createdAt.toDate) ? m2.createdAt.toDate().getTime() : Date.now();
              if (ms <= (state.chatLastSeenRestaurantMs || 0)) continue;
              newCount += 1;
              if (ms > newestMs) newestMs = ms;
            }
            if (newCount > 0) {
              state.chatLastSeenRestaurantMs = newestMs;
              setChatUnread((state.chatUnread || 0) + newCount);
              showChatToast("Nova mensagem no chat");
              playChatPing();
            }
          }
        }
      } catch(_) {}
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
    document.getElementById("tabProfile")?.addEventListener("click", () => {
  showTab("profile");
});
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
    resetChatUnread();
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

  // Carrinho (agora é TELA)
  document.getElementById("openCartBtn")?.addEventListener("click", () => showTab("cart"));
  document.getElementById("cartBarBtn")?.addEventListener("click", () => showTab("cart"));
  document.getElementById("closeCartViewBtn")?.addEventListener("click", () => showTab("menu"));

  // Checkout abre
  document.getElementById("checkoutBtn")?.addEventListener("click", () => {
    if (state.cart.length === 0) return alert("Carrinho vazio.");
    openCheckout();
  });

  // Checkout fecha
  document.getElementById("closeCheckoutBtn")?.addEventListener("click", closeCheckout);
  document.getElementById("closeCheckoutBackdrop")?.addEventListener("click", closeCheckout);

  // Modal produto (tamanhos + adicionais)
  document.getElementById("closeProductBtn")?.addEventListener("click", closeProductModal);
  document.getElementById("closeProductBackdrop")?.addEventListener("click", closeProductModal);
  document.getElementById("pmAddCart")?.addEventListener("click", addConfiguredToCart);

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

  // ✅ Se abriu sem slug (PWA start_url), tenta recuperar último slug usado e redirecionar
  if (!state.slug) {
    const lastSlug = loadLastSlug();
    if (lastSlug) {
      // preferir /r/slug (funciona bem com rewrite na Vercel)
      location.replace(`/r/${encodeURIComponent(lastSlug)}`);
      return;
    }
    document.getElementById("title").textContent = "URL inválida. Use /r/slug ou ?slug=slug";
    return;
  }

  // salva slug para o PWA abrir “certo” depois
  saveLastSlug(state.slug);

  state.restaurant = await fetchRestaurantBySlug(state.slug);
  if (!state.restaurant) {
    document.getElementById("title").textContent = "Restaurante não encontrado";
    return;
  }

  // Carregar config/app (salva no painel admin) e aplicar no client
  state.config = await fetchAppConfig(state.restaurant.id);
  applyConfigToClient(state.config);
  // Realtime config: se mudar no admin, atualiza no cliente
  startConfigListener(state.restaurant.id);

  state.products = await fetchProducts(state.restaurant.id);
  buildCategories();

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
   =========================
   ✅ FIX: NÃO registrar 2 service workers, e NÃO usar await solto no final
   - /sw.js com scope "/" já cobre o app (inclusive /client/)
*/
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("SW registrado ✅");
    } catch (e) {
      console.warn("SW falhou:", e);
    }
  });
}
function startPromoListener() {

  const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID, "settings", "promo");

  Firestore.onSnapshot(ref, (snap) => {

    if (!snap.exists()) return;

    const data = snap.data();
    const cupom = data.cupom || "";

    const el = document.getElementById("promoCupom");

    if (el) el.textContent = cupom;

  });

}
// ✅ Mostra no banner o cupom digitado no input "promo"
(function bindPromoToBanner() {
  const input = document.getElementById("promo"); // <-- ID do seu input do cupom
  const bannerText = document.getElementById("promoBannerText");

  if (!input || !bannerText) return;

  const render = () => {
    const code = (input.value || "").trim();
    bannerText.textContent = code ? code : "Promoção relâmpago";
  };

  input.addEventListener("input", render);
  render(); // já atualiza na hora que carrega
})();
let __JPED_PROMO_TICK = null;

function _parsePromoEndsAt(raw){
  const s = String(raw || "").trim();
  if (!s) return null;

  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;

  return null;
}

function _formatCountdown(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function _startPromoCountdown(endsAtMs){
  if (__JPED_PROMO_TICK){
    clearInterval(__JPED_PROMO_TICK);
    __JPED_PROMO_TICK = null;
  }

  const cd = document.getElementById("promoCountdown");
  const banner = document.getElementById("promoBanner");
  if (!cd || !banner || !endsAtMs) return;

  const tick = () => {
    const left = endsAtMs - Date.now();

    if (left <= 0){
      cd.textContent = "Expirado";
      banner.classList.add("hidden");
      clearInterval(__JPED_PROMO_TICK);
      __JPED_PROMO_TICK = null;
      return;
    }

    cd.style.display = "inline-flex";
    cd.textContent = `Expira em ${_formatCountdown(left)}`;
  };

  tick();
  __JPED_PROMO_TICK = setInterval(tick, 1000);
}
const profileBtn = document.getElementById("profileBtn");

if (profileBtn) {
  profileBtn.addEventListener("click", () => {
    openProfile();
  });
}
function openProfile() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;

  modal.classList.remove("hidden");
}

function closeProfile() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;

  modal.classList.add("hidden");
}
lucide.createIcons();
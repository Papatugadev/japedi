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


const MP_FUNCTIONS_BASE_URL = "http://127.0.0.1:5001/japed-e09f2/us-central1";
const MP_PUBLIC_KEY_STORAGE_KEY = "japed:mpPublicKey";

function getMercadoPagoPublicKey(){
  try{
    const fromWindow = String(globalThis.MP_PUBLIC_KEY || "").trim();
    const fromStorage = String(localStorage.getItem(MP_PUBLIC_KEY_STORAGE_KEY) || "").trim();
    const fromConfig = String(state?.config?.payments?.mercadoPagoPublicKey || "").trim();
    const key = fromWindow || fromStorage || fromConfig;
    if (key && fromStorage !== key){
      localStorage.setItem(MP_PUBLIC_KEY_STORAGE_KEY, key);
    }
    return key;
  }catch(_){
    return String(globalThis.MP_PUBLIC_KEY || "").trim();
  }
}


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
  mp: {
    currentOrderId: null,
    currentPaymentId: null,
    currentPaymentStatus: "",
    pixCode: "",
    qrCodeBase64: "",
    cardBrickController: null,
    cardBrickKey: "",
    activeMethod: "",
    lastOrderTotal: 0,
    pixPollTimer: null,
    pixPollBusy: false,
    successOverlayTimer: null
  },

  // (adicionado) Chat unread / notificações
  chatUnread: 0,
  chatInitialized: false,
  chatLastSeenRestaurantMs: 0,
  chatToastTimer: null,
  reviewLocked: false,
reviewStars: 0,
  // entrega dinâmica
  deliveryQuote: {
    status: "idle",
    fee: null,
    distanceKm: null,
    addressKey: "",
    error: ""
  },
  deliveryQuoteCache: new Map()
};

/* =========================
   AUTH ANÔNIMO (cliente)
   ========================= */

let __authReadyResolve;
const authReady = new Promise((res) => { __authReadyResolve = res; });

Auth.onAuthStateChanged(auth, async (user) => {
  try {
    updateProfileUI(user);

    if (!user) {
      await Auth.signInAnonymously(auth);
      return;
    }

    state.customerUid = user.uid;
    __authReadyResolve();
  } catch (e) {
    console.warn("Falha no auth:", e?.code || e, e?.message || "");
    __authReadyResolve();
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
function getReviewStorageKey(orderId){
  return `japed:review:${state.restaurant?.id || state.slug || "unknown"}:${orderId}`;
}

function hasReviewedOrder(orderId){
  if (!orderId) return false;
  try {
    return localStorage.getItem(getReviewStorageKey(orderId)) === "1";
  } catch (_) {
    return false;
  }
}

function markOrderReviewed(orderId){
  if (!orderId) return;
  try {
    localStorage.setItem(getReviewStorageKey(orderId), "1");
  } catch (_) {}
}

function showDeliveryReviewGate(orderId){
  const gate = document.getElementById("deliveryReviewGate");
  if (!gate) return;

  gate.classList.remove("hidden");
  gate.setAttribute("data-order-id", orderId || "");

  const stars = gate.querySelectorAll(".deliveryReviewStar");
  stars.forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.value) <= Number(state.reviewStars || 0));
  });
}


function hideDeliveryReviewGate(){
  const gate = document.getElementById("deliveryReviewGate");
  if (!gate) return;
  gate.classList.add("hidden");
}


function setReviewStars(value){
  state.reviewStars = Number(value || 0);
  const stars = document.querySelectorAll(".deliveryReviewStar");
  stars.forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.value) <= state.reviewStars);
  });
}

async function submitDeliveryReview(){
  const gate = document.getElementById("deliveryReviewGate");
  if (!gate) return;

  const orderId = gate.getAttribute("data-order-id") || state.currentOrderId;
  const comment = (document.getElementById("deliveryReviewText")?.value || "").trim();
  const rating = Number(state.reviewStars || 0);

  if (!orderId) {
    alert("Pedido não encontrado para avaliar.");
    return;
  }

  if (rating < 1) {
    alert("Escolha de 1 a 5 estrelas.");
    return;
  }

  try {
    const reviewRef = Firestore.doc(
      db,
      "restaurants",
      state.restaurant.id,
      "orders_public",
      orderId
    );

    await Firestore.setDoc(reviewRef, {
      deliveryReview: {
        rating,
        comment,
        createdAt: Firestore.serverTimestamp(),
        customerUid: state.customerUid || null
      }
    }, { merge: true });

    markOrderReviewed(orderId);
    hideDeliveryReviewGate();

    const txt = document.getElementById("deliveryReviewText");
    if (txt) txt.value = "";
    setReviewStars(0);

    alert("Avaliação enviada com sucesso.");
  } catch (err) {
    console.error("Erro ao salvar avaliação:", err);
    alert("Não foi possível enviar a avaliação.");
  }
}

function bindDeliveryReviewUI(){
  const stars = document.querySelectorAll(".deliveryReviewStar");
  stars.forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => setReviewStars(Number(btn.dataset.value || 0)));
  });

  const sendBtn = document.getElementById("sendDeliveryReviewBtn");
  if (sendBtn && sendBtn.dataset.bound !== "1") {
    sendBtn.dataset.bound = "1";
    sendBtn.addEventListener("click", submitDeliveryReview);
  }
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

    banner = document.createElement("section");
    banner.id = "promoBanner";
    banner.className = "promoBanner";
    banner.setAttribute("aria-label", "Publicidade");

    banner.innerHTML = `
      <div class="adsenseShell" role="complementary" aria-label="Espaço de publicidade">
        <div class="adsenseLabel">Publicidade</div>
        <div class="adsenseSlot" id="adsenseSlot">
          <div class="adsensePlaceholder">
            <div class="adsenseBadge">AD</div>
            <div class="adsenseText">
              <strong>Espaço reservado para AdSense</strong>
              <span>Insira aqui o bloco oficial do Google AdSense.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    header.insertAdjacentElement("afterend", banner);
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
  state.showImages = (theme.showImages !== true);

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

  // ✅ espaço fixo para AdSense
const banner = _ensurePromoBanner();
if (banner){
  banner.classList.remove("hidden");
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
  try { syncMenuChrome(); } catch(_) {}
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
  if (state.config && state.isOpen === false) {
    const msg = state.config?.hours?.autoMsg || "Restaurante fechado no momento.";
    alert(msg);
    return;
  }

  ensureCheckoutUI();
  fillCheckoutWithProfile(true);
  updateCheckoutUIFromConfig();
  try{ _bindDeliveryAddressEvents(); }catch(_){ }
  renderCheckoutSummary();
  updateCheckoutTotals();
  updateConfirmOrderButton(false);
  showTab("checkout");
  try { window.scrollTo({ top: 0, behavior: "instant" }); } catch(_) { window.scrollTo(0,0); }
}

function closeCheckout() {
  resetMercadoPagoState();
  showTab("cart");
}

function clearCheckoutInputs() {
  document.getElementById("custName").value = "";
  document.getElementById("custPhone").value = "";
  const emailEl = document.getElementById("custEmail");
  if (emailEl) emailEl.value = "";
  document.getElementById("custAddr").value = "";
  const couponInput = document.getElementById("coCouponInput");
  if (couponInput) couponInput.value = "";
  state.couponCode = "";
  updateConfirmOrderButton(false);
}

let __checkoutUIReady = false;

function checkoutItemCountLabel(){
  const qty = state.cart.reduce((acc, i) => acc + Number(i.qty || 0), 0);
  return qty === 1 ? "1 item" : `${qty} itens`;
}

function renderCheckoutSummary(){
  const heroBadge = document.querySelector('.checkoutHero__badge');
  if (heroBadge) heroBadge.textContent = checkoutItemCountLabel();

  let box = document.getElementById('coSummaryBox');
  const stickyBox = document.getElementById('checkoutStickySummary');
  if (!box && !stickyBox) return;

  if (!state.cart.length){
    const empty = `<div class="muted">Seu carrinho está vazio.</div>`;
    if (box) box.innerHTML = empty;
    if (stickyBox) stickyBox.innerHTML = empty;
    return;
  }

  const summaryHtml = state.cart.map(item => `
    <div class="checkoutSummaryItem">
      <div class="checkoutSummaryItem__main">
        <strong>${item.name || 'Produto'}</strong>
        ${item.optionsText ? `<div class="checkoutSummaryItem__meta">${item.optionsText}</div>` : ''}
      </div>
      <div class="checkoutSummaryItem__side">
        <span class="checkoutSummaryItem__qty">x${Number(item.qty || 0)}</span>
        <strong>${moneyBRL(Number(item.price || 0) * Number(item.qty || 0))}</strong>
      </div>
    </div>
  `).join('');

  if (box) box.innerHTML = summaryHtml;
  if (stickyBox) stickyBox.innerHTML = summaryHtml;
}


function updateConfirmOrderButton(isLoading = false){
  const btn = document.getElementById('confirmOrderBtn');
  if (!btn) return;
  btn.disabled = !!isLoading;
  btn.classList.toggle('is-loading', !!isLoading);
  const main = btn.querySelector('.checkoutConfirmBtn__main');
  const sub = btn.querySelector('.checkoutConfirmBtn__sub');

  let idleMain = 'Confirmar pedido';
  let idleSub = 'Revise os dados antes de enviar';

  if (state.paymentMethod === 'pix' && shouldUseInlineMercadoPagoPix()){
    idleMain = state.mp.currentPaymentId ? 'QR PIX gerado' : 'Gerar PIX';
    idleSub = state.mp.currentPaymentId ? 'O QR Code está logo abaixo' : 'Gerar QR Code e código Pix no checkout';
  } else if (state.paymentMethod === 'card' && shouldUseInlineMercadoPagoCard()){
    idleMain = state.mp.currentOrderId ? 'Pagar com cartão' : 'Continuar para cartão';
    idleSub = state.mp.currentOrderId ? 'Preencha os dados do cartão abaixo' : 'Abrir formulário de cartão nesta tela';
  }

  if (main) main.textContent = isLoading ? 'Processando...' : idleMain;
  if (sub) sub.textContent = isLoading ? 'Aguarde, estamos preparando o pagamento' : idleSub;
}

function updateCheckoutAddressTip(){
  const tip = document.getElementById('coAddressTip');
  if (!tip) return;
  tip.textContent = state.checkoutMode === 'pickup'
    ? 'Retirada: use este campo para observações'
    : 'Entrega: rua, número e bairro';
}

function ensureCheckoutUI(){
  if (__checkoutUIReady) return;
  __checkoutUIReady = true;

  const content = document.querySelector("#checkoutView .checkoutContent");
  if (!content) return;
  _bindDeliveryAddressEvents();

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

  // Resumo do pedido
  if (!document.getElementById("coSummaryWrap")){
    const box = document.createElement("section");
    box.id = "coSummaryWrap";
    box.className = "checkoutSection";
    box.innerHTML = `
      <div class="checkoutSection__titleRow">
        <div>
          <div class="coTitle">Resumo do pedido</div>
          <div class="checkoutSection__sub">Confira os itens antes de finalizar.</div>
        </div>
      </div>
      <div id="coSummaryBox" class="checkoutSummaryList"></div>
    `;
    const firstSection = content.querySelector('.checkoutSection');
    if (firstSection) firstSection.insertAdjacentElement("afterend", box);
    else content.appendChild(box);
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
    const footer = document.querySelector("#checkoutView .checkoutFooter");
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
      const dynamicRule = Number(delivery.baseKm || 0) > 0 || Number(delivery.extraPerKm || 0) > 0;
      if (dynamicRule){
        const untilKm = Number(delivery.baseKm || 0);
        const extraKm = Number(delivery.extraPerKm || 0);
        if (fee > 0 && untilKm > 0) parts.push(`${moneyBRL(fee)} até ${untilKm} km`);
        if (extraKm > 0) parts.push(`+ ${moneyBRL(extraKm)}/km excedente`);
      } else if (fee > 0) {
        parts.push(`Taxa: ${moneyBRL(fee)}`);
      }
      if (Number(delivery.maxKm || 0) > 0) parts.push(`Máx.: ${delivery.maxKm} km`);
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

  renderInlinePaymentUI();
  updateConfirmOrderButton(false);

  // Cupom
  const couponBox = document.getElementById("coCouponBox");
  if (couponBox){
    const campaigns = _promoCampaignList();
    const show = campaigns.some((item) => item?.enabled !== false && (_promoCampaignCode(item) || item?.autoApply === true));
    couponBox.classList.toggle("hidden", !show);
    if (!show){
      state.couponCode = "";
      const inp = document.getElementById("coCouponInput");
      if (inp) inp.value = "";
      const msg = document.getElementById("coCouponMsg");
      if (msg) msg.textContent = "";
    } else {
      applyAutoPromoSelection();
    }
  }
}

function _promoCampaignList(){
  const promo = state.config?.promo || {};
  const campaigns = Array.isArray(promo.campaigns) ? promo.campaigns.slice() : [];

  if (promo.enabled && String(promo.couponCode || '').trim()) {
    campaigns.unshift({
      id: 'legacy_coupon',
      enabled: true,
      featured: true,
      title: promo.title || 'Cupom disponível',
      subtitle: promo.subtitle || promo.notice || '',
      couponCode: String(promo.couponCode || '').trim(),
      discountType: 'percent',
      discountPct: Number(promo.couponPct || 0),
      startsAt: promo.startsAt || '',
      endsAt: promo.endsAt || ''
    });
  }

  return campaigns;
}

function _promoCampaignCode(campaign){
  return String(campaign?.couponCode || campaign?.code || campaign?.coupon || '').trim();
}

function _normalizeCampaignDiscountType(campaign){
  const raw = String(campaign?.discountType || campaign?.type || '').trim().toLowerCase();
  if (raw === 'free_delivery' || raw === 'frete_gratis' || raw === 'free-delivery') return 'free_delivery';
  if (raw === 'fixed' || raw === 'valor_fixo' || raw === 'fixed_amount') return 'fixed';
  return 'percent';
}

function _campaignDiscountValue(campaign){
  return Number(campaign?.discountValue ?? campaign?.discountPct ?? campaign?.couponPct ?? campaign?.value ?? 0);
}

function _campaignDateMs(raw){
  const s = String(raw || '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function _profilePromoStats(){
  const profile = loadProfile?.() || {};
  return {
    lastOrderAt: Number(profile.lastOrderAt || 0) || 0,
    orderCount: Number(profile.orderCount || 0) || 0,
    totalSpent: Number(profile.totalSpent || 0) || 0,
    level: String(profile.level || 'Bronze').trim() || 'Bronze'
  };
}

function _campaignCriteriaOk(campaign, subtotal){
  const now = Date.now();
  const startsAt = _campaignDateMs(campaign?.startsAt);
  const endsAt = _campaignDateMs(campaign?.endsAt);
  if (startsAt && now < startsAt) return { ok:false, reason:'Cupom ainda não começou.' };
  if (endsAt && now >= endsAt) return { ok:false, reason:'Cupom expirado.' };
  if (campaign?.enabled === false) return { ok:false, reason:'Cupom desativado.' };

  const minOrder = Number(campaign?.minOrder ?? campaign?.minSubtotal ?? campaign?.minimumOrder ?? 0);
  if (minOrder > 0 && Number(subtotal || 0) < minOrder){
    return { ok:false, reason:`Pedido mínimo de ${moneyBRL(minOrder)}.` };
  }

  const stats = _profilePromoStats();
  const daysInactive = Number(campaign?.daysInactive ?? campaign?.inactiveDays ?? campaign?.daysWithoutOrder ?? 0);
  if (daysInactive > 0){
    if (!stats.lastOrderAt) return { ok:false, reason:`Válido para clientes com ${daysInactive} dias sem pedir.` };
    const diffDays = (Date.now() - stats.lastOrderAt) / 86400000;
    if (diffDays < daysInactive) return { ok:false, reason:`Válido após ${daysInactive} dias sem pedir.` };
  }

  const minOrders = Number(campaign?.minOrders ?? campaign?.minOrderCount ?? 0);
  if (minOrders > 0 && stats.orderCount < minOrders){
    return { ok:false, reason:`Necessário ter pelo menos ${minOrders} pedidos.` };
  }

  const minSpent = Number(campaign?.minSpent ?? campaign?.minTotalSpent ?? 0);
  if (minSpent > 0 && stats.totalSpent < minSpent){
    return { ok:false, reason:`Válido para clientes com gasto mínimo de ${moneyBRL(minSpent)}.` };
  }

  const levelOrder = { bronze:1, prata:2, silver:2, ouro:3, gold:3, diamante:4, diamond:4 };
  const minLevelRaw = String(campaign?.minLevel || campaign?.customerLevel || '').trim().toLowerCase();
  if (minLevelRaw){
    const currentLevel = String(stats.level || 'Bronze').trim().toLowerCase();
    if ((levelOrder[currentLevel] || 0) < (levelOrder[minLevelRaw] || 0)){
      return { ok:false, reason:`Disponível a partir do nível ${campaign?.minLevel || campaign?.customerLevel}.` };
    }
  }

  return { ok:true, reason:'' };
}

function evaluatePromoEngine(){
  const campaigns = _promoCampaignList().map((campaign, index) => {
    const normalized = { ...campaign };
    normalized._idx = index;
    normalized._code = _promoCampaignCode(normalized);
    normalized._type = _normalizeCampaignDiscountType(normalized);
    normalized._value = _campaignDiscountValue(normalized);
    normalized._criteria = _campaignCriteriaOk(normalized, cartTotals().subtotal);
    normalized._criteriaReason = normalized._criteria.reason || '';
    normalized._displayText = normalized._type === 'free_delivery'
      ? 'frete grátis'
      : normalized._type === 'fixed'
        ? `${moneyBRL(normalized._value)} OFF`
        : `${Number(normalized._value || 0)}% OFF`;
    return normalized;
  });

  const code = String(state.couponCode || '').trim().toLowerCase();
  const manualMatch = code
    ? campaigns.find((item) => item._code && item._code.toLowerCase() === code && item._criteria.ok)
    : null;

  const autoMatch = campaigns.find((item) => item._criteria.ok && item.autoApply === true && (!item._code || item._code.toLowerCase() === code || !code)) || null;
  const featured = campaigns.find((item) => item._criteria.ok && (item.featured === true || item.highlight === true)) || campaigns.find((item) => item._criteria.ok && !!item._code) || null;

  return { campaigns, manualMatch, autoMatch, featured };
}

function applyAutoPromoSelection(){
  const evaluation = evaluatePromoEngine();
  const input = document.getElementById('coCouponInput');
  if (state.couponCode) return evaluation;
  if (evaluation.autoMatch?._code){
    state.couponCode = evaluation.autoMatch._code;
    if (input) input.value = evaluation.autoMatch._code;
  }
  return evaluation;
}

function validateCouponAndUpdateUI(showAlerts){
  const msg = document.getElementById("coCouponMsg");
  const code = (state.couponCode || "").trim();
  const evaluation = evaluatePromoEngine();
  const manual = evaluation.manualMatch;
  const auto = evaluation.autoMatch;
  const featured = evaluation.featured;

  if (msg){
    if (!code){
      if (auto?._code){
        msg.textContent = `Promoção automática ativa: ${auto.title || auto._code} • ${auto._displayText || 'benefício aplicado'} ✅`;
      } else if (featured?._displayText) {
        msg.textContent = featured._code
          ? `${featured.title || featured._code} • ${featured._displayText}`
          : `Promoção ativa • ${featured._displayText}`;
      } else {
        msg.textContent = "";
      }
    } else if (manual){
      msg.textContent = `Cupom aplicado: ${manual.title || manual._code} • ${manual._displayText || 'benefício liberado'} ✅`;
    } else {
      const candidate = evaluation.campaigns.find((item) => item._code && item._code.toLowerCase() === code.toLowerCase());
      msg.textContent = candidate?._criteriaReason ? `${candidate._criteriaReason} ❌` : "Cupom inválido ❌";
    }
  }

  if (showAlerts && code && !manual) {
    const candidate = evaluation.campaigns.find((item) => item._code && item._code.toLowerCase() === code.toLowerCase());
    alert(candidate?._criteriaReason || "Cupom inválido.");
  }

  updateCheckoutTotals();
}

function _normalizeAddressForQuote(raw){
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\n\r]+/g, ", ");
}

function _hasDynamicDeliveryConfig(cfg){
  const d = cfg?.delivery || {};
  const g = d.geoapify || {};
  return !!(String(g.apiKey || "").trim() && Number.isFinite(Number(g.storeLat)) && Number.isFinite(Number(g.storeLng)));
}

function _calcDeliveryFeeByDistance(distanceKm, delivery){
  const baseFee = Number(delivery?.fee || 0);
  const baseKm = Math.max(0, Number(delivery?.baseKm || 0));
  const extraPerKm = Math.max(0, Number(delivery?.extraPerKm || 0));
  const km = Math.max(0, Number(distanceKm || 0));

  if (km <= baseKm) return Math.round(baseFee * 100) / 100;
  const extraKm = km - baseKm;
  return Math.round((baseFee + (extraKm * extraPerKm)) * 100) / 100;
}

function _setDeliveryQuoteState(patch){
  state.deliveryQuote = Object.assign({}, state.deliveryQuote || {}, patch || {});
}

async function _geoapifyGeocodeAddress(apiKey, address){
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&format=json&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
  const data = await res.json();
  const row = data?.results?.[0];
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Endereço não encontrado.");
  return { lat, lng: lon };
}

async function _geoapifyRouteKm(apiKey, storeLat, storeLng, destLat, destLng){
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(`${storeLat},${storeLng}|${destLat},${destLng}`)}&mode=drive&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing HTTP ${res.status}`);
  const data = await res.json();
  const meters = Number(data?.features?.[0]?.properties?.distance);
  if (!Number.isFinite(meters)) throw new Error("Não foi possível calcular a rota.");
  return meters / 1000;
}

async function ensureDeliveryQuote(force = false){
  const cfg = state.config || {};
  const delivery = cfg.delivery || {};
  const dynamic = _hasDynamicDeliveryConfig(cfg);
  const addressEl = document.getElementById("custAddr");
  const rawAddress = String(addressEl?.value || "").trim();
  const addressKey = _normalizeAddressForQuote(rawAddress);

  if (state.checkoutMode !== "delivery"){
    _setDeliveryQuoteState({ status: "idle", fee: 0, distanceKm: null, addressKey: "", error: "" });
    return state.deliveryQuote;
  }

  if (!dynamic){
    _setDeliveryQuoteState({ status: "fixed", fee: Number(delivery.fee || 0), distanceKm: null, addressKey, error: "" });
    return state.deliveryQuote;
  }

  if (!addressKey){
    _setDeliveryQuoteState({ status: "idle", fee: null, distanceKm: null, addressKey: "", error: "" });
    return state.deliveryQuote;
  }

  if (!force && state.deliveryQuote?.status === "ready" && state.deliveryQuote?.addressKey === addressKey){
    return state.deliveryQuote;
  }

  if (!force && state.deliveryQuoteCache.has(addressKey)){
    const cached = state.deliveryQuoteCache.get(addressKey);
    _setDeliveryQuoteState(Object.assign({}, cached, { addressKey }));
    return state.deliveryQuote;
  }

  if (state.deliveryQuote?.status === "loading" && state.deliveryQuote?.addressKey === addressKey && !force){
    return state.deliveryQuote;
  }

  _setDeliveryQuoteState({ status: "loading", fee: null, distanceKm: null, addressKey, error: "" });
  updateCheckoutTotals();

  try{
    const apiKey = String(delivery?.geoapify?.apiKey || "").trim();
    const storeLat = Number(delivery?.geoapify?.storeLat);
    const storeLng = Number(delivery?.geoapify?.storeLng);

    const dest = await _geoapifyGeocodeAddress(apiKey, rawAddress);
    const distanceKm = await _geoapifyRouteKm(apiKey, storeLat, storeLng, dest.lat, dest.lng);

    const maxKm = Number(delivery.maxKm || 0);
    if (maxKm > 0 && distanceKm > maxKm){
      const blocked = {
        status: "out_of_range",
        fee: null,
        distanceKm,
        addressKey,
        error: `Endereço fora da área de entrega. Máximo: ${maxKm} km.`
      };
      state.deliveryQuoteCache.set(addressKey, blocked);
      _setDeliveryQuoteState(blocked);
      updateCheckoutTotals();
      return state.deliveryQuote;
    }

    const fee = _calcDeliveryFeeByDistance(distanceKm, delivery);
    const ready = { status: "ready", fee, distanceKm, addressKey, error: "" };
    state.deliveryQuoteCache.set(addressKey, ready);
    _setDeliveryQuoteState(ready);
    updateCheckoutTotals();
    return state.deliveryQuote;
  }catch(e){
    console.warn("Falha no cálculo da entrega:", e?.message || e);
    _setDeliveryQuoteState({
      status: "error",
      fee: null,
      distanceKm: null,
      addressKey,
      error: "Falha no cálculo da entrega."
    });
    updateCheckoutTotals();
    return state.deliveryQuote;
  }
}

function _scheduleDeliveryQuoteFromAddress(){
  try{
    clearTimeout(window.__JPED_DELIVERY_DEBOUNCE__);
  }catch(_){}
  window.__JPED_DELIVERY_DEBOUNCE__ = setTimeout(() => {
    ensureDeliveryQuote(false);
  }, 350);
}

function _bindDeliveryAddressEvents(){
  const addr = document.getElementById("custAddr");
  if (!addr || addr.dataset.geoBound === "1") return;
  addr.dataset.geoBound = "1";

  addr.addEventListener("blur", () => {
    _scheduleDeliveryQuoteFromAddress();
  });
  addr.addEventListener("change", () => {
    _scheduleDeliveryQuoteFromAddress();
  });
  addr.addEventListener("input", () => {
    const key = _normalizeAddressForQuote(addr.value);
    if (key !== (state.deliveryQuote?.addressKey || "")){
      _setDeliveryQuoteState({ status: "idle", fee: null, distanceKm: null, addressKey: "", error: "" });
    }
  });
}

function computeOrderTotals(){
  const cfg = state.config || {};
  const delivery = cfg.delivery || {};

  const { subtotal, qty } = cartTotals();

  let deliveryFee = 0;
  if (state.checkoutMode === "delivery"){
    if (_hasDynamicDeliveryConfig(cfg)){
      deliveryFee = Number(state.deliveryQuote?.fee || 0);
    } else {
      deliveryFee = Number(delivery.fee || 0);
    }
  }

  let discount = 0;
  let couponOk = false;
  let couponPct = 0;
  let appliedCampaign = null;
  const evaluation = evaluatePromoEngine();
  const code = String(state.couponCode || '').trim();

  if (evaluation.manualMatch){
    appliedCampaign = evaluation.manualMatch;
    couponOk = true;
  } else if ((!code || (evaluation.autoMatch?._code && code.toLowerCase() === evaluation.autoMatch._code.toLowerCase())) && evaluation.autoMatch){
    appliedCampaign = evaluation.autoMatch;
    couponOk = true;
  }

  if (appliedCampaign){
    const type = _normalizeCampaignDiscountType(appliedCampaign);
    const rawValue = _campaignDiscountValue(appliedCampaign);
    if (type === 'free_delivery'){
      discount = Math.max(0, deliveryFee);
      couponPct = 0;
    } else if (type === 'fixed'){
      discount = Math.max(0, Math.min(subtotal + deliveryFee, rawValue));
      couponPct = 0;
    } else {
      couponPct = Math.max(0, rawValue);
      discount = Math.round((subtotal * (couponPct / 100)) * 100) / 100;
    }
  }

  const total = Math.max(0, (subtotal + deliveryFee) - discount);
  const minOrder = Number(delivery.minOrder || 0);
  const minOk = !(state.checkoutMode === "delivery" && minOrder > 0 && subtotal < minOrder);

  return {
    qty,
    subtotal,
    deliveryFee,
    discount,
    total,
    couponOk,
    couponPct,
    appliedCampaign,
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

  const stickyTotals = document.getElementById("checkoutStickyTotals");
  if (stickyTotals){
    stickyTotals.innerHTML = `
      <div class="drawer__totals"><span class="muted">Subtotal</span><strong>${moneyBRL(subtotal)}</strong></div>
      ${state.checkoutMode === "delivery" ? `<div class="drawer__totals"><span class="muted">Entrega</span><strong>${deliveryFee ? moneyBRL(deliveryFee) : "R$ 0,00"}</strong></div>` : ""}
      ${(couponOk && discount > 0) ? `<div class="drawer__totals"><span class="muted">Desconto</span><strong>- ${moneyBRL(discount)} (${couponPct}%)</strong></div>` : ""}
      <div class="drawer__totals total"><span>Total</span><strong>${moneyBRL(total)}</strong></div>
    `;
  }

  if (warnEl){
    const min = Number(delivery.minOrder || 0);
    const quote = state.deliveryQuote || {};
    if (state.checkoutMode === "delivery" && quote.status === "loading"){
      warnEl.textContent = "Calculando taxa de entrega...";
    } else if (state.checkoutMode === "delivery" && quote.status === "out_of_range"){
      warnEl.textContent = quote.error || "Endereço fora da área de entrega.";
    } else if (state.checkoutMode === "delivery" && quote.status === "error"){
      warnEl.textContent = quote.error || "Falha no cálculo da entrega.";
    } else if (state.checkoutMode === "delivery" && Number.isFinite(Number(quote.distanceKm))){
      warnEl.textContent = `Distância calculada: ${Number(quote.distanceKm).toFixed(2)} km.`;
      if (min > 0 && subtotal < min){
        warnEl.textContent += ` Pedido mínimo: ${moneyBRL(min)} (falta ${moneyBRL(min - subtotal)}).`;
      }
    } else if (state.checkoutMode === "delivery" && min > 0 && subtotal < min){
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

  updateCheckoutAddressTip();
  renderCheckoutSummary();
}

/* =========================
   Criar pedido no Firestore
   ========================= */

async function createOrder(options = {}) {
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

  saveCheckoutFieldsToProfile();

  const name = (document.getElementById("custName").value || "").trim();
  const phone = (document.getElementById("custPhone").value || "").trim();
  const email = (document.getElementById("custEmail")?.value || "").trim();
  const address = (document.getElementById("custAddr").value || "").trim();

  if (state.checkoutMode === "delivery" && !address) return alert("Digite seu endereço.");

  if (!name) return alert("Digite seu nome.");
  if (state.cart.length === 0) return alert("Carrinho vazio.");

  if (state.checkoutMode === "delivery" && _hasDynamicDeliveryConfig(state.config || {})) {
    const quote = await ensureDeliveryQuote(true);
    if (quote.status === "out_of_range") return alert(quote.error || "Endereço fora da área de entrega.");
    if (quote.status === "error") return alert(quote.error || "Falha no cálculo da entrega.");
    if (quote.status !== "ready") return alert("Não foi possível calcular a taxa de entrega.");
  }

  const totalsCalc = computeOrderTotals();
  const { subtotal, qty, deliveryFee, discount, total, couponOk, couponPct, appliedCampaign, minOk, minOrder } = totalsCalc;

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
    couponCampaignId: (appliedCampaign?.id || appliedCampaign?._code || null),
    couponCampaignTitle: (appliedCampaign?.title || null),
    deliveryFee: Number(deliveryFee || 0),
    deliveryDistanceKm: Number(state.deliveryQuote?.distanceKm || 0),
    discount: Number(discount || 0),
    total: Number(total || 0),
    // no modo retirada, usamos o campo "address" como observação opcional
    deliveryAddress: (state.checkoutMode === "delivery" ? (address || "") : null),
    pickupNote: (state.checkoutMode === "pickup" ? (address || "") : null)
  };

  const initialStatus = (options?.status || "recebido");

  const orderData = {
    status: initialStatus,
    createdAt: Firestore.serverTimestamp(),
    updatedAt: Firestore.serverTimestamp(),
    orderNumber: genOrderNumber4(),
    customerUid: state.customerUid || null,
    customer: { name, phone, email, address },
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
    totals: { qty, subtotal, deliveryFee, deliveryDistanceKm: Number(state.deliveryQuote?.distanceKm || 0), discount, total, couponOk, couponPct, couponCode: (state.couponCode||'').trim(), couponCampaignId: (appliedCampaign?.id || appliedCampaign?._code || null), couponCampaignTitle: (appliedCampaign?.title || null), checkoutMode: state.checkoutMode || 'delivery', paymentMethod: state.paymentMethod || null }
  };

  const ordersRef = Firestore.collection(db, "restaurants", state.restaurant.id, "orders");
  const newDoc = await Firestore.addDoc(ordersRef, orderData);

  state.currentOrderNumber = orderData.orderNumber;

  try { saveLastOrder(newDoc.id, orderData.orderNumber); } catch (_) {}
  try {
    const currentProfile = loadProfile();
    saveProfile({
      ...currentProfile,
      lastOrderAt: Date.now(),
      orderCount: Number(currentProfile.orderCount || 0) + 1,
      totalSpent: Number(currentProfile.totalSpent || 0) + Number(total || 0)
    });
  } catch(_) {}

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
    customerUid: state.customerUid || null,
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


function resetMercadoPagoState(options = {}){
  stopPixAutoPolling();
  const keepOrder = !!options.keepOrder;
  const img = document.getElementById("mpPixQrImage");
  const code = document.getElementById("mpPixCode");
  const status = document.getElementById("mpPixStatus");
  const cardMsg = document.getElementById("mpCardMsg");
  const hint = document.getElementById("mpPaymentHint");

  if (img) { img.src = ""; img.classList.add("hidden"); }
  if (code) code.value = "";
  if (status) status.textContent = "";
  if (cardMsg) cardMsg.textContent = "";
  if (hint) hint.textContent = "";

  if (state.mp.cardBrickController?.unmount) {
    try { state.mp.cardBrickController.unmount(); } catch(_) {}
  }

  state.mp.cardBrickController = null;
  state.mp.cardBrickKey = "";
  state.mp.currentPaymentId = null;
  state.mp.currentPaymentStatus = "";
  state.mp.pixCode = "";
  state.mp.qrCodeBase64 = "";
  state.mp.activeMethod = state.paymentMethod || "";
  if (!keepOrder) {
    state.mp.currentOrderId = null;
    state.mp.lastOrderTotal = 0;
  }
  renderInlinePaymentUI();
}

function shouldUseInlineMercadoPagoPix(){
  return state.paymentMethod === "pix";
}

function shouldUseInlineMercadoPagoCard(){
  return state.paymentMethod === "card" && !!getMercadoPagoPublicKey() && typeof window.MercadoPago === "function";
}

function normalizeMercadoPagoEmail(value){
  const email = String(value || "").trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  return emailOk ? email : "";
}

function getCheckoutCustomerEmail(){
  const raw = normalizeMercadoPagoEmail(document.getElementById("custEmail")?.value || "");
  if (raw) return raw;
  const profileEmail = normalizeMercadoPagoEmail(loadProfile()?.email || "");
  if (profileEmail) return profileEmail;
  const uid = String(auth.currentUser?.uid || state.customerUid || Date.now()).replace(/[^a-zA-Z0-9]/g, "") || Date.now();
  return `cliente.${uid}@example.com`;
}

async function updateOrderPaymentState(orderId, patch = {}){
  if (!orderId || !state.restaurant?.id) return;
  const orderRef = Firestore.doc(db, "restaurants", state.restaurant.id, "orders", orderId);
  const publicRef = Firestore.doc(db, "restaurants", state.restaurant.id, "orders_public", orderId);
  const safePatch = {
    ...patch,
    updatedAt: Firestore.serverTimestamp()
  };
  try { await Firestore.setDoc(orderRef, safePatch, { merge: true }); } catch(e){ console.warn("Falha ao atualizar order:", e?.message || e); }
  try { await Firestore.setDoc(publicRef, safePatch, { merge: true }); } catch(e){ console.warn("Falha ao atualizar orders_public:", e?.message || e); }
}

function stopPixAutoPolling(){
  if (state.mp.pixPollTimer){
    clearInterval(state.mp.pixPollTimer);
    state.mp.pixPollTimer = null;
  }
  state.mp.pixPollBusy = false;
}

function showPaymentSuccessOverlay(message = "Pagamento efetuado com sucesso!"){
  const existing = document.getElementById("paymentSuccessOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "paymentSuccessOverlay";
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:99999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:20px",
    "background:rgba(0,0,0,.55)"
  ].join(";");

  overlay.innerHTML = `
    <div style="width:min(420px,100%);background:#111827;border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:28px 22px;box-shadow:0 30px 80px rgba(0,0,0,.45);text-align:center;color:#fff;">
      <div style="width:78px;height:78px;border-radius:999px;margin:0 auto 16px;background:linear-gradient(135deg,#16a34a,#22c55e);display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:900;">✓</div>
      <div style="font-size:24px;font-weight:800;line-height:1.1;">Pagamento aprovado</div>
      <div style="margin-top:10px;font-size:15px;line-height:1.5;color:rgba(255,255,255,.78);">${message}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  if (state.mp.successOverlayTimer) clearTimeout(state.mp.successOverlayTimer);
  state.mp.successOverlayTimer = setTimeout(() => {
    overlay.remove();
    state.mp.successOverlayTimer = null;
  }, 2200);
}

function startPixAutoPolling(){
  stopPixAutoPolling();
  if (!state.mp.currentPaymentId || !state.mp.currentOrderId) return;

  state.mp.pixPollTimer = setInterval(async () => {
    if (state.mp.pixPollBusy || !state.mp.currentPaymentId || !state.mp.currentOrderId) return;
    state.mp.pixPollBusy = true;
    try {
      await checkInlinePixPaymentStatus({ silent: true, auto: true });
    } catch (err) {
      console.warn("Falha ao verificar PIX automaticamente:", err?.message || err);
    } finally {
      state.mp.pixPollBusy = false;
    }
  }, 4000);
}

function finishOrderFlow(orderId){
  stopPixAutoPolling();
  state.cart = [];
  renderCartUI();

  closeCheckout();
  clearCheckoutInputs();

  state.currentOrderId = orderId;
  setOrdersUI(true);
  openTrackScreen(orderId);
  startTrackingOrder(orderId);
}

function renderInlinePaymentUI(){
  const wrap = document.getElementById("mpInlinePaymentBox");
  const pixBox = document.getElementById("mpPixBox");
  const cardBox = document.getElementById("mpCardBox");
  const hint = document.getElementById("mpPaymentHint");
  const cardMsg = document.getElementById("mpCardMsg");
  if (!wrap || !pixBox || !cardBox) return;

  const usePix = shouldUseInlineMercadoPagoPix();
  const useCard = state.paymentMethod === "card";

  wrap.classList.toggle("hidden", !(usePix || useCard));
  pixBox.classList.toggle("hidden", !usePix);
  cardBox.classList.toggle("hidden", !useCard);

  if (hint){
    if (usePix){
      hint.textContent = state.mp.currentPaymentId
        ? "Use o QR Code ou o código Pix abaixo. O checkout verifica o pagamento automaticamente."
        : "Ao confirmar, o app gera o QR Code Pix aqui mesmo no checkout e acompanha o pagamento automaticamente.";
    } else if (useCard){
      hint.textContent = shouldUseInlineMercadoPagoCard()
        ? (state.mp.currentOrderId ? "Preencha o cartão abaixo para pagar sem sair do app." : "Ao confirmar, o formulário de cartão aparece aqui nesta tela.")
        : "Para usar cartão integrado nesta tela, adicione sua Public Key do Mercado Pago no app.";
    } else {
      hint.textContent = "";
    }
  }

  if (cardMsg && useCard && !shouldUseInlineMercadoPagoCard()){
    cardMsg.textContent = "Cartão embutido indisponível: falta configurar a Public Key do Mercado Pago.";
  } else if (cardMsg && !state.mp.currentOrderId){
    cardMsg.textContent = "";
  }
}

async function createInlinePixPayment(orderId, total){
  const response = await fetch(`${MP_FUNCTIONS_BASE_URL}/createMercadoPagoPixPayment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId: state.restaurant?.id || "",
      orderId,
      amount: Number(total || 0),
      description: `Pedido ${state.currentOrderNumber || orderId}`,
      payer: {
        email: getCheckoutCustomerEmail(),
        first_name: (document.getElementById("custName")?.value || "Cliente").trim(),
      }
    })
  });

  const data = await response.json();
  if (!response.ok || !data?.paymentId) {
    throw new Error(data?.error || "Não foi possível gerar o PIX.");
  }

  state.mp.currentPaymentId = data.paymentId;
  state.mp.currentPaymentStatus = data.status || "pending";
  state.mp.pixCode = data.qrCode || "";
  state.mp.qrCodeBase64 = data.qrCodeBase64 || "";

  const img = document.getElementById("mpPixQrImage");
  const code = document.getElementById("mpPixCode");
  const status = document.getElementById("mpPixStatus");

  if (img && data.qrCodeBase64){
    img.src = `data:image/png;base64,${data.qrCodeBase64}`;
    img.classList.remove("hidden");
  }
  if (code) code.value = data.qrCode || "";
  if (status) status.textContent = "PIX gerado. Aguardando pagamento...";

  await updateOrderPaymentState(orderId, {
    status: "aguardando_pagamento",
    paymentStatus: data.status || "pending",
    mpPaymentId: data.paymentId,
    mpPaymentMethod: "pix"
  });

  updateConfirmOrderButton(false);
  renderInlinePaymentUI();
  startPixAutoPolling();
}

async function checkInlinePixPaymentStatus(options = {}){
  if (!state.mp.currentPaymentId || !state.mp.currentOrderId) return;
  const { silent = false, auto = false } = options;
  const statusEl = document.getElementById("mpPixStatus");
  if (!silent && statusEl) statusEl.textContent = auto ? "Confirmando pagamento..." : "Verificando pagamento...";

  const response = await fetch(`${MP_FUNCTIONS_BASE_URL}/getMercadoPagoPaymentStatus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId: state.restaurant?.id || "",
      orderId: state.mp.currentOrderId,
      paymentId: state.mp.currentPaymentId
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Falha ao consultar pagamento.");

  state.mp.currentPaymentStatus = data.status || "";
  if (data.status === "approved"){
    await updateOrderPaymentState(state.mp.currentOrderId, {
      status: "recebido",
      paymentStatus: "approved",
      mpPaymentId: state.mp.currentPaymentId,
      mpPaymentMethod: "pix"
    });
    if (statusEl) statusEl.textContent = "Pagamento aprovado ✅";
    const orderId = state.mp.currentOrderId;
    stopPixAutoPolling();
    showPaymentSuccessOverlay("Pagamento efetuado com sucesso! Fechando o checkout...");
    setTimeout(() => {
      resetMercadoPagoState();
      finishOrderFlow(orderId);
    }, 1400);
    return;
  }

  if (statusEl && !silent) {
    statusEl.textContent = data.status === "pending"
      ? "Pagamento ainda pendente. Assim que cair, o checkout fecha sozinho."
      : `Status atual: ${data.status || "desconhecido"}`;
  }
}

async function ensureInlineCardBrick(orderId, total){
  if (!shouldUseInlineMercadoPagoCard()) {
    renderInlinePaymentUI();
    throw new Error("Public Key do Mercado Pago não configurada para cartão embutido.");
  }

  const publicKey = getMercadoPagoPublicKey();
  const brickKey = `${orderId}:${Number(total || 0).toFixed(2)}`;

  if (state.mp.cardBrickKey === brickKey && state.mp.cardBrickController) {
    renderInlinePaymentUI();
    return;
  }

  if (state.mp.cardBrickController?.unmount) {
    try { state.mp.cardBrickController.unmount(); } catch(_) {}
  }

  const cardMsg = document.getElementById("mpCardMsg");
  if (cardMsg) cardMsg.textContent = "Carregando formulário do cartão...";

  const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
  const bricksBuilder = mp.bricks();

  state.mp.cardBrickController = await bricksBuilder.create("cardPayment", "mpCardBrickContainer", {
    initialization: {
      amount: Number(total || 0)
    },
    customization: {
      visual: { style: { theme: "default" } }
    },
    callbacks: {
      onReady: () => {
        if (cardMsg) cardMsg.textContent = "Preencha os dados do cartão para concluir.";
      },
      onSubmit: async (cardFormData) => {
        if (cardMsg) cardMsg.textContent = "Processando cartão...";
        const response = await fetch(`${MP_FUNCTIONS_BASE_URL}/createMercadoPagoCardPayment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            restaurantId: state.restaurant?.id || "",
            orderId,
            transaction_amount: Number(total || 0),
            description: `Pedido ${state.currentOrderNumber || orderId}`,
            payer: {
              email: getCheckoutCustomerEmail(),
              first_name: (document.getElementById("custName")?.value || "Cliente").trim(),
              identification: cardFormData?.payer?.identification || null
            },
            formData: cardFormData
          })
        });

        const data = await response.json();

        if (!response.ok) {
          if (cardMsg) cardMsg.textContent = data?.error || "Falha no pagamento com cartão.";
          throw new Error(data?.error || "Falha no pagamento com cartão.");
        }

        state.mp.currentPaymentId = data.paymentId || null;
        state.mp.currentPaymentStatus = data.status || "";

        if (data.status === "approved"){
          await updateOrderPaymentState(orderId, {
            status: "recebido",
            paymentStatus: "approved",
            mpPaymentId: data.paymentId || null,
            mpPaymentMethod: "card"
          });
          if (cardMsg) cardMsg.textContent = "Pagamento aprovado ✅";
          resetMercadoPagoState();
          finishOrderFlow(orderId);
          return;
        }

        await updateOrderPaymentState(orderId, {
          status: "aguardando_pagamento",
          paymentStatus: data.status || "pending",
          mpPaymentId: data.paymentId || null,
          mpPaymentMethod: "card"
        });

        if (cardMsg) cardMsg.textContent = `Status do pagamento: ${data.status || "pendente"}`;
      },
      onError: (error) => {
        console.error("Card Brick error:", error);
        if (cardMsg) cardMsg.textContent = "Falha ao carregar o cartão. Confira a Public Key e os dados do comprador.";
      }
    }
  });

  state.mp.cardBrickKey = brickKey;
  renderInlinePaymentUI();
}

async function startInlineMercadoPagoFlow(){
  const totalsCalc = computeOrderTotals();
  const total = Number(totalsCalc?.total || 0);

  if (!state.mp.currentOrderId){
    state.mp.currentOrderId = await createOrder({ status: "aguardando_pagamento" });
    state.mp.lastOrderTotal = total;
  }

  if (!state.mp.currentOrderId) return;

  renderInlinePaymentUI();

  if (state.paymentMethod === "pix"){
    if (!state.mp.currentPaymentId){
      await createInlinePixPayment(state.mp.currentOrderId, total);
    }
    return;
  }

  if (state.paymentMethod === "card"){
    await ensureInlineCardBrick(state.mp.currentOrderId, total);
  }
}


/* =========================
   Tabs + Chat Drawer + Tracking
   ========================= */

function showTab(name){
  const menuView = document.getElementById("menuView");
  const ordersView = document.getElementById("ordersView");
  const cartView = document.getElementById("cartView");
  const profileView = document.getElementById("profileView");
  const checkoutView = document.getElementById("checkoutView");
  const pill = document.querySelector(".bottomnav__pill");
  const bottomnav = document.querySelector(".bottomnav");

  const tabMenu = document.getElementById("tabMenu");
  const tabOrders = document.getElementById("tabOrders");
  const tabCart = document.getElementById("openCartBtn");
  const tabProfile = document.getElementById("tabProfile");

  const safeName = (name === "orders" && !state.currentOrderId) ? "menu" : name;

  const isMenu = safeName === "menu";
  const isOrders = safeName === "orders";
  const isCart = safeName === "cart";
  const isProfile = safeName === "profile";
  const isCheckout = safeName === "checkout";

  menuView?.classList?.toggle("hidden", !isMenu);
  ordersView?.classList?.toggle("hidden", !isOrders);
  cartView?.classList?.toggle("hidden", !isCart);
  profileView?.classList?.toggle("hidden", !isProfile);
  checkoutView?.classList?.toggle("hidden", !isCheckout);

  tabMenu?.classList?.toggle("is-active", isMenu);
  tabOrders?.classList?.toggle("is-active", isOrders);
  tabCart?.classList?.toggle("is-active", isCart || isCheckout);
  tabProfile?.classList?.toggle("is-active", isProfile);

  if (pill){
    pill.setAttribute(
      "data-active",
      isProfile ? "profile" : (isCart || isCheckout) ? "cart" : isOrders ? "orders" : "menu"
    );
  }

  if (bottomnav){
    bottomnav.classList.toggle("hidden", isCheckout);
  }

  syncMenuChrome();

  const cartBar = document.getElementById("cartBar");
  const hasItems = state.cart && state.cart.length > 0;
  if (cartBar){
    cartBar.classList.toggle("hidden", !isMenu || !hasItems);
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

  const courier = document.getElementById("trackCourier");
  if (courier) {
    courier.classList.remove("trackCourier--preparo","trackCourier--saiu","trackCourier--entregue","trackCourier--cancelado");
    if (s === "entregue") courier.classList.add("trackCourier--entregue");
    else if (s === "saiu_pra_entrega") courier.classList.add("trackCourier--saiu");
    else if (s === "cancelado") courier.classList.add("trackCourier--cancelado");
    else courier.classList.add("trackCourier--preparo");
  }

  const pctEl = document.getElementById("trackPercent");
  const txtEl = document.getElementById("trackProgressText");
  const barEl = document.getElementById("trackProgressBarFill");
  const statusPill = document.getElementById("trackStatusPill");

  let percent = 10;
  let text = "Estamos iniciando seu pedido";

  if (s === "em_preparo") {
    percent = 38;
    text = "Seu pedido está sendo preparado agora";
  } else if (s === "saiu_pra_entrega") {
    percent = 76;
    text = "Seu pedido saiu e está a caminho";
  } else if (s === "entregue") {
    percent = 100;
    text = "Pedido entregue com sucesso";
  } else if (s === "cancelado") {
    percent = 100;
    text = "Este pedido foi cancelado";
  }

  if (pctEl) pctEl.textContent = `${percent}%`;
  if (txtEl) txtEl.textContent = text;
  if (barEl) barEl.style.width = `${percent}%`;
  if (statusPill) statusPill.classList.toggle("is-cancelled", s === "cancelado");
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

  const subtotal = Number(totals?.subtotal ?? 0) || 0;
  const deliveryFee = Number(totals?.deliveryFee ?? 0) || 0;
  const discount = Number(totals?.discount ?? 0) || 0;
  const total = Number(totals?.total ?? subtotal ?? 0) || 0;

  el.textContent = total ? moneyBRL(total) : "-";

  const wrap = document.getElementById("orderTotalBreakdown");
  const subEl = document.getElementById("orderSubtotalMini");
  const delEl = document.getElementById("orderDeliveryMini");
  const discEl = document.getElementById("orderDiscountMini");

  if (subEl) subEl.textContent = `Subtotal: ${moneyBRL(subtotal)}`;
  if (delEl) delEl.textContent = `Entrega: ${moneyBRL(deliveryFee)}`;
  if (discEl) {
    discEl.textContent = `Desconto: -${moneyBRL(discount)}`;
    discEl.classList.toggle("hidden", !(discount > 0));
  }
  if (wrap) wrap.classList.toggle("hidden", !(subtotal > 0 || deliveryFee > 0 || discount > 0));
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
        const label = "#" + data.orderNumber;
        document.getElementById("trackOrderId").textContent = label;
        const codeEl = document.getElementById("orderCode");
        if (codeEl) codeEl.textContent = label;
      }

      const friendly = statusLabel(data.status);
      document.getElementById("trackStatus").textContent = friendly;
      renderStatusTimeline(data.status);

      const updated = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
      document.getElementById("trackUpdated").textContent =
        updated ? updated.toLocaleString("pt-BR") : "Aguardando atualização";

      renderOrderTotal(data.totals);
      renderOrderItems(data.items);

      if (normalizeOrderStatus(data.status) === "entregue") {
        if (hasReviewedOrder(orderId)) hideDeliveryReviewGate();
        else showDeliveryReviewGate(orderId);
      } else {
        hideDeliveryReviewGate();
        setReviewStars(0);
        const txt = document.getElementById("deliveryReviewText");
        if (txt) txt.value = "";
      }
      
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
function getProfilePoints(data){
  let points = 0;
  if (data?.name) points += 20;
  if (data?.address) points += 30;
  if (data?.complement) points += 10;
  if (data?.avatar) points += 10;
  return Math.min(points, 100);
}

function getProfileLevel(points){
  if (points >= 100) return "Diamante";
  if (points >= 75) return "Ouro";
  if (points >= 45) return "Prata";
  return "Bronze";
}

function updateProfileHero(){
  const data = loadProfile();
  const points = getProfilePoints(data);
  const level = getProfileLevel(points);

  const heroName = document.getElementById("profileHeroName");
  const avatarPreview = document.getElementById("profileAvatarPreview");
  const miniStatus = document.getElementById("profileMiniStatus");
  const levelName = document.getElementById("profileLevelName");
  const levelBarFill = document.getElementById("profileLevelBarFill");
  const levelHint = document.getElementById("profileLevelHint");

  if (heroName) heroName.textContent = data.name?.trim() || "Seu perfil";
  if (avatarPreview) avatarPreview.textContent = data.avatar || "🙂";

  if (miniStatus) {
    if (data.address?.trim()) {
      miniStatus.textContent = data.address + (data.complement ? " - " + data.complement : "");
    } else {
      miniStatus.textContent = "Complete seu perfil para uma experiência melhor.";
    }
  }

  if (levelName) levelName.textContent = level;
  if (levelBarFill) levelBarFill.style.width = `${points}%`;

  if (levelHint) {
    if (points >= 100) {
      levelHint.textContent = "Perfil completo. Nível máximo atingido.";
    } else {
      levelHint.textContent = `${points} / 100 pontos para o próximo nível`;
    }
  }
}
/* =========================
   Boot
   ========================= */

async function boot() {
  // Fecha chat com ESC (desktop)
  bindDeliveryReviewUI();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { try { closeChatDrawer(); } catch(_) {} }
  });

  // ✅ Tabs (navbar pílula)
 const tabMenu = document.getElementById("tabMenu");
const tabOrders = document.getElementById("tabOrders");
const tabProfile = document.getElementById("tabProfile");

if (tabMenu) {
  tabMenu.addEventListener("click", () => showTab("menu"));
}

if (tabOrders) {
  tabOrders.addEventListener("click", () => {
    if (!state.currentOrderId) return showTab("menu");
    showTab("orders");
  });
}

document.getElementById("tabProfile")?.addEventListener("click", () => {
  showTab("profile");
});

if (tabProfile) {
  tabProfile.addEventListener("click", () => {
    showTab("profile");
  });
}

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

  const live = document.getElementById("chatLiveStatus");
  if (live) live.textContent = "Atendimento online";

  openChatDrawer();
  setTimeout(() => { try { document.getElementById("chatText")?.focus(); } catch(_){} }, 60);
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
  updateConfirmOrderButton(true);
  try {
    if (shouldUseInlineMercadoPagoPix() || shouldUseInlineMercadoPagoCard()) {
      await startInlineMercadoPagoFlow();
      return;
    }

    const orderId = await createOrder();
    if (!orderId) {
      updateConfirmOrderButton(false);
      return;
    }

    finishOrderFlow(orderId);

  } catch (err) {
    console.error(err);
    alert("Erro ao processar o checkout. Veja o console (F12).");
  } finally {
    updateConfirmOrderButton(false);
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
    document.getElementById("tabProfile")?.addEventListener("click", () => {
    showTab("profile");
  });

  document.getElementById("loginGoogleBtn")?.addEventListener("click", loginWithGoogle);
  document.getElementById("openEmailAuthBtn")?.addEventListener("click", openEmailAuthModal);
  document.getElementById("closeEmailAuthBtn")?.addEventListener("click", closeEmailAuthModal);
  document.getElementById("closeEmailAuthBackdrop")?.addEventListener("click", closeEmailAuthModal);
  document.getElementById("emailLoginBtn")?.addEventListener("click", loginWithEmail);
  document.getElementById("emailRegisterBtn")?.addEventListener("click", registerWithEmail);
  document.getElementById("logoutBtn")?.addEventListener("click", logoutProfile);
}
function updateProfileUI(user){
  const guestBox = document.getElementById("profileGuestBox");
  const userBox = document.getElementById("profileUserBox");
  const userName = document.getElementById("profileUserName");
  const userEmail = document.getElementById("profileUserEmail");

  if (user && !user.isAnonymous){
    guestBox?.classList.add("hidden");
    userBox?.classList.remove("hidden");

    if (userName) userName.textContent = user.displayName || "Conta conectada";
    if (userEmail) userEmail.textContent = user.email || "";
  } else {
    guestBox?.classList.remove("hidden");
    userBox?.classList.add("hidden");

    if (userName) userName.textContent = "Conta conectada";
    if (userEmail) userEmail.textContent = "";
  }
}

async function loginWithGoogle(){
  try {
    const provider = new Auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const currentUser = auth.currentUser;

    if (currentUser?.isAnonymous) {
      await Auth.linkWithPopup(currentUser, provider);
    } else {
      await Auth.signInWithPopup(auth, provider);
    }

    alert("Login com Google realizado com sucesso.");
  } catch (e) {
    console.error("Erro no login com Google:", e);

    // fallback: se falhar o link da conta anônima, tenta login normal
    try {
      if (
        e?.code === "auth/credential-already-in-use" ||
        e?.code === "auth/email-already-in-use" ||
        e?.code === "auth/provider-already-linked"
      ) {
        await Auth.signInWithPopup(auth, new Auth.GoogleAuthProvider());
        alert("Login com Google realizado com sucesso.");
        return;
      }
    } catch (err2) {
      console.error("Fallback Google falhou:", err2);
    }

    alert("Não foi possível entrar com Google.");
  }
}

function openEmailAuthModal(){
  document.getElementById("emailAuthModal")?.classList.remove("hidden");
}

function closeEmailAuthModal(){
  document.getElementById("emailAuthModal")?.classList.add("hidden");
}

async function loginWithEmail(){
  const email = (document.getElementById("authEmail")?.value || "").trim();
  const password = (document.getElementById("authPassword")?.value || "").trim();

  if (!email || !password) {
    alert("Preencha email e senha.");
    return;
  }

  try {
    const currentUser = auth.currentUser;

    if (currentUser?.isAnonymous) {
      const cred = Auth.EmailAuthProvider.credential(email, password);
      await Auth.linkWithCredential(currentUser, cred);
    } else {
      await Auth.signInWithEmailAndPassword(auth, email, password);
    }

    closeEmailAuthModal();
    alert("Login realizado com sucesso.");
  } catch (e) {
    console.error("Erro no login por email:", e);
    alert("Não foi possível entrar com email.");
  }
}

async function registerWithEmail(){
  const email = (document.getElementById("authEmail")?.value || "").trim();
  const password = (document.getElementById("authPassword")?.value || "").trim();

  if (!email || !password) {
    alert("Preencha email e senha.");
    return;
  }

  try {
    const currentUser = auth.currentUser;

    if (currentUser?.isAnonymous) {
      const cred = Auth.EmailAuthProvider.credential(email, password);
      await Auth.linkWithCredential(currentUser, cred);
    } else {
      await Auth.createUserWithEmailAndPassword(auth, email, password);
    }

    closeEmailAuthModal();
    alert("Conta criada com sucesso.");
  } catch (e) {
    console.error("Erro ao criar conta:", e);
    alert("Não foi possível criar a conta.");
  }
}

async function logoutProfile(){
  try {
    await Auth.signOut(auth);
    alert("Você saiu da conta.");
  } catch (e) {
    console.error("Erro ao sair:", e);
    alert("Não foi possível sair.");
  }
}
const PROFILE_STORAGE_KEY = "client_profile_v2";

function normalizePhoneBR(value){
  return String(value || "").replace(/\D+/g, "").trim();
}

function buildProfileCheckoutAddress(data){
  return [
    data?.address || "",
    data?.number ? `Nº ${data.number}` : "",
    data?.complement || ""
  ].filter(Boolean).join(" - ");
}

function getDefaultProfile(){
  return {
    avatar: "🙂",
    name: "",
    phone: "",
    email: "",
    address: "",
    number: "",
    complement: "",
    level: "Bronze",
    xp: 22
  };
}

function loadProfile(){
  try{
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? { ...getDefaultProfile(), ...JSON.parse(raw) } : getDefaultProfile();
  }catch(_){
    return getDefaultProfile();
  }
}

function saveProfile(data){
  const current = loadProfile();

  const safe = {
    avatar: data?.avatar ?? current.avatar ?? "🙂",
    name: (data?.name ?? current.name ?? "").trim(),
    phone: normalizePhoneBR(data?.phone ?? current.phone ?? ""),
    email: String(data?.email ?? current.email ?? "").trim(),
    address: (data?.address ?? current.address ?? "").trim(),
    number: (data?.number ?? current.number ?? "").trim(),
    complement: (data?.complement ?? current.complement ?? "").trim(),
    level: (data?.level ?? current.level ?? "Bronze").trim() || "Bronze",
    xp: Math.max(0, Math.min(100, Number(data?.xp ?? current.xp ?? 22)))
  };

  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

function renderProfileForm(){
  const data = loadProfile();

  const avatarPreview = document.getElementById("profileAvatarPreview");
  const heroName = document.getElementById("profileHeroName");
  const levelText = document.getElementById("profileLevelText");
  const xpFill = document.getElementById("profileXpBarFill");

  const nameInput = document.getElementById("profileNameInput");
  const phoneInput = document.getElementById("profilePhoneInput");
  const emailInput = document.getElementById("profileEmailInput");
  const addressInput = document.getElementById("profileAddressInput");
  const numberInput = document.getElementById("profileNumberInput");
  const complementInput = document.getElementById("profileComplementInput");

  if (avatarPreview) avatarPreview.textContent = data.avatar || "🙂";
  if (heroName) heroName.textContent = data.name || "Seu perfil";
  if (levelText) levelText.textContent = data.level || "Bronze";
  if (xpFill) xpFill.style.width = `${Number(data.xp || 0)}%`;

  const xpHint = document.getElementById("profileXpHint");
  if (xpHint) xpHint.textContent = `${Number(data.xp || 0)} XP • Toque para ver benefícios e como funciona`;

  if (nameInput) nameInput.value = data.name || "";
  if (phoneInput) phoneInput.value = data.phone || "";
  if (emailInput) emailInput.value = data.email || "";
  if (addressInput) addressInput.value = data.address || "";
  if (numberInput) numberInput.value = data.number || "";
  if (complementInput) complementInput.value = data.complement || "";

  document.querySelectorAll(".avatarOption").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.avatar === data.avatar);
  });
}

function bindProfileAvatarPicker(){
  document.querySelectorAll(".avatarOption").forEach(btn => {
    btn.addEventListener("click", () => {
      const current = loadProfile();
      saveProfile({ ...current, avatar: btn.dataset.avatar || "🙂" });
      renderProfileForm();
    });
  });
}

function handleSaveAvatar(){
  const current = loadProfile();
  const avatar = document.querySelector(".avatarOption.is-active")?.dataset?.avatar || "🙂";
  saveProfile({ ...current, avatar });
  renderProfileForm();
  alert("Avatar salvo com sucesso.");
}

function handleSaveProfileData(){
  const current = loadProfile();

  const name = document.getElementById("profileNameInput")?.value || "";
  const phone = document.getElementById("profilePhoneInput")?.value || "";
  const email = document.getElementById("profileEmailInput")?.value || "";
  const address = document.getElementById("profileAddressInput")?.value || "";
  const number = document.getElementById("profileNumberInput")?.value || "";
  const complement = document.getElementById("profileComplementInput")?.value || "";

  saveProfile({
    ...current,
    name,
    phone,
    email,
    address,
    number,
    complement
  });

  renderProfileForm();
  syncCheckoutInputsWithProfile(false);
  alert("Dados salvos com sucesso.");
}

function openProfileSettings(){
  renderProfileForm();
  document.getElementById("profileSettingsModal")?.classList.remove("hidden");
}

function closeProfileSettings(){
  document.getElementById("profileSettingsModal")?.classList.add("hidden");
}

function openLevelsGuide(){
  document.getElementById("levelsGuideModal")?.classList.remove("hidden");
  syncLevelsDots();
}

function closeLevelsGuide(){
  document.getElementById("levelsGuideModal")?.classList.add("hidden");
}

function syncLevelsDots(){
  const track = document.getElementById("levelsGuideTrack");
  if (!track) return;

  const cards = Array.from(track.children);
  const dots = Array.from(document.querySelectorAll(".levelsDot"));
  if (!cards.length || !dots.length) return;

  const index = Math.round(track.scrollLeft / (cards[0].offsetWidth + 12));
  dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
}

function syncCheckoutInputsWithProfile(force = false){
  const data = loadProfile();

  const checkoutName = document.getElementById("custName");
  const checkoutPhone = document.getElementById("custPhone");
  const checkoutEmail = document.getElementById("custEmail");
  const checkoutAddress = document.getElementById("custAddr");
  const fullAddress = buildProfileCheckoutAddress(data);

  if (checkoutName && (force || !checkoutName.value.trim())) {
    checkoutName.value = data.name || "";
  }

  if (checkoutPhone && (force || !checkoutPhone.value.trim())) {
    checkoutPhone.value = data.phone || "";
  }

  if (checkoutEmail && (force || !checkoutEmail.value.trim())) {
    checkoutEmail.value = data.email || "";
  }

  if (checkoutAddress && (force || !checkoutAddress.value.trim())) {
    checkoutAddress.value = fullAddress;
  }
}

function saveCheckoutFieldsToProfile(){
  const current = loadProfile();

  const name = (document.getElementById("custName")?.value || "").trim();
  const phone = normalizePhoneBR(document.getElementById("custPhone")?.value || "");
  const email = String(document.getElementById("custEmail")?.value || "").trim();
  const rawAddress = (document.getElementById("custAddr")?.value || "").trim();

  const profileAddress = [current.address || "", current.number ? `Nº ${current.number}` : "", current.complement || ""]
    .filter(Boolean)
    .join(" - ");

  saveProfile({
    ...current,
    name: name || current.name || "",
    phone: phone || current.phone || "",
    email: email || current.email || "",
    address: rawAddress && rawAddress !== profileAddress ? rawAddress : (current.address || ""),
    number: rawAddress && rawAddress !== profileAddress ? "" : (current.number || ""),
    complement: rawAddress && rawAddress !== profileAddress ? "" : (current.complement || "")
  });
}

function bindCheckoutProfileAutosave(){
  const ids = ["custName", "custPhone", "custEmail", "custAddr"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.profileBound === "1") return;
    el.dataset.profileBound = "1";

    const persist = () => saveCheckoutFieldsToProfile();
    el.addEventListener("input", persist);
    el.addEventListener("change", persist);
    el.addEventListener("blur", persist);
  });
}

function fillCheckoutWithProfile(force = false){
  syncCheckoutInputsWithProfile(force);
  bindCheckoutProfileAutosave();
}

boot();
document.getElementById("openProfileSettingsBtn")?.addEventListener("click", openProfileSettings);
document.getElementById("closeProfileSettingsBtn")?.addEventListener("click", closeProfileSettings);
document.getElementById("closeProfileSettingsBackdrop")?.addEventListener("click", closeProfileSettings);

document.getElementById("openLevelsGuideBtn")?.addEventListener("click", openLevelsGuide);
document.getElementById("closeLevelsGuideBtn")?.addEventListener("click", closeLevelsGuide);
document.getElementById("closeLevelsGuideBackdrop")?.addEventListener("click", closeLevelsGuide);
document.getElementById("levelsGuideTrack")?.addEventListener("scroll", syncLevelsDots, { passive: true });

document.getElementById("saveAvatarBtn")?.addEventListener("click", handleSaveAvatar);
document.getElementById("saveProfileDataBtn")?.addEventListener("click", handleSaveProfileData);
document.getElementById("useProfileOnCheckoutBtn")?.addEventListener("click", fillCheckoutWithProfile);

renderProfileForm();
bindProfileAvatarPicker();
fillCheckoutWithProfile(false);
document.getElementById("copyPixCodeBtn")?.addEventListener("click", async () => {
  const code = document.getElementById("mpPixCode")?.value || "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    const status = document.getElementById("mpPixStatus");
    if (status) status.textContent = "Código Pix copiado ✅";
  } catch(_) {}
});
const checkPixStatusBtn = document.getElementById("checkPixStatusBtn");
if (checkPixStatusBtn) {
  checkPixStatusBtn.style.display = "none";
  checkPixStatusBtn.addEventListener("click", async () => {
    try { await checkInlinePixPaymentStatus(); } catch (err) { console.error(err); alert(err?.message || "Falha ao verificar pagamento."); }
  });
}
  document.getElementById("saveProfileBtn")?.addEventListener("click", handleSaveProfileData);
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

function applyProfileToCheckoutFields(force = false){
  const data = loadProfile();

  const nameEl = document.getElementById("custName");
  const addrEl = document.getElementById("custAddr");

  if (nameEl && (force || !nameEl.value.trim())) {
    nameEl.value = data.name || "";
  }

  if (addrEl && (force || !addrEl.value.trim())) {
    addrEl.value = [data.address || "", data.complement || ""]
      .filter(Boolean)
      .join(" - ");
  }
}
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
function syncMenuChrome(){
  const topbar = document.querySelector(".topbar");
  const categoryBar = document.getElementById("categoryBar");
  const promoBanner = document.getElementById("promoBanner");
  const promoMount = document.getElementById("promoMount");

  const isMenuActive =
    !document.getElementById("menuView")?.classList.contains("hidden");

  topbar?.classList.toggle("hidden", !isMenuActive);
  categoryBar?.classList.toggle("hidden", !isMenuActive);

  // esconde também o banner promo fora do cardápio
  if (promoBanner) {
    promoBanner.classList.toggle("hidden", !isMenuActive);
  }

  // caso você esteja usando só o mount
  if (promoMount) {
    promoMount.classList.toggle("hidden", !isMenuActive);
  }
}
async function pagarComMercadoPago(total, orderId) {
  const response = await fetch(
    "http://127.0.0.1:5001/japed-e09f2/us-central1/createMercadoPagoPreference",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: Number(total),
        title: "Pedido do restaurante",
        orderId: String(orderId)
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.init_point) {
    throw new Error(data.error || "Não foi possível iniciar o pagamento");
  }

  window.location.href = data.init_point;
}
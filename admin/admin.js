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

const PLATFORM_OWNER_EMAILS = [
  "jopinha@gmail.com"
];

let IS_MASTER_PANEL = false;
let MASTER_UNSUB_RESTAURANTS = null;
let MASTER_RESTAURANTS_CACHE = [];
let MASTER_SELECTED_ID = null;
let MASTER_UNSUB_PENDING = null;
let MASTER_PENDING_CACHE = [];


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
const masterPanelEl = document.getElementById("masterPanel");
const authLoginViewEl = document.getElementById("authLoginView");
const authSignupViewEl = document.getElementById("authSignupView");
const authPendingViewEl = document.getElementById("authPendingView");
const openSignupBtn = document.getElementById("openSignupBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");
const pendingBackToLoginBtn = document.getElementById("pendingBackToLoginBtn");
const signupFormEl = document.getElementById("signupForm");
const signupPlansHost = document.getElementById("signupPlans");
const signupPlanTierEl = document.getElementById("signupPlanTier");
const signupRestaurantNameEl = document.getElementById("signupRestaurantName");
const signupOwnerNameEl = document.getElementById("signupOwnerName");
const signupWhatsappEl = document.getElementById("signupWhatsapp");
const signupEmailEl = document.getElementById("signupEmail");
const signupPasswordEl = document.getElementById("signupPassword");
const signupPassword2El = document.getElementById("signupPassword2");
const signupNotesEl = document.getElementById("signupNotes");
const signupErrorEl = document.getElementById("signupError");
const signupSelectedPlanLabelEl = document.getElementById("signupSelectedPlanLabel");
const signupSelectedPlanPriceEl = document.getElementById("signupSelectedPlanPrice");
const pendingRestaurantNameEl = document.getElementById("pendingRestaurantName");
const pendingPlanTierEl = document.getElementById("pendingPlanTier");
const pendingContactInfoEl = document.getElementById("pendingContactInfo");

const ordersWrap = document.getElementById("orders");

const masterRefs = {
  refreshBtn: document.getElementById("masterRefreshBtn"),
  logoutBtn: document.getElementById("masterLogoutBtn"),
  search: document.getElementById("masterSearch"),
  planFilter: document.getElementById("masterPlanFilter"),
  statusFilter: document.getElementById("masterStatusFilter"),
  body: document.getElementById("masterRestaurantsBody"),
  empty: document.getElementById("masterEmpty"),
  count: document.getElementById("masterCount"),
  statTotal: document.getElementById("msTotal"),
  statGold: document.getElementById("msGold"),
  statActive: document.getElementById("msActive"),
  statExpiring: document.getElementById("msExpiring"),
  drawer: document.getElementById("masterDrawer"),
  drawerScrim: document.getElementById("masterDrawerScrim"),
  drawerClose: document.getElementById("masterDrawerClose"),
  drawerRestaurantName: document.getElementById("masterDrawerRestaurantName"),
  drawerRestaurantId: document.getElementById("masterDrawerRestaurantId"),
  drawerStatus: document.getElementById("masterDrawerStatus"),
  saveBtn: document.getElementById("masterSaveBtn"),
  markPaidBtn: document.getElementById("masterMarkPaidBtn"),
  set30Btn: document.getElementById("masterSet30Btn"),
  set7Btn: document.getElementById("masterSet7Btn"),
  clearTrialBtn: document.getElementById("masterDeleteTrialBtn"),
  fName: document.getElementById("mName"),
  fContact: document.getElementById("mContact"),
  fBillingEmail: document.getElementById("mBillingEmail"),
  fTier: document.getElementById("mPlanTier"),
  fStatus: document.getElementById("mPlanStatus"),
  fMonthlyPrice: document.getElementById("mMonthlyPrice"),
  fDueDay: document.getElementById("mDueDay"),
  fPaidAt: document.getElementById("mPaidAt"),
  fExpiresAt: document.getElementById("mExpiresAt"),
  fTrialEndsAt: document.getElementById("mTrialEndsAt"),
  fNotes: document.getElementById("mNotes")
};

const masterPendingRefs = {
  body: document.getElementById("masterPendingBody"),
  empty: document.getElementById("masterPendingEmpty"),
  count: document.getElementById("masterPendingCount"),
  statPending: document.getElementById("msPending")
};

const restNameEl = document.getElementById("restName");

const DEFAULT_MASTER_PLAN_CONFIG = {
  basic: {
    priceBRL: 0,
    features: { orders: true, products: true, finance: false, customers: false, promos: false, settings: true }
  },
  gold: {
    priceBRL: 99.9,
    features: { orders: true, products: true, finance: true, customers: true, promos: true, settings: true }
  },
  diamond: {
    priceBRL: 149.9,
    features: { orders: true, products: true, finance: true, customers: true, promos: true, settings: true }
  }
};

const DEFAULT_MASTER_BILLING_CONFIG = {
  platformName: "JPED",
  signatureName: "Equipe JPED",
  pixKey: "",
  pixHolder: "",
  supportWhatsapp: "",
  supportEmail: "",
  instructions: "Envie o comprovante do pagamento para que a ativação ou renovação do plano seja confirmada."
};

let PLATFORM_PLAN_CONFIG = JSON.parse(JSON.stringify(DEFAULT_MASTER_PLAN_CONFIG));
let PLATFORM_BILLING_CONFIG = JSON.parse(JSON.stringify(DEFAULT_MASTER_BILLING_CONFIG));
let ACTIVE_RESTAURANT_PAGE = "orders";

const masterPlansRefs = {
  tabRestaurants: document.getElementById("masterTabBtnRestaurants"),
  tabPlans: document.getElementById("masterTabBtnPlans"),
  pageRestaurants: document.getElementById("masterTabRestaurants"),
  pagePlans: document.getElementById("masterTabPlans"),
  saveBtn: document.getElementById("masterPlansSaveBtn"),
  status: document.getElementById("masterPlansStatus"),
  cardsHost: document.getElementById("masterPlansCards"),
  pixKey: document.getElementById("masterBillingPixKey"),
  pixHolder: document.getElementById("masterBillingPixHolder"),
  supportWhatsapp: document.getElementById("masterBillingWhatsapp"),
  supportEmail: document.getElementById("masterBillingEmail"),
  instructions: document.getElementById("masterBillingInstructions")
};

let unsubOrders = null;

/** Helpers */
function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showAuthSubView(which = "login") {
  authLoginViewEl?.classList.toggle("hidden", which !== "login");
  authSignupViewEl?.classList.toggle("hidden", which !== "signup");
  authPendingViewEl?.classList.toggle("hidden", which !== "pending");
}

function _friendlyAuthError(e) {
  const code = String(e?.code || "");
  if (code.includes("email-already-in-use")) return "Esse email já está cadastrado.";
  if (code.includes("invalid-email")) return "Digite um email válido.";
  if (code.includes("weak-password")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (code.includes("network-request-failed")) return "Falha de rede. Tente novamente.";
  return "Não foi possível concluir o cadastro.";
}

function updateSignupPlanSummary(tier = "gold") {
  const key = _masterNormalizeTier(tier);
  const cfg = getPlanConfigForTier(key);
  if (signupPlanTierEl) signupPlanTierEl.value = key;
  if (signupSelectedPlanLabelEl) signupSelectedPlanLabelEl.textContent = key.charAt(0).toUpperCase() + key.slice(1);
  if (signupSelectedPlanPriceEl) signupSelectedPlanPriceEl.textContent = `${brl(cfg.priceBRL || 0)} / mês`;
  if (!signupPlansHost) return;
  signupPlansHost.querySelectorAll("[data-signup-plan]").forEach(card => {
    card.classList.toggle("is-selected", card.dataset.signupPlan === key);
  });
}

function renderSignupPlans() {
  if (!signupPlansHost) return;
  const cfg = _mergePlanConfig(DEFAULT_MASTER_PLAN_CONFIG, PLATFORM_PLAN_CONFIG || {});
  const order = ["basic", "gold", "diamond"];
  const labels = { basic: "Basic", gold: "Gold", diamond: "Diamond" };
  const desc = {
    basic: "Essencial para operar pedidos e produtos.",
    gold: "Mais completo para vender melhor com promoções e financeiro.",
    diamond: "Plano avançado para operação completa da plataforma."
  };
  signupPlansHost.innerHTML = order.map(tier => {
    const item = cfg[tier] || DEFAULT_MASTER_PLAN_CONFIG[tier];
    const feats = Object.entries(item.features || {}).filter(([,v]) => !!v).map(([k]) => ({
      orders: "Pedidos",
      products: "Produtos",
      finance: "Financeiro",
      customers: "Clientes",
      promos: "Promoções",
      settings: "Configurações"
    }[k] || k));
    return `
      <button class="signupPlanCard ${tier === (signupPlanTierEl?.value || 'gold') ? 'is-selected' : ''}" type="button" data-signup-plan="${tier}">
        <div class="signupPlanTop">
          <strong>${labels[tier]}</strong>
          <span>${brl(item.priceBRL || 0)}/mês</span>
        </div>
        <p>${desc[tier]}</p>
        <div class="signupPlanFeatures">${feats.map(f => `<span>${f}</span>`).join("")}</div>
      </button>`;
  }).join("");
  signupPlansHost.querySelectorAll("[data-signup-plan]").forEach(btn => {
    btn.addEventListener("click", () => updateSignupPlanSummary(btn.dataset.signupPlan || "gold"));
  });
  updateSignupPlanSummary(signupPlanTierEl?.value || "gold");
}

async function refreshPublicSignupPlans() {
  try { await loadPlatformPlanConfig(); } catch (_) {}
  renderSignupPlans();
}

function fillPendingSignupView(userData = {}) {
  const restName = userData?.requestedRestaurantName || userData?.onboarding?.restaurantName || "Seu restaurante";
  const tier = _masterNormalizeTier(userData?.requestedPlan || userData?.onboarding?.planTier || "gold");
  const contact = userData?.phone || userData?.onboarding?.phone || userData?.email || "";
  if (pendingRestaurantNameEl) pendingRestaurantNameEl.textContent = restName;
  if (pendingPlanTierEl) pendingPlanTierEl.textContent = `Plano ${tier.charAt(0).toUpperCase() + tier.slice(1)}`;
  if (pendingContactInfoEl) pendingContactInfoEl.textContent = contact ? `Contato informado: ${contact}` : "Assim que o restaurante for vinculado, este login passará a abrir o painel normal.";
}

async function handleRestaurantSignup(ev) {
  ev?.preventDefault?.();
  if (!signupFormEl) return;
  if (signupErrorEl) signupErrorEl.textContent = "";

  const restaurantName = String(signupRestaurantNameEl?.value || "").trim();
  const ownerName = String(signupOwnerNameEl?.value || "").trim();
  const whatsapp = String(signupWhatsappEl?.value || "").trim();
  const email = String(signupEmailEl?.value || "").trim();
  const password = String(signupPasswordEl?.value || "");
  const password2 = String(signupPassword2El?.value || "");
  const notes = String(signupNotesEl?.value || "").trim();
  const tier = _masterNormalizeTier(signupPlanTierEl?.value || "gold");
  const cfg = getPlanConfigForTier(tier);

  if (!restaurantName || !ownerName || !whatsapp || !email || !password || !password2) {
    if (signupErrorEl) signupErrorEl.textContent = "Preencha todos os campos obrigatórios.";
    return;
  }
  if (password !== password2) {
    if (signupErrorEl) signupErrorEl.textContent = "As senhas não conferem.";
    return;
  }

  const submitBtn = document.getElementById("signupSubmitBtn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const cred = await Auth.createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    await Firestore.setDoc(Firestore.doc(db, "users", uid), {
      email,
      name: ownerName,
      phone: whatsapp,
      role: "owner",
      restaurantId: null,
      signupStatus: "pending_setup",
      requestedPlan: tier,
      requestedPriceBRL: Number(cfg.priceBRL || 0),
      requestedRestaurantName: restaurantName,
      onboarding: {
        restaurantName,
        ownerName,
        phone: whatsapp,
        planTier: tier,
        notes,
        source: "login_landing",
        createdAt: Firestore.serverTimestamp()
      },
      updatedAt: Firestore.serverTimestamp(),
      createdAt: Firestore.serverTimestamp()
    }, { merge: true });

    fillPendingSignupView({ requestedRestaurantName: restaurantName, requestedPlan: tier, phone: whatsapp, email });
    try { await Auth.signOut(auth); } catch (_) {}
    signupFormEl.reset();
    updateSignupPlanSummary("gold");
    showAuthSubView("pending");
  } catch (e) {
    console.error("Erro ao cadastrar restaurante:", e?.code || e, e?.message || "");
    if (signupErrorEl) signupErrorEl.textContent = _friendlyAuthError(e);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function _normalizeAdminPayment(order) {
  const checkout = order?.checkout || {};
  const totals = order?.totals || {};

  const paymentMethod = String(
    order?.paymentMethod ||
    checkout?.paymentMethod ||
    totals?.paymentMethod ||
    order?.mpPaymentMethod ||
    ""
  ).trim().toLowerCase();

  const paymentStatus = String(order?.paymentStatus || order?.mpPaymentStatus || "").trim().toLowerCase();
  const status = String(order?.status || "").trim().toLowerCase();
  const paymentLabelRaw = String(order?.paymentLabel || checkout?.paymentLabel || "").trim().toLowerCase();

  const total = Number(
    totals?.total ??
    checkout?.total ??
    order?.total ??
    order?.amount ??
    0
  );

  const changeNeeded = !!(
    order?.changeNeeded ??
    checkout?.changeNeeded ??
    totals?.changeNeeded ??
    false
  );

  const changeFor = Number(
    order?.changeFor ??
    checkout?.changeFor ??
    totals?.changeFor ??
    0
  );

  const pixPaid = paymentMethod === "pix" && (
    paymentStatus === "approved" ||
    paymentStatus === "paid" ||
    status === "pago" ||
    order?.paid === true
  );

  const isCash = paymentMethod === "cash" || paymentLabelRaw.includes("dinheiro");
  const isCard = paymentMethod === "card" || paymentLabelRaw.includes("cartão") || paymentLabelRaw.includes("cartao");
  const isPix = paymentMethod === "pix" || paymentLabelRaw === "pix";

  return { paymentMethod, paymentStatus, status, paymentLabelRaw, total, changeNeeded, changeFor, pixPaid, isCash, isCard, isPix };
}

function getAdminPaymentPresentation(order) {
  const pay = _normalizeAdminPayment(order);

  if (pay.pixPaid || pay.paymentLabelRaw === "pago") return { text: "PAGO", chipClass: "paid" };
  if (pay.isCash) return { text: "DINHEIRO NA ENTREGA", chipClass: "cash" };
  if (pay.isCard) return { text: "CARTÃO NA ENTREGA", chipClass: "card" };
  if (pay.isPix) return { text: "PIX PENDENTE", chipClass: "pix" };
  return { text: "PAGAMENTO", chipClass: "default" };
}

function getAdminChangeText(order, total) {
  const pay = _normalizeAdminPayment(order);
  if (!pay.isCash) return "";

const orderTotal = Number((total ?? pay.total) || 0);

  if (!pay.changeNeeded || !pay.changeFor) return "Não precisa";

  return `Troco para ${brl(pay.changeFor)} · devolver ${brl(Math.max(0, pay.changeFor - orderTotal))}`;
}


function getAdminText(order, total) {
  return getAdminChangeText(order, total);
}

function getAdminPaymentText(order) {
  return getAdminPaymentPresentation(order)?.text || "PAGAMENTO";
}


function _numMoney(v) {
  const n = Number(String(v ?? '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function _getItemUnitPrice(item) {
  return _numMoney(
    item?.unitPrice ??
    item?.price ??
    item?.basePrice ??
    item?.unit_amount ??
    0
  );
}

function _getItemQty(item) {
  const qty = Number(item?.qty ?? item?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function _getItemTotalPrice(item) {
  return _numMoney(
    item?.total ??
    item?.lineTotal ??
    item?.subtotal ??
    item?.amount ??
    (_getItemUnitPrice(item) * _getItemQty(item))
  );
}

function _getItemOriginalTotal(item) {
  const direct = _numMoney(
    item?.originalTotal ??
    item?.subtotalOriginal ??
    item?.lineOriginalTotal ??
    item?.totalBeforeDiscount ??
    item?.amountBeforeDiscount ??
    0
  );
  if (direct > 0) return direct;

  const unitOriginal = _numMoney(item?.originalUnitPrice ?? item?.unitPriceOriginal ?? item?.priceBeforeDiscount ?? 0);
  if (unitOriginal > 0) return unitOriginal * _getItemQty(item);

  return _getItemTotalPrice(item);
}

function _getItemDiscountValue(item) {
  const explicit = _numMoney(
    item?.discount ??
    item?.discountValue ??
    item?.off ??
    item?.couponDiscount ??
    0
  );
  if (explicit > 0) return explicit;
  return Math.max(0, _getItemOriginalTotal(item) - _getItemTotalPrice(item));
}

function _getOrderTotalsSummary(order) {
  const totals = order?.totals || {};
  const checkout = order?.checkout || {};

  const total = _numMoney(totals?.total ?? checkout?.total ?? order?.total ?? order?.amount ?? 0);
  const subtotal = _numMoney(totals?.subtotal ?? checkout?.subtotal ?? order?.subtotal ?? total);
  const deliveryFee = _numMoney(totals?.deliveryFee ?? checkout?.deliveryFee ?? order?.deliveryFee ?? order?.shipping ?? 0);

  const explicitDiscount = _numMoney(
    totals?.discount ??
    totals?.discountValue ??
    checkout?.discount ??
    checkout?.discountValue ??
    order?.discount ??
    order?.discountValue ??
    order?.couponDiscount ??
    0
  );

  const itemDiscount = (Array.isArray(order?.items) ? order.items : []).reduce((acc, item) => acc + _getItemDiscountValue(item), 0);
  const discount = Math.max(explicitDiscount, itemDiscount, Math.max(0, subtotal + deliveryFee - total));

  return { subtotal, deliveryFee, discount, total };
}

function _toOptionArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function _getItemOptionsLines(item) {
  const parts = [];

  const sizes = _toOptionArray(
    item?.meta?.size ??
    item?.meta?.sizes ??
    item?.sizes ??
    item?.selectedSizes ??
    item?.sizeOptions ??
    item?.selectedSize ??
    item?.size
  );

  const addons = _toOptionArray(
    item?.meta?.addons ??
    item?.addons ??
    item?.selectedAddons ??
    item?.additionals ??
    item?.adicionais ??
    item?.extras ??
    item?.extraItems ??
    item?.selectedExtras ??
    item?.additionalItems
  );

  const sizeTextFallback = String(item?.meta?.sizeText || item?.sizeText || '').trim();
  const optionsText = String(item?.optionsText || '').trim();

  if (sizes.length) {
    parts.push('Tamanho: ' + sizes.map((opt) => {
      const raw = opt?.name || opt?.label || opt?.title || opt?.value || String(opt || '').trim();
      const name = _escapeHtml(raw);
      const price = _numMoney(opt?.price ?? opt?.valuePrice ?? opt?.amount ?? 0);
      return name ? (price > 0 ? `${name} (+${brl(price)})` : name) : '';
    }).filter(Boolean).join(', '));
  } else if (sizeTextFallback) {
    parts.push('Tamanho: ' + _escapeHtml(sizeTextFallback));
  }

  if (addons.length) {
    parts.push('Adicionais: ' + addons.map((opt) => {
      const qty = Number(opt?.qty ?? opt?.quantity ?? opt?.amountQty ?? 1);
      const raw = opt?.name || opt?.label || opt?.title || opt?.value || String(opt || '').trim();
      const name = _escapeHtml(raw);
      const price = _numMoney(opt?.price ?? opt?.valuePrice ?? opt?.amount ?? 0);
      const qtyText = Number.isFinite(qty) && qty > 1 ? `${qty}x ` : '';
      const priceText = price > 0 ? ` (+${brl(price)})` : '';
      return name ? `${qtyText}${name}${priceText}` : '';
    }).filter(Boolean).join(', '));
  }

  if (optionsText) {
    const lower = optionsText.toLowerCase();
    const alreadyHasAddons = parts.some((line) => line.startsWith('Adicionais:'));
    const alreadyHasSize = parts.some((line) => line.startsWith('Tamanho:'));
    if (!alreadyHasAddons && (lower.includes('adicional') || lower.includes('extra'))) {
      parts.push(_escapeHtml(optionsText));
    } else if (!alreadyHasSize && lower.includes('tamanho')) {
      parts.push(_escapeHtml(optionsText));
    } else if (!parts.length) {
      parts.push(_escapeHtml(optionsText));
    }
  }

  const obs = String(item?.obs || item?.observation || item?.notes || item?.meta?.notes || '').trim();
  if (obs) parts.push('Obs: ' + _escapeHtml(obs));

  return parts;
}

function _getOrderWhatsapp(order) {
  const raw = (
    order?.customer?.phone ??
    order?.customer?.whatsapp ??
    order?.checkout?.customer?.phone ??
    order?.checkout?.phone ??
    order?.checkout?.customerPhone ??
    order?.phone ??
    order?.whatsapp ??
    order?.contactPhone ??
    order?.contact?.phone ??
    ''
  );
  return String(raw || '').trim();
}

function _getOrderAddress(order) {
  const raw = (
    order?.checkout?.deliveryAddress ??
    order?.customer?.address ??
    order?.checkout?.address ??
    order?.deliveryAddress ??
    order?.address ??
    order?.checkout?.pickupNote ??
    ''
  );
  return String(raw || '').trim();
}

function _renderOrderItemsDetailed(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<div class="modalEmpty">Sem itens</div>`;

  return list.map((item) => {
    const qty = _getItemQty(item);
    const name = _escapeHtml(item?.name || '-');
    const unitPrice = _getItemUnitPrice(item);
    const lineTotal = _getItemTotalPrice(item);
    const discount = _getItemDiscountValue(item);
    const optionLines = _getItemOptionsLines(item);

    return `
      <div class="modalItem">
        <div class="miLeft">
          <div class="miName">${qty}x ${name}</div>
          <div class="miMeta">Unitário: ${brl(unitPrice)}</div>
          ${discount > 0 ? `<div class="miMeta">Desconto: -${brl(discount)}</div>` : ``}
          ${optionLines.map(line => `<div class="miMeta">${line}</div>`).join('')}
        </div>
        <div class="miRight">${brl(lineTotal)}</div>
      </div>
    `;
  }).join('');
}

function _renderComandaItemsHtml(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '<div class="line">Sem itens</div>';

  return list.map((item) => {
    const qty = _getItemQty(item);
    const name = _escapeHtml(item?.name || 'Item');
    const lineTotal = _getItemTotalPrice(item);
    const optionLines = _getItemOptionsLines(item);

    const additionalLines = optionLines
      .filter((line) => /^adicionais:/i.test(String(line || '').trim()))
      .flatMap((line) => {
        const raw = String(line || '').replace(/^adicionais:\s*/i, '').trim();
        if (!raw) return [];
        return raw
          .split(/\s*,\s*/)
          .map(part => _escapeHtml(part.replace(/\s*\([^)]+\)\s*$/, '').trim()))
          .filter(Boolean);
      });

    const otherLines = optionLines
      .filter((line) => !/^adicionais:/i.test(String(line || '').trim()));

    return `
      <div class="item">
        <div class="item-name">${qty}x ${name}</div>
        <div class="item-price">${brl(lineTotal)}</div>
        ${otherLines.map(line => `<div class="item-extra">${line}</div>`).join('')}
        ${additionalLines.length ? `
          <div class="item-extra item-extra-title">Adicionais:</div>
          ${additionalLines.map(line => `<div class="item-extra item-extra-list">${line}</div>`).join('')}
        ` : ``}
      </div>
    `;
  }).join('');
}


function _buildComandaHtml(order) {
  const customerName = _escapeHtml(order?.customer?.name || order?.customerName || 'Cliente');
  const phone = _escapeHtml(_getOrderWhatsapp(order) || '-');
  const address = _escapeHtml(_getOrderAddress(order) || '-');
  const paymentLabel = _escapeHtml(getAdminPaymentPresentation(order)?.text || 'PAGAMENTO');
  const totals = _getOrderTotalsSummary(order);
  const pay = _normalizeAdminPayment(order);

  const createdAtRaw = order?.createdAt?.toDate ? order.createdAt.toDate() : (order?.createdAt ? new Date(order.createdAt) : new Date());
  const createdAt = Number.isNaN(createdAtRaw?.getTime?.()) ? new Date() : createdAtRaw;
  const createdLabel = _escapeHtml(createdAt.toLocaleString('pt-BR'));

  const rawMode = String(
    order?.totals?.checkoutMode ||
    order?.checkout?.checkoutMode ||
    order?.checkout?.mode ||
    order?.checkoutMode ||
    (order?.checkout?.deliveryAddress ? 'delivery' : '')
  ).trim().toLowerCase();
  const modeLabel = rawMode === 'pickup' ? 'RETIRADA' : 'ENTREGA';

  const codeValueRaw = String(order?.orderNumber ?? order?.code ?? order?.displayCode ?? order?.shortCode ?? '').replace(/\D/g, '');
  const orderCode = (codeValueRaw ? codeValueRaw.slice(-4).padStart(4, '0') : '----');

  const trocoText = _escapeHtml(getAdminChangeText(order, totals.total) || '');

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Comanda</title>
      <style>
        @page { size: auto; margin: 2.5mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
        body { font-size: 13px; line-height: 1.35; }
        .wrap {
          width: 76mm;
          margin: 0 auto;
          padding: 2.8mm 2.2mm 3.2mm;
        }
        .topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }
        .modeBlock {
          flex: 1;
          min-width: 0;
        }
        .modeLabel {
          margin: 0 0 3px;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: .04em;
        }
        .dateLabel {
          font-size: 12px;
          color: #333;
        }
        .codeBox {
          min-width: 62px;
          padding: 5px 6px 4px;
          border: 1.5px solid #111;
          border-radius: 8px;
          text-align: center;
        }
        .codeCaption {
          margin: 0 0 2px;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: .16em;
          color: #444;
        }
        .codeValue {
          margin: 0;
          font-size: 24px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: .04em;
        }
        .divider {
          border-top: 1px dashed #bdbdbd;
          margin: 10px 0;
        }
        .section {
          margin-top: 10px;
        }
        .sectionTitle {
          margin: 0 0 8px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .line {
          margin: 0 0 6px;
          font-size: 13px;
          line-height: 1.45;
          word-break: break-word;
        }
        .line strong {
          font-weight: 800;
        }
        .item {
          padding: 0 0 11px;
          margin: 0 0 11px;
          border-bottom: 1px dashed #d2d2d2;
        }
        .item:last-child {
          border-bottom: 0;
          padding-bottom: 0;
          margin-bottom: 0;
        }
        .item-name {
          font-size: 15px;
          font-weight: 800;
          margin: 0 0 6px;
          line-height: 1.35;
          word-break: break-word;
        }
        .item-price {
          font-size: 14px;
          font-weight: 800;
          margin: 0 0 7px;
        }
        .item-extra {
          margin: 0 0 5px;
          font-size: 13px;
          line-height: 1.4;
          word-break: break-word;
        }
        .item-extra-title {
          margin-top: 2px;
          font-weight: 800;
        }
        .item-extra-list {
          padding-left: 10px;
        }
        .summary {
          border-top: 1px solid #111;
          border-bottom: 1px solid #111;
          padding: 8px 0 6px;
          margin-top: 2px;
        }
        .summaryLine {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin: 0 0 7px;
          font-size: 13px;
          line-height: 1.35;
        }
        .summaryLine span:first-child {
          flex: 1;
          min-width: 0;
        }
        .summaryLine strong {
          font-weight: 800;
        }
        .summaryTotal {
          margin-top: 3px;
          padding-top: 6px;
          border-top: 1px dashed #d2d2d2;
          font-size: 16px;
          font-weight: 900;
        }
        .paymentBox {
          padding-top: 2px;
        }
        .paymentLine {
          margin: 0 0 7px;
          font-size: 13px;
          line-height: 1.45;
          word-break: break-word;
        }
        .paymentMethod {
          font-weight: 800;
          text-transform: uppercase;
        }
        .note {
          margin-top: 9px;
          font-size: 11.5px;
          line-height: 1.45;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="topbar">
          <div class="modeBlock">
            <div class="modeLabel">${modeLabel}</div>
            <div class="dateLabel">${createdLabel}</div>
          </div>
          <div class="codeBox">
            <div class="codeCaption">PEDIDO</div>
            <div class="codeValue">${orderCode}</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sectionTitle">CLIENTE</div>
          <div class="line"><strong>Nome:</strong> ${customerName}</div>
          <div class="line"><strong>WhatsApp cliente:</strong> ${phone}</div>
          <div class="line"><strong>Endereço:</strong> ${address}</div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sectionTitle">ITENS DO PEDIDO</div>
          ${_renderComandaItemsHtml(order?.items)}
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sectionTitle">RESUMO</div>
          <div class="summary">
            <div class="summaryLine"><span>Subtotal</span><strong>${brl(totals.subtotal)}</strong></div>
            <div class="summaryLine"><span>Entrega</span><strong>${brl(totals.deliveryFee)}</strong></div>
            ${totals.discount > 0 ? `<div class="summaryLine"><span>Desconto</span><strong>-${brl(totals.discount)}</strong></div>` : ``}
            <div class="summaryLine summaryTotal"><span>Total</span><strong>${brl(totals.total)}</strong></div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section paymentBox">
          <div class="sectionTitle">PAGAMENTO</div>
          <div class="paymentLine paymentMethod">${paymentLabel}</div>
          ${pay.isCash ? `<div class="paymentLine"><strong>Troco:</strong> ${trocoText || 'Não precisa'}</div>` : ``}
          <div class="note">Confira os itens antes de finalizar o preparo</div>
        </div>
      </div>
    </body>
  </html>`;
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


/** ===== Upload de imagem (Branding: logo/capa) =====
 * Usa o mesmo Cloudinary do produto, mas salva em /branding
 */
async function uploadBrandImage(file, kind) {
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

  const safeKind = (kind === "logo") ? "logo" : "cover";
  const folder = `restaurants/${RESTAURANT_ID}/branding`;

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", folder);
  form.append("context", `alt=${encodeURIComponent(`${safeKind}-${file.name || "imagem"}`)}`);

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


function _deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function _mergePlanConfig(baseCfg, incoming) {
  const out = _deepClone(baseCfg || DEFAULT_MASTER_PLAN_CONFIG);
  const src = incoming && typeof incoming === "object" ? incoming : {};
  ["basic", "gold", "diamond"].forEach((tier) => {
    const item = src[tier] || {};
    out[tier] = out[tier] || { priceBRL: 0, features: {} };
    out[tier].priceBRL = Number(item.priceBRL ?? out[tier].priceBRL ?? 0) || 0;
    const incomingFeatures = item.features && typeof item.features === "object" ? item.features : {};
    out[tier].features = Object.assign({}, out[tier].features || {}, incomingFeatures);
  });
  return out;
}

function _mergeBillingConfig(baseCfg, incoming) {
  const out = Object.assign({}, baseCfg || DEFAULT_MASTER_BILLING_CONFIG);
  const src = incoming && typeof incoming === "object" ? incoming : {};
  out.platformName = String(src.platformName ?? out.platformName ?? "JPED").trim() || "JPED";
  out.signatureName = String(src.signatureName ?? out.signatureName ?? `Equipe ${out.platformName || 'JPED'}`).trim() || `Equipe ${out.platformName || 'JPED'}`;
  out.pixKey = String(src.pixKey ?? out.pixKey ?? "").trim();
  out.pixHolder = String(src.pixHolder ?? out.pixHolder ?? "").trim();
  out.supportWhatsapp = String(src.supportWhatsapp ?? out.supportWhatsapp ?? "").trim();
  out.supportEmail = String(src.supportEmail ?? out.supportEmail ?? "").trim();
  out.instructions = String(src.instructions ?? out.instructions ?? "").trim();
  return out;
}

async function loadPlatformPlanConfig() {
  try {
    const snap = await Firestore.getDoc(Firestore.doc(db, "restaurants", "_platform"));
    const data = snap.exists() ? (snap.data() || {}) : {};
    PLATFORM_PLAN_CONFIG = _mergePlanConfig(DEFAULT_MASTER_PLAN_CONFIG, data.masterPlans || {});
    PLATFORM_BILLING_CONFIG = _mergeBillingConfig(DEFAULT_MASTER_BILLING_CONFIG, data.masterBilling || {});
  } catch (e) {
    console.warn("Falha ao carregar configuração global de planos:", e?.code || e, e?.message || "");
    PLATFORM_PLAN_CONFIG = _deepClone(DEFAULT_MASTER_PLAN_CONFIG);
    PLATFORM_BILLING_CONFIG = _deepClone(DEFAULT_MASTER_BILLING_CONFIG);
  }
  try { renderMasterPlansEditor(); } catch (_) {}
  return PLATFORM_PLAN_CONFIG;
}

function getPlanConfigForTier(tier) {
  const key = String(tier || "basic").toLowerCase();
  return _mergePlanConfig(DEFAULT_MASTER_PLAN_CONFIG, PLATFORM_PLAN_CONFIG || {})[key] || _deepClone(DEFAULT_MASTER_PLAN_CONFIG.basic);
}

function restaurantHasFeature(feature, tier) {
  const cfg = getPlanConfigForTier(tier || SUBSCRIPTION_INFO?.tier || "basic");
  return !!cfg?.features?.[feature];
}

function applyRestaurantPlanVisibility() {
  const tier = SUBSCRIPTION_INFO?.tier || "basic";
  const buttons = Array.from(document.querySelectorAll("#panel .menuItem[data-page]"));
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    const page = btn.dataset.page;
    const allowed = restaurantHasFeature(page, tier);
    btn.classList.toggle("hidden", !allowed);
    btn.disabled = !allowed;
    btn.setAttribute("aria-hidden", allowed ? "false" : "true");
  });

  Array.from(document.querySelectorAll("#panel .page[id^='page-']")).forEach((section) => {
    const page = section.id.replace("page-", "");
    const allowed = restaurantHasFeature(page, tier);
    if (!allowed) section.classList.remove("active");
  });

  if (!restaurantHasFeature(ACTIVE_RESTAURANT_PAGE, tier)) {
    const fallback = ["orders", "products", "settings"].find((page) => restaurantHasFeature(page, tier)) || "orders";
    const btn = document.querySelector(`#panel .menuItem[data-page="${fallback}"]`);
    if (btn) btn.click();
  }
}

function setMasterPlansStatus(text, tone = "default") {
  if (!masterPlansRefs.status) return;
  masterPlansRefs.status.textContent = text;
  masterPlansRefs.status.style.borderColor = tone === "error" ? "rgba(239,68,68,.25)" : tone === "ok" ? "rgba(34,197,94,.25)" : "#e2e8f0";
  masterPlansRefs.status.style.background = tone === "error" ? "#fff1f2" : tone === "ok" ? "#f0fdf4" : "#f8fafc";
  masterPlansRefs.status.style.color = tone === "error" ? "#991b1b" : tone === "ok" ? "#166534" : "#334155";
}

function renderMasterPlansEditor() {
  if (!masterPlansRefs.cardsHost) return;
  const cfg = _mergePlanConfig(DEFAULT_MASTER_PLAN_CONFIG, PLATFORM_PLAN_CONFIG || {});
  const billingCfg = _mergeBillingConfig(DEFAULT_MASTER_BILLING_CONFIG, PLATFORM_BILLING_CONFIG || {});
  const labels = {
    orders: "Pedidos",
    products: "Produtos",
    finance: "Financeiro",
    customers: "Clientes",
    promos: "Promoções",
    settings: "Configurações"
  };

  masterPlansRefs.cardsHost.innerHTML = ["basic","gold","diamond"].map((tier) => {
    const item = cfg[tier] || {};
    const title = tier === "basic" ? "Basic" : tier === "gold" ? "Gold" : "Diamond";
    const features = item.features || {};
    const checks = Object.entries(labels).map(([key, label]) => `
      <label class="masterPlanCheck">
        <input type="checkbox" data-plan-tier="${tier}" data-plan-feature="${key}" ${features[key] ? "checked" : ""}/>
        <span>${label}</span>
      </label>
    `).join("");
    return `
      <article class="masterPlanCard plan-${tier}">
        <div class="masterPlanCardHead">
          <div>
            <div class="masterPlanTag">Plano ${title}</div>
            <div class="masterPlanName">${title}</div>
            <div class="masterPlanHint">Defina preço padrão e o que esse plano enxerga no painel do restaurante.</div>
          </div>
          <span class="masterPill plan-${tier}">${title}</span>
        </div>

        <div class="masterPlanPriceRow">
          <label class="masterField">
            <span>Preço mensal padrão (R$)</span>
            <input class="input" type="number" step="0.01" min="0" data-plan-tier="${tier}" data-plan-price value="${Number(item.priceBRL || 0)}" />
          </label>
        </div>

        <div class="masterPlanChecks">
          ${checks}
        </div>
      </article>
    `;
  }).join("");

  if (masterPlansRefs.pixKey) masterPlansRefs.pixKey.value = billingCfg.pixKey || "";
  if (masterPlansRefs.pixHolder) masterPlansRefs.pixHolder.value = billingCfg.pixHolder || "";
  if (masterPlansRefs.supportWhatsapp) masterPlansRefs.supportWhatsapp.value = billingCfg.supportWhatsapp || "";
  if (masterPlansRefs.supportEmail) masterPlansRefs.supportEmail.value = billingCfg.supportEmail || "";
  if (masterPlansRefs.instructions) masterPlansRefs.instructions.value = billingCfg.instructions || "";
}

function getMasterPlansPayloadFromUI() {
  const out = _deepClone(DEFAULT_MASTER_PLAN_CONFIG);
  ["basic","gold","diamond"].forEach((tier) => {
    const priceInput = document.querySelector(`[data-plan-tier="${tier}"][data-plan-price]`);
    out[tier].priceBRL = Number(priceInput?.value || out[tier].priceBRL || 0) || 0;
    Object.keys(out[tier].features).forEach((feature) => {
      const check = document.querySelector(`[data-plan-tier="${tier}"][data-plan-feature="${feature}"]`);
      out[tier].features[feature] = !!check?.checked;
    });
  });
  return out;
}

function getMasterBillingPayloadFromUI() {
  return _mergeBillingConfig(DEFAULT_MASTER_BILLING_CONFIG, {
    pixKey: masterPlansRefs.pixKey?.value || "",
    pixHolder: masterPlansRefs.pixHolder?.value || "",
    supportWhatsapp: masterPlansRefs.supportWhatsapp?.value || "",
    supportEmail: masterPlansRefs.supportEmail?.value || "",
    instructions: masterPlansRefs.instructions?.value || ""
  });
}

async function saveMasterPlansConfig() {
  try {
    const payload = getMasterPlansPayloadFromUI();
    const billingPayload = getMasterBillingPayloadFromUI();
    await Firestore.setDoc(Firestore.doc(db, "restaurants", "_platform"), {
      name: "_platform",
      type: "platform_settings",
      masterPlans: payload,
      masterBilling: billingPayload,
      updatedAt: Firestore.serverTimestamp()
    }, { merge: true });
    PLATFORM_PLAN_CONFIG = _mergePlanConfig(DEFAULT_MASTER_PLAN_CONFIG, payload);
    PLATFORM_BILLING_CONFIG = _mergeBillingConfig(DEFAULT_MASTER_BILLING_CONFIG, billingPayload);
    setMasterPlansStatus("Planos e cobrança salvos com sucesso.", "ok");
    applyRestaurantPlanVisibility();
  } catch (e) {
    console.error("Erro ao salvar configuração global de planos:", e?.code || e, e?.message || "");
    setMasterPlansStatus("Não foi possível salvar os planos. Verifique as permissões do Firestore.", "error");
  }
}

function showMasterTab(which = "restaurants") {
  const isPlans = which === "plans";
  masterPlansRefs.tabRestaurants?.classList.toggle("is-active", !isPlans);
  masterPlansRefs.tabPlans?.classList.toggle("is-active", isPlans);
  masterPlansRefs.pageRestaurants?.classList.toggle("hidden", isPlans);
  masterPlansRefs.pagePlans?.classList.toggle("hidden", !isPlans);
  if (isPlans) {
    renderMasterPlansEditor();
  }
}

function bindMasterTabs() {
  if (masterPlansRefs.tabRestaurants && masterPlansRefs.tabRestaurants.dataset.boundMasterTabs !== "1") {
    masterPlansRefs.tabRestaurants.dataset.boundMasterTabs = "1";
    masterPlansRefs.tabRestaurants.addEventListener("click", () => showMasterTab("restaurants"));
  }
  if (masterPlansRefs.tabPlans && masterPlansRefs.tabPlans.dataset.boundMasterTabs !== "1") {
    masterPlansRefs.tabPlans.dataset.boundMasterTabs = "1";
    masterPlansRefs.tabPlans.addEventListener("click", () => showMasterTab("plans"));
  }
  if (masterPlansRefs.saveBtn && masterPlansRefs.saveBtn.dataset.boundMasterPlans !== "1") {
    masterPlansRefs.saveBtn.dataset.boundMasterPlans = "1";
    masterPlansRefs.saveBtn.addEventListener("click", saveMasterPlansConfig);
  }
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

openSignupBtn?.addEventListener("click", async () => {
  await refreshPublicSignupPlans();
  showAuthSubView("signup");
});
backToLoginBtn?.addEventListener("click", () => showAuthSubView("login"));
pendingBackToLoginBtn?.addEventListener("click", () => showAuthSubView("login"));
signupFormEl?.addEventListener("submit", handleRestaurantSignup);
refreshPublicSignupPlans();

async function logoutEverywhere() {
  if (unsubOrders) unsubOrders();
  try { _stopProductsListener(); } catch (_) {}
  if (MASTER_UNSUB_RESTAURANTS) { try { MASTER_UNSUB_RESTAURANTS(); } catch (_) {} }
  await Auth.signOut(auth);
  location.reload();
}

document.getElementById("logoutBtn").onclick = logoutEverywhere;
if (masterRefs.logoutBtn) masterRefs.logoutBtn.onclick = logoutEverywhere;

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
    await loadPlatformPlanConfig();
    applyRestaurantPlanVisibility();

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




let __JPED_AUTO_PRINT_LOCK = new Set();

function _isOrderPaidForKitchen(order) {
  const pay = _normalizeAdminPayment(order);
  return !!pay?.pixPaid;
}

async function _fetchOrderById(orderId) {
  const privateRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId);
  const publicRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_public", orderId);

  let publicData = null;
  let privateData = null;

  try {
    const snap = await Firestore.getDoc(publicRef);
    if (snap.exists()) publicData = { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn("Falha ao buscar pedido público:", e?.code || e, e?.message || "");
  }

  try {
    const snap = await Firestore.getDoc(privateRef);
    if (snap.exists()) privateData = { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn("Falha ao buscar pedido privado:", e?.code || e, e?.message || "");
  }

  if (!publicData && !privateData) return null;

  const merged = {
    ...(publicData || {}),
    ...(privateData || {})
  };

  merged.id = orderId;
  merged.customer = {
    ...((publicData && publicData.customer) || {}),
    ...((privateData && privateData.customer) || {})
  };
  merged.checkout = {
    ...((publicData && publicData.checkout) || {}),
    ...((privateData && privateData.checkout) || {})
  };

  const publicItems = Array.isArray(publicData?.items) ? publicData.items : [];
  const privateItems = Array.isArray(privateData?.items) ? privateData.items : [];
  merged.items = privateItems.length ? privateItems : publicItems;

  const publicTotals = publicData?.totals && typeof publicData.totals === "object" ? publicData.totals : {};
  const privateTotals = privateData?.totals && typeof privateData.totals === "object" ? privateData.totals : {};
  merged.totals = { ...publicTotals, ...privateTotals };

  return merged;
}

async function _markOrderPrinted(orderId, extra = {}) {
  const payload = { kitchenPrintedAt: Firestore.serverTimestamp(), ...extra };
  const refs = [
    Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_public", orderId),
    Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId)
  ];

  for (const ref of refs) {
    try {
      await Firestore.setDoc(ref, payload, { merge: true });
    } catch (e) {
      console.warn("Falha ao marcar impressão da comanda:", e?.code || e, e?.message || "");
    }
  }
}

async function printOrderComanda(orderOrId, options = {}) {
  const orderId = typeof orderOrId === "string" ? orderOrId : orderOrId?.id;
  const order = orderId ? await _fetchOrderById(orderId) : null;
  if (!order?.id) throw new Error("Pedido não encontrado para impressão.");

  const html = _buildComandaHtml(order);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  await new Promise((resolve, reject) => {
    const win = iframe.contentWindow;
    if (!win) {
      reject(new Error("Janela de impressão indisponível."));
      return;
    }

    const done = () => {
      setTimeout(() => {
        try { iframe.remove(); } catch (_) {}
      }, 1500);
      resolve();
    };

    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          done();
        } catch (err) {
          reject(err);
        }
      }, 300);
    } catch (err) {
      reject(err);
    }
  });

  await _markOrderPrinted(order.id, options.auto ? { kitchenAutoPrintedAt: Firestore.serverTimestamp() } : {});
}

async function _maybeAutoPrintOrder(order) {
  const orderId = order?.id;
  if (!orderId || __JPED_AUTO_PRINT_LOCK.has(orderId)) return;
  if (String(order?.status || "").trim().toLowerCase() !== "em_preparo") return;
  if (order?.kitchenAutoPrintedAt) return;

  __JPED_AUTO_PRINT_LOCK.add(orderId);
  try {
    await printOrderComanda(order, { auto: true });
  } catch (e) {
    console.warn("Falha ao imprimir comanda automática:", e?.code || e, e?.message || "");
  } finally {
    setTimeout(() => __JPED_AUTO_PRINT_LOCK.delete(orderId), 3000);
  }
}

async function _syncPaidOrderToKitchen(order) {
  if (!order?.id) return;
  const status = String(order?.status || "").trim().toLowerCase();
  if (!_isOrderPaidForKitchen(order)) return;
  if (["em_preparo", "saiu_pra_entrega", "entregue", "cancelado"].includes(status)) return;

  try {
    await setOrderStatus(order.id, "em_preparo", { autoTriggered: true });
  } catch (e) {
    console.warn("Falha ao mover pedido pago para em_preparo:", e?.code || e, e?.message || "");
  }
}


/** Atualiza status do pedido */
async function setOrderStatus(orderId, newStatus, options = {}) {
  if (!SUBSCRIPTION_OK) {
    alert("Assinatura expirada. Ative um plano para mudar status.");
    return;
  }

  if (!ADMIN_OK) {
    await checkAdminAccess();
    if (!ADMIN_OK) {
      alert("Sem permissão de admin. Confira o RID/UID no topo.");
      return;
    }
  }

  const privateRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders", orderId);
  const publicRef  = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_public", orderId);
  const historyRef = Firestore.doc(db, "restaurants", RESTAURANT_ID, "orders_history", orderId);

  const payload = {
    status: newStatus,
    updatedAt: Firestore.serverTimestamp()
  };

  // (mantém sua compatibilidade de opções se existir)
  try {
    payload.sizes = _readOptList(sizesBox);
    payload.addons = _readOptList(addonsBox);
  } catch (_) {
    // não força limpar, só ignora se não existir no contexto
  }

  // 1) Atualiza orders_public (cliente acompanha)
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

  // 2) Atualiza orders (privado)
  try {
    await Firestore.updateDoc(privateRef, payload);
  } catch (e) {
    console.warn("Sem permissão para atualizar orders:", e?.code || e, e?.message || "");
  }

  // 3) Se for ENTREGUE: arquiva no histórico, MAS NÃO DELETA (não some hoje)
  if (newStatus === "entregue") {
    try {
      // tenta pegar dados do privado, se não der pega do público
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
      console.warn("Falha ao arquivar em orders_history:", e?.code || e, e?.message || "");
      // não bloqueia a entrega (status já foi salvo), só avisa no console
    }
  }

  if (!publicOk) {
    console.warn("ATENÇÃO: status não foi gravado em orders_public; o cliente não vai ver a mudança.");
  }

  if (newStatus === "em_preparo") {
    try {
      const latestOrder = await _fetchOrderById(orderId);
      await _maybeAutoPrintOrder(latestOrder || { id: orderId, status: "em_preparo" });
    } catch (e) {
      console.warn("Falha ao disparar impressão automática:", e?.code || e, e?.message || "");
    }
  }
}


/** ===== Ações dos botões (delegação) ===== */
(function _wireOrderButtons(){
  if (window.__JPED_WIRE_BTNS) return;
  window.__JPED_WIRE_BTNS = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act][data-id]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const orderId = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");

    try {
      if (act === "reprint") {
        await printOrderComanda(orderId, { auto: false });
        return;
      }
      await setOrderStatus(orderId, act);
    } catch (err) {
      console.error(err);
      alert(act === "reprint" ? "Erro ao reimprimir comanda. Veja o console (F12)." : "Erro ao mudar status. Veja o console (F12).");
    }
  });
})();

/** Renderiza pedidos */
function renderOrders(list) {
  // containers das colunas
  const prepEl = document.getElementById("orders-prep");
  const outEl = document.getElementById("orders-out");
  const doneEl = document.getElementById("orders-done");
  const canceledEl = document.getElementById("orders-canceled");

  // fallback antigo (caso o HTML ainda esteja no formato antigo)
  const legacyWrap = document.getElementById("orders");

  const clear = (el) => { if (el) el.innerHTML = ""; };

  clear(prepEl); clear(outEl); clear(doneEl); clear(canceledEl);
  if (legacyWrap && !prepEl && !outEl && !doneEl && !canceledEl) legacyWrap.innerHTML = "";

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
  function bucketStatus(s, paymentStatus) {
    const pay = String(paymentStatus || "").toLowerCase();
    if (s === "aguardando_pagamento") return "aguardando_pagamento";
    if (pay && pay !== "approved") return "aguardando_pagamento";
    // pedido novo pode vir "recebido" (ou vazio) => em_preparo
    if (!s || s === "recebido" || s === "em_preparo") return "em_preparo";
    if (s === "saiu_pra_entrega") return "saiu_pra_entrega";
    if (s === "entregue") return "entregue";
    if (s === "cancelado") return "cancelado";
    return "em_preparo";
  }

  function hostFor(status) {
    if (!prepEl && !outEl && !doneEl && !canceledEl) return legacyWrap;
    if (status === "saiu_pra_entrega") return outEl;
    if (status === "entregue") return doneEl;
    if (status === "cancelado") return canceledEl;
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

    const col = bucketStatus(o.status, o.paymentStatus);
    if (col === "aguardando_pagamento") {
      continue;
    }

    // botões por coluna (pedido novo vai pra em_preparo)
    let actions = "";
    if (col === "em_preparo") {
      actions = `
        <button class="btn small" data-act="saiu_pra_entrega" data-id="${o.id}">Despachar</button>
        <button class="ghost small" data-act="reprint" data-id="${o.id}">Reimprimir comanda</button>
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      `;
    } else if (col === "saiu_pra_entrega") {
      actions = `
        <button class="btn small" data-act="entregue" data-id="${o.id}">Entregue</button>
        <button class="ghost small" data-act="reprint" data-id="${o.id}">Reimprimir comanda</button>
        <button class="ghost small danger" data-act="cancelado" data-id="${o.id}">Cancelar</button>
      `;
    } else if (col === "entregue") {
      // entregue: apenas informações, sem botões
      actions = "";
    } else if (col === "cancelado") {
      // cancelado: apenas informações, sem botões
      actions = "";
    } else {
      actions = "";
    }

    
const createdMs = _tsToMs(o.createdAt) || Date.now();
const ageMs = Date.now() - createdMs;
const late = ageMs >= 20 * 60 * 1000;

div.dataset.id = o.id;

    const paymentView = getAdminPaymentPresentation(o);
    const paymentChangeText = getAdminChangeText(o, o?.totals?.total ?? o?.checkout?.total ?? o?.total ?? o?.amount ?? 0);

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
    <div class="paymentChip ${paymentView.chipClass}">${paymentView.text}</div>
    ${paymentChangeText ? `<div class="paymentMeta">${paymentChangeText}</div>` : ``}
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
    <div class="orderModalScrim" id="orderModalScrim"></div>

    <div class="orderModalContent" role="dialog" aria-modal="true" aria-label="Detalhes do pedido">
      <div class="orderModalShell">
        <div class="modalHeader modalHeaderSide">
          <div>
            <div class="modalEyebrow">Detalhes do pedido</div>
            <div class="modalOrderNum" id="modalOrderNum">#----</div>
            <div class="modalCustomer" id="modalCustomer">Cliente</div>
            <div class="modalMeta" id="modalMeta"></div>
          </div>
          <button type="button" class="modalClose modalCloseText" id="orderModalClose" aria-label="Fechar">Fechar</button>
        </div>

        <div class="modalSection">
          <div class="modalTitle">Itens</div>
          <div class="modalItems" id="modalItems"></div>
        </div>

        <div class="modalSection">
          <div class="modalTitle">Entrega</div>
          <div class="modalInfo" id="modalDelivery"></div>
        </div>

        <div class="modalSection modalSectionCompact">
          <button type="button" class="modalChatBtn" id="modalOpenChat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
            <span>Abrir chat</span>
            <span class="chatFabBadge hidden" id="chatFabBadge">0</span>
          </button>
        </div>
      </div>

      <div class="chatDrawerBackdrop hidden" id="chatDrawerBackdrop" aria-hidden="true"></div>

      <aside class="chatDrawer hidden" id="chatDrawer" aria-label="Chat do pedido">
        <div class="chatDrawerHead">
          <div class="chatDrawerTitle">Chat do pedido</div>
          <button type="button" class="chatDrawerClose" id="chatDrawerClose" aria-label="Fechar chat">
            Fechar
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
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => closeOrderModal();
  const scrim = modal.querySelector("#orderModalScrim");
  const content = modal.querySelector(".orderModalContent");
  if (scrim) scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) close();
  });
  if (content) {
    content.addEventListener("click", (ev) => ev.stopPropagation());
    content.addEventListener("mousedown", (ev) => ev.stopPropagation());
    content.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  }
  modal.querySelector("#orderModalClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // ===== Chat drawer (interno ao painel lateral) =====
  const openChatBtn = modal.querySelector("#modalOpenChat");
  const drawer = modal.querySelector("#chatDrawer");
  const back = modal.querySelector("#chatDrawerBackdrop");
  const btnCloseChat = modal.querySelector("#chatDrawerClose");

  const openChat = () => {
    if (!drawer || !back) return;
    drawer.classList.remove("hidden");
    back.classList.remove("hidden");
    modal.classList.add("chatOpen");
    document.body.classList.add("order-chat-open");
    const bd = modal.querySelector("#chatFabBadge");
    if (bd) { bd.textContent = "0"; bd.classList.add("hidden"); }

    try{
      const input = modal.querySelector("#modalChatText");
      if (input) setTimeout(() => input.focus(), 0);
    }catch(_){}
  };
  const closeChat = () => {
    if (!drawer || !back) return;
    drawer.classList.add("hidden");
    back.classList.add("hidden");
    modal.classList.remove("chatOpen");
    document.body.classList.remove("order-chat-open");
  };

  modal.__closeChat = closeChat;

  if (openChatBtn) openChatBtn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openChat(); });
  if (btnCloseChat) btnCloseChat.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); closeChat(); });
  if (drawer) {
    drawer.addEventListener("click", (ev) => ev.stopPropagation());
    drawer.addEventListener("mousedown", (ev) => ev.stopPropagation());
    drawer.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  }
  if (back) back.addEventListener("click", (ev) => {
    if (ev.target === back) closeChat();
  });

  return modal;
}

function closeOrderModal(){
  const modal = document.getElementById("orderModal");
  if (!modal) return;
  try { if (modal.__closeChat) modal.__closeChat(); } catch (_) {}
  modal.classList.add("hidden");
  document.body.classList.remove("order-side-open", "order-chat-open");
  __JPED_OPEN_ORDER_ID = null;
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
  const totalsSummary = _getOrderTotalsSummary(data);
  const subtotal = totalsSummary.subtotal;
  const total = totalsSummary.total;
  const paymentView = getAdminPaymentPresentation(data);
  const paymentLabel = paymentView.text;
  const trocoLabel = getAdminChangeText(data, total);

  modal.querySelector("#modalOrderNum").textContent = `#${orderNum}`;
  modal.querySelector("#modalCustomer").textContent = customerName;
  modal.querySelector("#modalMeta").textContent = `${statusLabel(status)} • ${brl(total)}`;

  const items = Array.isArray(data.items) ? data.items : [];
  modal.querySelector("#modalItems").innerHTML = _renderOrderItemsDetailed(items);

  modal.querySelector("#modalDelivery").innerHTML = `
    <div><strong>Status:</strong> ${statusLabel(status)}</div>
    <div style="margin-top:6px"><strong>Subtotal:</strong> ${brl(subtotal)}</div>
    ${totalsSummary.discount > 0 ? `<div style="margin-top:6px"><strong>Desconto:</strong> -${brl(totalsSummary.discount)}</div>` : ''}
    ${totalsSummary.deliveryFee > 0 ? `<div style="margin-top:6px"><strong>Entrega:</strong> ${brl(totalsSummary.deliveryFee)}</div>` : ''}
    <div style="margin-top:6px"><strong>Total:</strong> ${brl(total)}</div>
    <div style="margin-top:6px"><strong>Pagamento:</strong> ${paymentLabel}</div>
    ${paymentView.chipClass === 'cash' ? `<div style="margin-top:6px"><strong>Troco:</strong> ${trocoLabel}</div>` : ''}
    <div style="margin-top:6px"><strong>Whats:</strong> ${phone}</div>
    <div style="margin-top:6px"><strong>Endereço:</strong> ${address}</div>
  `;

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
  document.body.classList.add("order-side-open");
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
let __JPED_MIDNIGHT_TIMER = null;

function _msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1); // 00:00:01
  return Math.max(1000, next.getTime() - now.getTime());
}

function startOrdersListener() {
  if (!RESTAURANT_ID) {
    console.warn("RESTAURANT_ID vazio; não iniciou listener.");
    return;
  }

  // limpa listener anterior
  if (unsubOrders) {
    try { unsubOrders(); } catch (_) {}
    unsubOrders = null;
  }

  // limpa timer anterior
  if (__JPED_MIDNIGHT_TIMER) {
    try { clearTimeout(__JPED_MIDNIGHT_TIMER); } catch (_) {}
    __JPED_MIDNIGHT_TIMER = null;
  }

  const ref = Firestore.collection(db, "restaurants", RESTAURANT_ID, "orders_public");

  // 🔥 início do dia (00:00:00) como Timestamp do Firestore
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const startTs = Firestore.Timestamp.fromDate(startOfDay);

  const q = Firestore.query(
    ref,
    Firestore.where("createdAt", ">=", startTs),
    Firestore.orderBy("createdAt", "desc")
  );

  unsubOrders = Firestore.onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      for (const order of list) {
        _syncPaidOrderToKitchen(order);
        _maybeAutoPrintOrder(order);
      }
      renderOrders(list);
      _startTimeBadges();
    },
    (err) => {
      console.error("Erro no listener de pedidos (snapshot):", err?.code || err, err?.message || "");
    }
  );

  // reinicia quando virar o dia (aí os de ontem somem)
  __JPED_MIDNIGHT_TIMER = setTimeout(() => {
    startOrdersListener();
  }, _msUntilNextMidnight());
}

function _masterNormalizeStatus(v) {
  return String(v || "active").trim().toLowerCase() || "active";
}

function _masterNormalizeTier(v) {
  const tier = String(v || "basic").trim().toLowerCase();
  return ["basic","gold","diamond"].includes(tier) ? tier : "basic";
}

function _dateInputValueFromAny(v) {
  if (!v) return "";
  try {
    let d = null;
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    } else if (typeof v === "number") {
      d = new Date(v);
    } else if (v?.toDate) {
      d = v.toDate();
    }
    if (!d || Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch (_) { return ""; }
}

function _tsFromDateInput(dateStr, endOfDay = false) {
  if (!dateStr) return null;
  const iso = endOfDay ? `${dateStr}T23:59:59` : `${dateStr}T12:00:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Firestore.Timestamp.fromDate(d);
}

function isMasterUser(user, userData = null) {
  const email = String(user?.email || "").trim().toLowerCase();
  const allowedEmails = PLATFORM_OWNER_EMAILS.map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
  if (email && allowedEmails.includes(email)) return true;

  const data = userData || {};
  const role = String(data.role || data.platformRole || "").trim().toLowerCase();
  if (["super_admin","platform_admin","master"].includes(role)) return true;
  if (data.platformOwner === true) return true;
  return false;
}

function showOnlyPanel(which) {
  loginScreenEl.classList.add("hidden");
  if (panelEl) panelEl.classList.add("hidden");
  if (masterPanelEl) masterPanelEl.classList.add("hidden");
  if (which === "restaurant" && panelEl) panelEl.classList.remove("hidden");
  if (which === "master" && masterPanelEl) {
    masterPanelEl.classList.remove("hidden");
    bindMasterTabs();
    showMasterTab("restaurants");
  }
}

function masterLabelStatus(v) {
  const map = {
    active: "Ativo",
    trial: "Trial",
    expired: "Expirado",
    overdue: "Atrasado",
    canceled: "Cancelado"
  };
  const key = _masterNormalizeStatus(v);
  return map[key] || key || "-";
}

function _masterGetRestaurantSummary(item) {

  const plan = item.plan || {};
  const billing = item.billing || {};
  const tier = _masterNormalizeTier(plan.tier || billing.tier);
  const status = _masterNormalizeStatus(plan.status || billing.status);
  const monthlyPrice = Number(billing.monthlyPriceBRL ?? plan.priceBRL ?? 0) || 0;
  const dueDay = Number(billing.dueDay ?? plan.dueDay ?? 0) || 0;
  const paidAt = billing.paidAt || plan.paidAt || null;
  const expiresAt = billing.expiresAt || plan.expiresAt || null;
  const trialEndsAt = plan.trialEndsAt || null;
  const contact = billing.contact || item.contact || item.phone || item.whatsapp || "";
  const billingEmail = billing.billingEmail || item.email || "";
  const notes = billing.notes || "";
  return { tier, status, monthlyPrice, dueDay, paidAt, expiresAt, trialEndsAt, contact, billingEmail, notes };
}


function _pendingToMillis(v) {
  return tsToMillis(v);
}

function _pendingSignupSummary(item) {
  const onboarding = item?.onboarding || {};
  const requestedPlan = _masterNormalizeTier(item?.requestedPlan || onboarding?.planTier || "gold");
  const planCfg = getPlanConfigForTier(requestedPlan);
  return {
    uid: item.id || "",
    ownerName: String(item?.name || onboarding?.ownerName || "").trim(),
    restaurantName: String(item?.requestedRestaurantName || onboarding?.restaurantName || "").trim(),
    email: String(item?.email || "").trim(),
    phone: String(item?.phone || onboarding?.phone || "").trim(),
    notes: String(onboarding?.notes || "").trim(),
    planTier: requestedPlan,
    priceBRL: Number(item?.requestedPriceBRL ?? planCfg?.priceBRL ?? 0) || 0,
    createdAt: onboarding?.createdAt || item?.createdAt || item?.updatedAt || null
  };
}


function _getMasterBillingConfig() {
  return _mergeBillingConfig(DEFAULT_MASTER_BILLING_CONFIG, PLATFORM_BILLING_CONFIG || {});
}

function _buildBillingEmailPayload(ctx = {}) {
  const billing = _getMasterBillingConfig();
  const restaurantName = String(ctx.restaurantName || "seu restaurante").trim();
  const ownerName = String(ctx.ownerName || "").trim();
  const tier = _masterNormalizeTier(ctx.planTier || "gold");
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const monthlyPrice = Number(ctx.priceBRL || 0) || 0;
  const dueDay = Number(ctx.dueDay || 0) || 0;
  const dueText = dueDay ? `dia ${dueDay}` : "conforme combinado";
  const pixKey = billing.pixKey || "[preencha a chave PIX]";
  const pixHolder = billing.pixHolder || "[preencha o favorecido]";
  const supportWhatsapp = billing.supportWhatsapp || "";
  const supportEmail = billing.supportEmail || "";
  const notes = String(ctx.notes || "").trim();
  const platformName = String(billing.platformName || "JPED").trim() || "JPED";
  const signatureName = String(billing.signatureName || `Equipe ${platformName}`).trim() || `Equipe ${platformName}`;
  const customInstructions = String(billing.instructions || "").trim();

  const subject = ctx.isPending
    ? `Ativação da sua assinatura — ${tierLabel} | ${restaurantName}`
    : `Renovação da sua assinatura — ${tierLabel} | ${restaurantName}`;

  const greeting = ownerName ? `Olá, ${ownerName}!` : `Olá, ${restaurantName}!`;
  const lines = [greeting, ""];

  if (ctx.isPending) {
    lines.push("Seu cadastro foi recebido e o seu acesso ao painel está pronto para ativação.");
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("DADOS DA ASSINATURA");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push(`Plano contratado: ${tierLabel}`);
    lines.push(`Valor mensal: ${brl(monthlyPrice)}`);
    lines.push(`Vencimento: ${dueText}`);
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("PAGAMENTO VIA PIX");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push(`Chave PIX: ${pixKey}`);
    lines.push(`Favorecido: ${pixHolder}`);
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("IMPORTANTE");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("Para ativarmos o seu plano, é necessário enviar o comprovante de pagamento após a transferência.");
    lines.push("Sem o comprovante, a ativação não será concluída.");
  } else {
    lines.push("Segue a cobrança referente à renovação da sua assinatura no painel.");
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("RESUMO DA RENOVAÇÃO");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push(`Plano atual: ${tierLabel}`);
    lines.push(`Valor da mensalidade: ${brl(monthlyPrice)}`);
    lines.push(`Vencimento: ${dueText}`);
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("PAGAMENTO VIA PIX");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push(`Chave PIX: ${pixKey}`);
    lines.push(`Favorecido: ${pixHolder}`);
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("CONFIRMAÇÃO NECESSÁRIA");
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("Após o pagamento, envie o comprovante para que a renovação seja confirmada e o plano continue ativo sem interrupções.");
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("ENVIO DO COMPROVANTE");
  lines.push("━━━━━━━━━━━━━━━━━━");
  if (supportWhatsapp) lines.push(`WhatsApp: ${supportWhatsapp}`);
  if (supportEmail) lines.push(`E-mail: ${supportEmail}`);
  lines.push("Você também pode responder este email com o comprovante em anexo.");

  if (customInstructions) {
    lines.push("");
    lines.push(customInstructions);
  }

  if (notes) {
    lines.push("");
    lines.push(`Observações: ${notes}`);
  }

  lines.push("");
  lines.push("Assim que recebermos a confirmação, seguimos com a liberação do acesso ou com a manutenção do plano.");
  lines.push("");
  lines.push("Atenciosamente,");
  lines.push(signatureName);

return { subject, body: lines.join("\n") };
}

async function _copyBillingEmailFallback(payload) {
  const text = `Assunto: ${payload.subject}\n\n${payload.body}`;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

async function openBillingEmailForPending(uid) {
  const item = MASTER_PENDING_CACHE.find(v => v.id === uid);
  if (!item) return;
  const s = _pendingSignupSummary(item);
  const payload = _buildBillingEmailPayload({
    restaurantName: s.restaurantName,
    ownerName: s.ownerName,
    planTier: s.planTier,
    priceBRL: s.priceBRL,
    dueDay: 5,
    notes: s.notes,
    isPending: true
  });

  if (!s.email) {
    const copied = await _copyBillingEmailFallback(payload);
    setMasterDrawerStatus(copied
      ? "Cadastro sem email. Texto da cobrança copiado para a área de transferência."
      : "Cadastro sem email. Defina um email para disparar a cobrança.", copied ? "ok" : "error");
    return;
  }

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${encodeURIComponent(s.email)}&su=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
  const win = window.open(gmailUrl, '_blank', 'noopener');
  if (!win) {
    const mailto = `mailto:${encodeURIComponent(s.email)}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    window.location.href = mailto;
  }
  setMasterDrawerStatus(`Rascunho de cobrança aberto para ${s.restaurantName || "restaurante"}.`, "ok");
}

async function openBillingEmailForRestaurant(id) {
  const item = MASTER_RESTAURANTS_CACHE.find(v => v.id === id);
  if (!item) return;
  const s = _masterGetRestaurantSummary(item);
  const payload = _buildBillingEmailPayload({
    restaurantName: item.name || "Restaurante",
    ownerName: "",
    planTier: s.tier,
    priceBRL: s.monthlyPrice,
    dueDay: s.dueDay,
    notes: s.notes,
    isPending: false
  });

  if (!s.billingEmail) {
    const copied = await _copyBillingEmailFallback(payload);
    setMasterDrawerStatus(copied
      ? "Restaurante sem email financeiro. Texto da cobrança copiado para a área de transferência."
      : "Restaurante sem email financeiro. Preencha o email no cadastro.", copied ? "ok" : "error");
    return;
  }

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${encodeURIComponent(s.billingEmail)}&su=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
  const win = window.open(gmailUrl, '_blank', 'noopener');
  if (!win) {
    const mailto = `mailto:${encodeURIComponent(s.billingEmail)}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    window.location.href = mailto;
  }
  setMasterDrawerStatus(`Rascunho de cobrança aberto para ${item.name || "restaurante"}.`, "ok");
}

function renderMasterPendingTable() {
  if (!masterPendingRefs.body) return;
  const list = [...MASTER_PENDING_CACHE].sort((a,b) => (_pendingToMillis(_pendingSignupSummary(b).createdAt)||0) - (_pendingToMillis(_pendingSignupSummary(a).createdAt)||0));
  if (masterPendingRefs.count) masterPendingRefs.count.textContent = `${list.length} pendente${list.length === 1 ? "" : "s"}`;
  if (masterPendingRefs.statPending) masterPendingRefs.statPending.textContent = String(list.length);
  if (!list.length) {
    masterPendingRefs.body.innerHTML = "";
    masterPendingRefs.empty?.classList.remove("hidden");
    return;
  }
  masterPendingRefs.empty?.classList.add("hidden");
  masterPendingRefs.body.innerHTML = list.map((item) => {
    const s = _pendingSignupSummary(item);
    const created = _fmtDateTime(s.createdAt);
    return `
      <tr>
        <td>
          <div class="masterRestaurantCell">
            <strong>${_escapeHtml(s.restaurantName || "Sem nome")}</strong>
            <small>${_escapeHtml(s.ownerName || "Sem responsável")}</small>
          </div>
        </td>
        <td>${_escapeHtml(s.email || "—")}</td>
        <td>${_escapeHtml(s.phone || "—")}</td>
        <td><span class="masterPlanBadge is-${s.planTier}">${s.planTier.toUpperCase()}</span></td>
        <td>${brl(s.priceBRL || 0)}</td>
        <td>${created || "—"}</td>
        <td>
          <div class="masterActions">
            <button class="ghost small" type="button" data-billing-pending="${_escapeHtml(s.uid)}">Email cobrança</button>
            <button class="btn small" type="button" data-activate-signup="${_escapeHtml(s.uid)}">Ativar restaurante</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  masterPendingRefs.body.querySelectorAll('[data-activate-signup]').forEach((btn) => {
    btn.addEventListener('click', () => activatePendingSignup(btn.getAttribute('data-activate-signup') || ''));
  });
  masterPendingRefs.body.querySelectorAll('[data-billing-pending]').forEach((btn) => {
    btn.addEventListener('click', () => openBillingEmailForPending(btn.getAttribute('data-billing-pending') || ''));
  });
}

async function activatePendingSignup(uid) {
  const item = MASTER_PENDING_CACHE.find(v => v.id === uid);
  if (!item) return;
  const s = _pendingSignupSummary(item);
  const confirmed = window.confirm(`Ativar ${s.restaurantName || 'este restaurante'} no plano ${s.planTier.toUpperCase()}?`);
  if (!confirmed) return;

  try {
    setMasterDrawerStatus(`Ativando ${s.restaurantName || 'restaurante'}...`);
    const planCfg = getPlanConfigForTier(s.planTier);
    const monthlyPrice = Number(s.priceBRL || planCfg?.priceBRL || 0) || 0;
    const restaurantPayload = {
      name: s.restaurantName || s.ownerName || 'Novo restaurante',
      createdAt: Firestore.serverTimestamp(),
      updatedAt: Firestore.serverTimestamp(),
      billing: {
        contact: s.phone || '',
        billingEmail: s.email || '',
        monthlyPriceBRL: monthlyPrice,
        dueDay: 5,
        paidAt: null,
        expiresAt: null,
        notes: s.notes || '',
        status: 'active'
      },
      plan: {
        tier: s.planTier,
        status: 'active',
        priceBRL: monthlyPrice,
        paidAt: null,
        expiresAt: null,
        trialEndsAt: null
      }
    };

    const restaurantRef = await Firestore.addDoc(Firestore.collection(db, 'restaurants'), restaurantPayload);
    await Firestore.setDoc(Firestore.doc(db, 'users', uid), {
      restaurantId: restaurantRef.id,
      role: 'owner',
      signupStatus: 'active',
      requestedPlan: s.planTier,
      activatedAt: Firestore.serverTimestamp(),
      activationSource: 'master_panel',
      updatedAt: Firestore.serverTimestamp()
    }, { merge: true });

    setMasterDrawerStatus(`Restaurante ativado no plano ${s.planTier.toUpperCase()}.`, 'ok');
  } catch (e) {
    console.error('Erro ao ativar cadastro pendente:', e?.code || e, e?.message || '');
    const msg = String(e?.code || '').includes('permission')
      ? 'Sem permissão para ativar cadastro. Ajuste as rules de /users para permitir update do master.'
      : 'Não foi possível ativar o cadastro pendente.';
    setMasterDrawerStatus(msg, 'error');
  }
}

function startMasterPendingListener(force = false) {
  if (!IS_MASTER_PANEL) return;
  if (MASTER_UNSUB_PENDING && !force) return;
  if (MASTER_UNSUB_PENDING && force) { try { MASTER_UNSUB_PENDING(); } catch (_) {} MASTER_UNSUB_PENDING = null; }

  const q = Firestore.query(Firestore.collection(db, 'users'), Firestore.where('signupStatus', '==', 'pending_setup'));
  MASTER_UNSUB_PENDING = Firestore.onSnapshot(q, (snap) => {
    MASTER_PENDING_CACHE = snap.docs
      .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter(item => !item.restaurantId);
    renderMasterPendingTable();
  }, (err) => {
    console.error('Erro ao listar cadastros pendentes:', err?.code || err, err?.message || '');
    if (masterPendingRefs.body) masterPendingRefs.body.innerHTML = '';
    masterPendingRefs.empty?.classList.remove('hidden');
  });
}

function renderMasterStats(list) {
  const now = Date.now();
  const in7 = now + 7 * 24 * 60 * 60 * 1000;
  const goldCount = list.filter(item => ["gold","diamond"].includes(_masterGetRestaurantSummary(item).tier)).length;
  const activeCount = list.filter(item => _masterGetRestaurantSummary(item).status === "active").length;
  const expiringCount = list.filter(item => {
    const exp = tsToMillis(_masterGetRestaurantSummary(item).expiresAt);
    return exp && exp >= now && exp <= in7;
  }).length;
  if (masterRefs.statTotal) masterRefs.statTotal.textContent = String(list.length);
  if (masterRefs.statGold) masterRefs.statGold.textContent = String(goldCount);
  if (masterRefs.statActive) masterRefs.statActive.textContent = String(activeCount);
  if (masterRefs.statExpiring) masterRefs.statExpiring.textContent = String(expiringCount);
}

function renderMasterTable() {
  if (!masterRefs.body) return;
  const search = String(masterRefs.search?.value || "").trim().toLowerCase();
  const planFilter = String(masterRefs.planFilter?.value || "all");
  const statusFilter = String(masterRefs.statusFilter?.value || "all");

  const filtered = MASTER_RESTAURANTS_CACHE.filter(item => {
    const s = _masterGetRestaurantSummary(item);
    const hay = [item.name, item.id, s.contact, s.billingEmail].join(" ").toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (planFilter !== "all" && s.tier !== planFilter) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    return true;
  });

  renderMasterStats(MASTER_RESTAURANTS_CACHE);
  if (masterRefs.count) masterRefs.count.textContent = `${filtered.length} item(ns)`;
  masterRefs.body.innerHTML = filtered.map(item => {
    const s = _masterGetRestaurantSummary(item);
    const paidAt = _dateInputValueFromAny(s.paidAt) || "—";
    const expiresAt = _dateInputValueFromAny(s.expiresAt) || "—";
    const dueDay = s.dueDay ? `Dia ${s.dueDay}` : "—";
    return `
      <tr>
        <td>
          <div class="masterRestName">${item.name || "Restaurante sem nome"}</div>
          <div class="masterRestMeta">${item.id}<br>${s.contact || "Sem contato"}</div>
        </td>
        <td><span class="masterPill plan-${s.tier}">${s.tier.toUpperCase()}</span></td>
        <td><span class="masterPill status-${s.status}">${masterLabelStatus(s.status)}</span></td>
        <td>${brl(s.monthlyPrice)}</td>
        <td>${dueDay}</td>
        <td>${paidAt}</td>
        <td>${expiresAt}</td>
        <td>
          <div class="masterActions">
            <button class="ghost small" type="button" data-billing-restaurant="${item.id}">Email cobrança</button>
            <button class="masterActionBtn" type="button" data-master-open="${item.id}">Gerenciar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const hasItems = filtered.length > 0;
  if (masterRefs.empty) masterRefs.empty.classList.toggle("hidden", hasItems);

  masterRefs.body.querySelectorAll("[data-master-open]").forEach(btn => {
    btn.addEventListener("click", () => openMasterDrawer(btn.dataset.masterOpen));
  });
  masterRefs.body.querySelectorAll("[data-billing-restaurant]").forEach(btn => {
    btn.addEventListener("click", () => openBillingEmailForRestaurant(btn.dataset.billingRestaurant));
  });
}

function bindMasterPanelEvents() {
  [masterRefs.search, masterRefs.planFilter, masterRefs.statusFilter].forEach(el => {
    if (!el || el.dataset.boundMaster === "1") return;
    el.dataset.boundMaster = "1";
    el.addEventListener("input", renderMasterTable);
    el.addEventListener("change", renderMasterTable);
  });

  if (masterRefs.refreshBtn && masterRefs.refreshBtn.dataset.boundMaster !== "1") {
    masterRefs.refreshBtn.dataset.boundMaster = "1";
    masterRefs.refreshBtn.addEventListener("click", () => startMasterRestaurantsListener(true));
  }
  if (masterRefs.drawerClose && masterRefs.drawerClose.dataset.boundMaster !== "1") {
    masterRefs.drawerClose.dataset.boundMaster = "1";
    masterRefs.drawerClose.addEventListener("click", closeMasterDrawer);
  }
  if (masterRefs.drawerScrim && masterRefs.drawerScrim.dataset.boundMaster !== "1") {
    masterRefs.drawerScrim.dataset.boundMaster = "1";
    masterRefs.drawerScrim.addEventListener("click", closeMasterDrawer);
  }
  if (masterRefs.markPaidBtn && masterRefs.markPaidBtn.dataset.boundMaster !== "1") {
    masterRefs.markPaidBtn.dataset.boundMaster = "1";
    masterRefs.markPaidBtn.addEventListener("click", () => {
      const today = _dateInputValueFromAny(new Date());
      if (masterRefs.fPaidAt) masterRefs.fPaidAt.value = today;
      if (masterRefs.fStatus) masterRefs.fStatus.value = "active";
      setMasterDrawerStatus("Último pagamento definido para hoje.");
    });
  }
  if (masterRefs.set30Btn && masterRefs.set30Btn.dataset.boundMaster !== "1") {
    masterRefs.set30Btn.dataset.boundMaster = "1";
    masterRefs.set30Btn.addEventListener("click", () => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      if (masterRefs.fExpiresAt) masterRefs.fExpiresAt.value = _dateInputValueFromAny(d);
      if (masterRefs.fStatus) masterRefs.fStatus.value = "active";
      setMasterDrawerStatus("Expiração ajustada para 30 dias à frente.");
    });
  }
  if (masterRefs.set7Btn && masterRefs.set7Btn.dataset.boundMaster !== "1") {
    masterRefs.set7Btn.dataset.boundMaster = "1";
    masterRefs.set7Btn.addEventListener("click", () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      if (masterRefs.fExpiresAt) masterRefs.fExpiresAt.value = _dateInputValueFromAny(d);
      setMasterDrawerStatus("Expiração ajustada para 7 dias à frente.");
    });
  }
  if (masterRefs.clearTrialBtn && masterRefs.clearTrialBtn.dataset.boundMaster !== "1") {
    masterRefs.clearTrialBtn.dataset.boundMaster = "1";
    masterRefs.clearTrialBtn.addEventListener("click", () => {
      if (masterRefs.fTrialEndsAt) masterRefs.fTrialEndsAt.value = "";
      setMasterDrawerStatus("Fim do trial removido do formulário.");
    });
  }
  if (masterRefs.saveBtn && masterRefs.saveBtn.dataset.boundMaster !== "1") {
    masterRefs.saveBtn.dataset.boundMaster = "1";
    masterRefs.saveBtn.addEventListener("click", saveMasterRestaurant);
  }
}

function setMasterDrawerStatus(text, tone = "default") {
  if (!masterRefs.drawerStatus) return;
  masterRefs.drawerStatus.textContent = text;
  masterRefs.drawerStatus.style.borderColor = tone === "error" ? "rgba(239,68,68,.25)" : "#e2e8f0";
  masterRefs.drawerStatus.style.background = tone === "error" ? "#fff1f2" : "#f8fafc";
  masterRefs.drawerStatus.style.color = tone === "error" ? "#991b1b" : "#334155";
}

function openMasterDrawer(restaurantId) {
  const item = MASTER_RESTAURANTS_CACHE.find(v => v.id === restaurantId);
  if (!item || !masterRefs.drawer) return;
  MASTER_SELECTED_ID = restaurantId;
  const s = _masterGetRestaurantSummary(item);
  if (masterRefs.drawerRestaurantName) masterRefs.drawerRestaurantName.textContent = item.name || "Restaurante";
  if (masterRefs.drawerRestaurantId) masterRefs.drawerRestaurantId.textContent = item.id;
  if (masterRefs.fName) masterRefs.fName.value = item.name || "";
  if (masterRefs.fContact) masterRefs.fContact.value = s.contact || "";
  if (masterRefs.fBillingEmail) masterRefs.fBillingEmail.value = s.billingEmail || "";
  if (masterRefs.fTier) {
    masterRefs.fTier.value = s.tier;
    masterRefs.fTier.onchange = () => {
      const cfg = getPlanConfigForTier(masterRefs.fTier?.value || "basic");
      if (masterRefs.fMonthlyPrice && (!masterRefs.fMonthlyPrice.value || Number(masterRefs.fMonthlyPrice.value) === 0)) {
        masterRefs.fMonthlyPrice.value = String(Number(cfg.priceBRL || 0));
      }
    };
  }
  if (masterRefs.fStatus) masterRefs.fStatus.value = s.status;
  if (masterRefs.fMonthlyPrice) masterRefs.fMonthlyPrice.value = String(s.monthlyPrice || 0);
  if (masterRefs.fDueDay) masterRefs.fDueDay.value = s.dueDay ? String(s.dueDay) : "";
  if (masterRefs.fPaidAt) masterRefs.fPaidAt.value = _dateInputValueFromAny(s.paidAt);
  if (masterRefs.fExpiresAt) masterRefs.fExpiresAt.value = _dateInputValueFromAny(s.expiresAt);
  if (masterRefs.fTrialEndsAt) masterRefs.fTrialEndsAt.value = _dateInputValueFromAny(s.trialEndsAt);
  if (masterRefs.fNotes) masterRefs.fNotes.value = s.notes || "";
  masterRefs.drawer.classList.remove("hidden");
  masterRefs.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setMasterDrawerStatus("Edite os campos e salve para atualizar este restaurante.");
}

function closeMasterDrawer() {
  if (!masterRefs.drawer) return;
  masterRefs.drawer.classList.add("hidden");
  masterRefs.drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  MASTER_SELECTED_ID = null;
}

async function saveMasterRestaurant() {
  if (!MASTER_SELECTED_ID) return;
  try {
    setMasterDrawerStatus("Salvando alterações...");
    const ref = Firestore.doc(db, "restaurants", MASTER_SELECTED_ID);
    await Firestore.setDoc(ref, {
      name: masterRefs.fName?.value?.trim() || "",
      billing: {
        contact: masterRefs.fContact?.value?.trim() || "",
        billingEmail: masterRefs.fBillingEmail?.value?.trim() || "",
        monthlyPriceBRL: Number(masterRefs.fMonthlyPrice?.value || 0) || 0,
        dueDay: Number(masterRefs.fDueDay?.value || 0) || 0,
        paidAt: _tsFromDateInput(masterRefs.fPaidAt?.value || ""),
        expiresAt: _tsFromDateInput(masterRefs.fExpiresAt?.value || "", true),
        notes: masterRefs.fNotes?.value?.trim() || "",
        status: _masterNormalizeStatus(masterRefs.fStatus?.value || "active")
      },
      plan: {
        tier: _masterNormalizeTier(masterRefs.fTier?.value || "basic"),
        status: _masterNormalizeStatus(masterRefs.fStatus?.value || "active"),
        priceBRL: Number(masterRefs.fMonthlyPrice?.value || 0) || 0,
        paidAt: _tsFromDateInput(masterRefs.fPaidAt?.value || ""),
        expiresAt: _tsFromDateInput(masterRefs.fExpiresAt?.value || "", true),
        trialEndsAt: _tsFromDateInput(masterRefs.fTrialEndsAt?.value || "", true)
      },
      updatedAt: Firestore.serverTimestamp()
    }, { merge: true });

    setMasterDrawerStatus("Restaurante atualizado com sucesso.");
  } catch (e) {
    console.error("Erro ao salvar restaurante no master panel:", e?.code || e, e?.message || "");
    setMasterDrawerStatus("Não foi possível salvar. Verifique as permissões do Firestore.", "error");
  }
}

function startMasterRestaurantsListener(force = false) {
  if (!IS_MASTER_PANEL) return;
  bindMasterPanelEvents();
  bindMasterTabs();
  loadPlatformPlanConfig();
  if (MASTER_UNSUB_RESTAURANTS && !force) return;
  if (MASTER_UNSUB_RESTAURANTS && force) { try { MASTER_UNSUB_RESTAURANTS(); } catch (_) {} MASTER_UNSUB_RESTAURANTS = null; }

  const q = Firestore.query(Firestore.collection(db, "restaurants"), Firestore.orderBy("name", "asc"));
  MASTER_UNSUB_RESTAURANTS = Firestore.onSnapshot(q, (snap) => {
    MASTER_RESTAURANTS_CACHE = snap.docs
      .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter(item => item.id !== "_platform");
    renderMasterTable();
  }, (err) => {
    console.error("Erro ao listar restaurantes no painel master:", err?.code || err, err?.message || "");
    if (masterRefs.body) masterRefs.body.innerHTML = "";
    if (masterRefs.empty) masterRefs.empty.classList.remove("hidden");
    setMasterDrawerStatus("Sem acesso para ler /restaurants. Ajuste as regras do Firestore.", "error");
  });
}

/** Auth state */
Auth.onAuthStateChanged(auth, async (user) => {
  if (!user) {
    IS_MASTER_PANEL = false;
    if (MASTER_UNSUB_PENDING) { try { MASTER_UNSUB_PENDING(); } catch (_) {} MASTER_UNSUB_PENDING = null; }
    if (MASTER_UNSUB_RESTAURANTS) { try { MASTER_UNSUB_RESTAURANTS(); } catch (_) {} MASTER_UNSUB_RESTAURANTS = null; }
    if (panelEl) panelEl.classList.add("hidden");
    if (masterPanelEl) masterPanelEl.classList.add("hidden");
    loginScreenEl?.classList.remove("hidden");
    showAuthSubView("login");
    return;
  }

  let userData = null;
  try {
    const usnap = await Firestore.getDoc(Firestore.doc(db, "users", user.uid));
    userData = usnap.exists() ? (usnap.data() || {}) : null;
  } catch (e) {
    console.warn("Falha ao carregar users/{uid}:", e?.code || e, e?.message || "");
  }

  if (isMasterUser(user, userData)) {
    IS_MASTER_PANEL = true;
    showOnlyPanel("master");
    startMasterRestaurantsListener(true);
    startMasterPendingListener(true);
    return;
  }

  if (!userData?.restaurantId && String(userData?.signupStatus || "") === "pending_setup") {
    IS_MASTER_PANEL = false;
    if (MASTER_UNSUB_PENDING) { try { MASTER_UNSUB_PENDING(); } catch (_) {} MASTER_UNSUB_PENDING = null; }
    if (MASTER_UNSUB_RESTAURANTS) { try { MASTER_UNSUB_RESTAURANTS(); } catch (_) {} MASTER_UNSUB_RESTAURANTS = null; }
    if (panelEl) panelEl.classList.add("hidden");
    if (masterPanelEl) masterPanelEl.classList.add("hidden");
    loginScreenEl?.classList.remove("hidden");
    fillPendingSignupView(userData || {});
    showAuthSubView("pending");
    return;
  }

  IS_MASTER_PANEL = false;
  showOnlyPanel("restaurant");

  // 🔥 Multi-tenant: descobre o restaurante pelo users/{uid}.restaurantId
  try {
    RESTAURANT_ID = userData?.restaurantId || await loadRestaurantIdFromUser();
  } catch (e) {
    console.warn("Falha ao carregar restaurantId do usuário:", e?.code || e, e?.message || "");
  }

  await checkAdminAccess();
  await loadRestaurantHeader();

  await checkSubscriptionGate();
  if (guardIfSubscriptionBlocked()) return;

  if (unsubOrders) unsubOrders();
  startOrdersListener();
});

/* ===== Menu lateral (telas) ===== */
(function(){
  const buttons = Array.from(document.querySelectorAll(".menuItem"));
  if (!buttons.length) return;

  const pages = Array.from(document.querySelectorAll(".page"));
  const titleEl = document.getElementById("pageTitle");

  function show(page){
    const tier = SUBSCRIPTION_INFO?.tier || "basic";
    if (!restaurantHasFeature(page, tier)) {
      alert("Esse recurso não está liberado no seu plano.");
      return;
    }
    ACTIVE_RESTAURANT_PAGE = page;
    buttons.forEach(b => b.classList.toggle("active", b.dataset.page === page));
    pages.forEach(p => p.classList.remove("active"));
    const target = document.getElementById("page-" + page);
    if (target) target.classList.add("active");
    if (titleEl) {
      const map = { orders:"Pedidos", products:"Produtos", finance:"Financeiro", customers:"Clientes", promos:"Promoções & Cupons", settings:"Configurações" };
      titleEl.textContent = map[page] || "Pedidos";
    }

    // ✅ Inicia o CRUD de produtos só quando abre a tela
    if (page === "products") {
      try { _startProductsListener(); } catch (_) {}
    }
  
    // ✅ Inicia o Financeiro só quando abre a tela
    if (page === "finance") {
      try { _startFinancePanel(); } catch (_) {}
    }

    // ✅ Inicia Clientes/Feedbacks só quando abre a tela
    if (page === "customers") {
      try { _startCustomersPanel(); } catch (_) {}
    }

    // ✅ Inicia Promoções & Cupons só quando abre a tela
    if (page === "promos") {
      try { _startPromosPanel(); } catch (_) {}
    }

    // ✅ Inicia Configurações só quando abre a tela
    if (page === "settings") {
      try { _startSettingsPanel(); } catch (_) {}
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
  const emptyTitle = document.getElementById("productsEmptyTitle");
  const emptyText = document.getElementById("productsEmptyText");
  const searchEl = document.getElementById("prodSearch");
  const statusEl = document.getElementById("prodStatusFilter");
  const categoryEl = document.getElementById("prodCategoryFilter");
  if (!host) return;

  host.innerHTML = "";

  const products = Array.isArray(list) ? list : [];
  const q = (searchEl?.value || "").trim().toLowerCase();
  const status = statusEl?.value || "all";
  const currentCategory = categoryEl?.value || "all";

  const categories = [...new Set(products.map(p => String(p?.category || "").trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));

  if (categoryEl) {
    const nextValue = categories.includes(currentCategory) ? currentCategory : "all";
    categoryEl.innerHTML = `<option value="all">Todas</option>` + categories.map(cat => `<option value="${_escapeHtml(cat)}">${_escapeHtml(cat)}</option>`).join("");
    categoryEl.value = nextValue;
  }

  const activeCount = products.filter(p => p?.active !== false).length;
  const inactiveCount = Math.max(0, products.length - activeCount);
  const statTotal = document.getElementById("prodStatTotal");
  const statActive = document.getElementById("prodStatActive");
  const statInactive = document.getElementById("prodStatInactive");
  const statCategories = document.getElementById("prodStatCategories");
  if (statTotal) statTotal.textContent = String(products.length);
  if (statActive) statActive.textContent = String(activeCount);
  if (statInactive) statInactive.textContent = String(inactiveCount);
  if (statCategories) statCategories.textContent = String(categories.length);

  const filtered = products.filter((p) => {
    const hay = `${p?.name || ""} ${p?.category || ""} ${p?.desc || ""}`.toLowerCase();
    const active = p?.active !== false;
    const okQuery = !q || hay.includes(q);
    const okStatus = status === "all" || (status === "active" && active) || (status === "inactive" && !active);
    const selectedCategory = categoryEl?.value || "all";
    const okCategory = selectedCategory === "all" || String(p?.category || "").trim() === selectedCategory;
    return okQuery && okStatus && okCategory;
  });

  if (!filtered.length) {
    host.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    if (emptyTitle) emptyTitle.textContent = products.length ? "Nenhum produto encontrado" : "Nenhum produto cadastrado ainda.";
    if (emptyText) {
      emptyText.textContent = products.length
        ? "Tente mudar a busca ou limpar os filtros para ver mais resultados."
        : "Cadastre seu primeiro item para começar a montar o cardápio.";
    }
    return;
  }
  if (empty) empty.classList.add("hidden");

  for (const p of filtered) {
    const div = document.createElement("div");
    div.className = "prodCard";
    const active = p.active !== false;
    const name = _escapeHtml(p?.name || "Sem nome");
    const category = _escapeHtml(p?.category || "Sem categoria");
    const descRaw = String(p?.desc || "").trim();
    const desc = descRaw ? `${_escapeHtml(descRaw.slice(0, 150))}${descRaw.length > 150 ? "…" : ""}` : "Sem descrição cadastrada para este produto.";
    const imageUrl = String(p?.imageUrl || "").trim();
    const sizesCount = Array.isArray(p?.sizes) ? p.sizes.filter(x => String(x?.name || "").trim()).length : 0;
    const addonsCount = Array.isArray(p?.addons) ? p.addons.filter(x => String(x?.name || "").trim()).length : 0;
    const hasImage = !!imageUrl;
    const mediaHtml = hasImage
      ? `<img src="${_escapeHtml(imageUrl)}" alt="${name}">`
      : `<div class="prodCard__mediaFallback">${name.slice(0,1).toUpperCase()}</div>`;

    div.innerHTML = `
      <div class="prodCard__media">${mediaHtml}</div>
      <div class="prodCard__body">
        <div class="prodCard__head">
          <div class="prodCard__titleWrap">
            <div class="prodName">${name}</div>
            <div class="prodMeta">
              <span class="badge small ${active ? "good" : "off"}">
                <span class="badgeDot" style="background:${active ? "#22c55e" : "#94a3b8"}"></span>
                ${active ? "Ativo" : "Inativo"}
              </span>
              <span class="badge small">${category}</span>
            </div>
          </div>
          <div class="prodPriceWrap">
            <span class="prodPriceLabel">Preço base</span>
            <div class="prodPrice">${brl(p.price ?? 0)}</div>
          </div>
        </div>

        <div class="prodDesc">${desc}</div>

        <div class="prodInsights">
          <div class="prodInsight">
            <strong>${sizesCount}</strong>
            <span>${sizesCount === 1 ? "tamanho" : "tamanhos"}</span>
          </div>
          <div class="prodInsight">
            <strong>${addonsCount}</strong>
            <span>${addonsCount === 1 ? "adicional" : "adicionais"}</span>
          </div>
          <div class="prodInsight">
            <strong>${hasImage ? "Sim" : "Não"}</strong>
            <span>imagem cadastrada</span>
          </div>
        </div>

        <div class="prodChips">
          <span class="prodChip"><b>ID</b> ${_escapeHtml(p.id || "-")}</span>
          ${sizesCount ? `<span class="prodChip"><b>Opções</b> ${sizesCount} tamanho(s)</span>` : ""}
          ${addonsCount ? `<span class="prodChip"><b>Extras</b> ${addonsCount} adicional(is)</span>` : ""}
        </div>

        <div class="prodActions">
          <div class="prodActionsGroup">
            <button class="ghost small" type="button" data-prod-act="toggle" data-id="${_escapeHtml(p.id)}">
              ${active ? "Desativar" : "Ativar"}
            </button>
            <button class="btn small" type="button" data-prod-act="edit" data-id="${_escapeHtml(p.id)}">Editar</button>
          </div>
          <button class="ghost small danger" type="button" data-prod-act="del" data-id="${_escapeHtml(p.id)}">Excluir</button>
        </div>
      </div>
    `;
    host.appendChild(div);
  }
}

function _startProductsListener(){
  if (__JPED_PRODUCTS_READY) return;
  __JPED_PRODUCTS_READY = true;

  const search = document.getElementById("prodSearch");
  const statusFilter = document.getElementById("prodStatusFilter");
  const categoryFilter = document.getElementById("prodCategoryFilter");
  const clearFilters = document.getElementById("prodClearFilters");
  const btnNew = document.getElementById("btnNewProduct");

  if (search) {
    search.addEventListener("input", () => _renderProducts(__JPED_PRODUCTS_CACHE));
  }
  if (statusFilter) {
    statusFilter.addEventListener("change", () => _renderProducts(__JPED_PRODUCTS_CACHE));
  }
  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => _renderProducts(__JPED_PRODUCTS_CACHE));
  }
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      if (search) search.value = "";
      if (statusFilter) statusFilter.value = "all";
      if (categoryFilter) categoryFilter.value = "all";
      _renderProducts(__JPED_PRODUCTS_CACHE);
    });
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
    <div class="prodModalContent prodDrawerContent" role="dialog" aria-modal="true" aria-labelledby="prodModalTitle">
      <div class="prodModalHeader prodDrawerHeader">
        <div class="prodModalHero prodDrawerHero">
          <div class="prodModalHero__badge">Catálogo premium</div>
          <div class="prodModalHero__head">
            <div>
              <div class="modalOrderNum" id="prodModalTitle">Novo produto</div>
              <div class="modalMeta" id="prodModalSub">Preencha os dados abaixo.</div>
            </div>
          </div>
        </div>

        <button type="button" class="modalClose prodModalCloseBtn" id="prodModalClose" aria-label="Fechar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div class="prodModalBody prodDrawerBody">
        <div class="modalSection prodModalSection">
          <div class="prodModalCard prodModalCard--compact">
            <div class="prodModalCard__title">Informações principais</div>

            <div class="prodInfoLayout">
              <div class="prodInfoMain">
                <div class="formGrid prodMainGrid">
                  <div class="formRow">
                    <div class="label">Nome</div>
                    <input id="pName" class="input" placeholder="Ex: X-Salada" />
                  </div>

                  <div class="formRow">
                    <div class="label">Preço base (R$)</div>
                    <input id="pPrice" class="input" inputmode="decimal" placeholder="Ex: 25,90" />
                  </div>

                  <div class="formRow">
                    <div class="label">Categoria</div>
                    <input id="pCategory" class="input" placeholder="Ex: Lanches" />
                  </div>

                  <div class="formRow">
                    <div class="label">Imagem por URL</div>
                    <input id="pImage" class="input" placeholder="https://..." />
                  </div>

                  <div class="formRow prodModalTextareaRow prodModalTextareaRow--compact">
                    <div class="label">Descrição (opcional)</div>
                    <textarea id="pDesc" class="input textarea" placeholder="Ex: pão, hamburguer, queijo..."></textarea>
                  </div>
                </div>
              </div>

              <aside class="prodPreviewAside">
                <div class="prodPreviewHead">
                  <div>
                    <div class="label">Imagem do produto</div>
                    <div class="muted prodPreviewHint">Preview imediato, sem precisar abrir outra tela.</div>
                  </div>
                </div>

                <div class="prodImagePreviewCard prodImagePreviewCard--compact">
                  <img id="pImagePreview" alt="Preview" class="prodImgPreview" />
                  <div class="prodImagePreviewEmpty" id="pImagePreviewEmpty">A prévia da imagem vai aparecer aqui</div>
                </div>

                <label class="prodUploadBox prodUploadBox--compact" for="pImageFile">
                  <input id="pImageFile" class="input prodUploadInput" type="file" accept="image/*" />
                  <span class="prodUploadIcon" aria-hidden="true">+</span>
                  <div class="prodUploadText">
                    <strong>Selecionar imagem</strong>
                    <span>PNG, JPG ou WEBP até 4MB</span>
                  </div>
                </label>
                <div class="muted prodImageStatus" id="pImageStatus"></div>
              </aside>
            </div>
          </div>

          <div class="prodModalSplit">
            <div class="prodModalCard">
              <div class="prodModalCard__head">
                <div>
                  <div class="prodModalCard__title">Tamanhos</div>
                  <div class="muted">Defina opções de tamanho e o preço final de cada tamanho.</div>
                </div>
                <button type="button" class="ghost small prodActionBtn" id="btnAddSize">+ Adicionar tamanho</button>
              </div>
              <div id="pSizes" class="optList"></div>
            </div>

            <div class="prodModalCard">
              <div class="prodModalCard__head">
                <div>
                  <div class="prodModalCard__title">Adicionais</div>
                  <div class="muted">Itens extras que o cliente pode escolher.</div>
                </div>
                <button type="button" class="ghost small prodActionBtn" id="btnAddAddon">+ Adicionar adicional</button>
              </div>
              <div id="pAddons" class="optList"></div>
            </div>
          </div>

          <div class="toggleRow prodToggleRow">
            <input id="pActive" type="checkbox" />
            <div>
              <div class="prodToggleTitle">Produto ativo</div>
              <div class="muted">Se desativar, some do cardápio do cliente.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="modalFooter prodModalFooter prodDrawerFooter">
        <button type="button" class="ghost small" id="prodCancel">Cancelar</button>
        <button type="button" class="btn small prodSaveBtn" id="prodSave">Salvar produto</button>
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

  const previewEmpty = modal.querySelector("#pImagePreviewEmpty");

  function setPreview(src) {
    if (!previewImg) return;
    const value = String(src || "").trim();
    if (!value) {
      previewImg.style.display = "none";
      previewImg.removeAttribute("src");
      if (previewEmpty) previewEmpty.style.display = "flex";
      return;
    }
    previewImg.onload = () => {
      previewImg.style.display = "block";
      if (previewEmpty) previewEmpty.style.display = "none";
    };
    previewImg.onerror = () => {
      previewImg.style.display = "none";
      previewImg.removeAttribute("src");
      if (previewEmpty) previewEmpty.style.display = "flex";
    };
    previewImg.src = value;
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

/* =========================================================
   FINANCEIRO (Dashboard)
   - Lanche mais vendido no mês
   - Pedidos concluídos (mês atual vs mês anterior)
   - Relatório em PDF (sem pagar nada)
   ========================================================= */
let __JPED_FIN_READY = false;
let __JPED_FIN_DATA = []; // docs do orders_history
let __JPED_FIN_LOADING = false;

function _ordersHistoryCol(){
  return Firestore.collection(db, "restaurants", RESTAURANT_ID, "orders_history");
}

function _safeMs(v){
  try{
    if (!v) return null;
    if (typeof v === "number") return v;
    if (v?.toDate) return v.toDate().getTime();
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    }
  }catch(_){}
  return null;
}

function _orderMs(o){
  // tenta achar um timestamp plausível
  return (
    _safeMs(o?.deliveredAt) ??
    _safeMs(o?.completedAt) ??
    _safeMs(o?.updatedAt) ??
    _safeMs(o?.createdAt) ??
    null
  );
}

function _monthKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

function _monthRange(monthStr){
  // monthStr: "YYYY-MM"
  const [y, m] = String(monthStr || "").split("-").map(n => parseInt(n,10));
  if (!y || !m) return null;
  const start = new Date(y, m-1, 1, 0,0,0,0);
  const end = new Date(y, m, 1, 0,0,0,0);
  return { start, end };
}

function _fmtMonth(monthStr){
  const r = _monthRange(monthStr);
  if (!r) return "-";
  const d = r.start;
  const names = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${names[d.getMonth()]} ${d.getFullYear()}`;
}

function _sumOrderTotal(o){
  // tenta somar total/cash
  const candidates = [o?.total, o?.totalAmount, o?.amount, o?.priceTotal, o?.grandTotal, o?.sum];
  for (const c of candidates){
    const n = _num(c);
    if (n > 0) return n;
  }
  // fallback: soma itens
  const items = Array.isArray(o?.items) ? o.items : (Array.isArray(o?.cart?.items) ? o.cart.items : []);
  let sum = 0;
  for (const it of items){
    const q = _num(it?.qty ?? it?.qtd ?? it?.quantity ?? 1) || 1;
    const p = _num(it?.price ?? it?.unitPrice ?? it?.value ?? 0);
    if (p > 0) sum += q * p;
  }
  return sum;
}

function _isDone(o){
  const s = String(o?.status || o?.state || "").toLowerCase();
  return s === "entregue" || s === "entregue " || s === "delivered" || s === "done";
}

function _isCanceled(o){
  const s = String(o?.status || o?.state || "").toLowerCase();
  return s === "cancelado" || s === "canceled" || s === "cancelled";
}

async function _loadFinanceData(){
  if (__JPED_FIN_LOADING) return;
  __JPED_FIN_LOADING = true;

  const statusEl = document.getElementById("finStatus");
  const subEl = document.getElementById("finSub");
  try{
    if (statusEl) statusEl.textContent = "Carregando dados do histórico…";
    if (subEl) subEl.textContent = "Buscando pedidos concluídos e cancelados do histórico.";

    if (!RESTAURANT_ID) throw new Error("RESTAURANT_ID vazio");
    const col = _ordersHistoryCol();

    // tenta uma query "boa" (mais eficiente)
    let docs = [];
    try{
      const q = Firestore.query(col, Firestore.orderBy("createdAt","desc"), Firestore.limit(900));
      const snap = await Firestore.getDocs(q);
      docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }catch(err1){
      // fallback 1: updatedAt
      try{
        const q2 = Firestore.query(col, Firestore.orderBy("updatedAt","desc"), Firestore.limit(900));
        const snap2 = await Firestore.getDocs(q2);
        docs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      }catch(err2){
        // fallback 2: pega tudo (limitado na UI) — pode ser mais lento dependendo do volume
        const snap3 = await Firestore.getDocs(col);
        docs = snap3.docs.slice(0, 1200).map(d => ({ id: d.id, ...d.data() }));
      }
    }

    __JPED_FIN_DATA = docs || [];
    if (statusEl) statusEl.textContent = `Histórico carregado: ${__JPED_FIN_DATA.length} registro(s).`;
    if (subEl) subEl.textContent = "Selecione o mês para ver o resumo.";

  }catch(err){
    console.warn("Financeiro: falha ao carregar histórico:", err?.code || err, err?.message || "");
    if (statusEl) statusEl.textContent = "Não foi possível carregar o histórico (veja o console F12).";
    if (subEl) subEl.textContent = "Verifique permissões do Firestore para orders_history.";
    __JPED_FIN_DATA = [];
  }finally{
    __JPED_FIN_LOADING = false;
  }
}

function _renderFinance(monthStr){
  const labelEl = document.getElementById("finMonthLabel");
  if (labelEl) labelEl.textContent = _fmtMonth(monthStr);

  const range = _monthRange(monthStr);
  if (!range) return;

  const ms0 = range.start.getTime();
  const ms1 = range.end.getTime();

  // prev month
  const prevStart = new Date(range.start.getFullYear(), range.start.getMonth()-1, 1, 0,0,0,0);
  const prevEnd = new Date(range.start.getFullYear(), range.start.getMonth(), 1, 0,0,0,0);
  const p0 = prevStart.getTime();
  const p1 = prevEnd.getTime();

  const monthOrders = [];
  const prevOrders = [];

  for (const o of (__JPED_FIN_DATA || [])){
    const t = _orderMs(o);
    if (!t) continue;
    if (t >= ms0 && t < ms1) monthOrders.push(o);
    else if (t >= p0 && t < p1) prevOrders.push(o);
  }

  const doneMonth = monthOrders.filter(_isDone);
  const donePrev = prevOrders.filter(_isDone);

  const revenueMonth = doneMonth.reduce((acc,o)=> acc + _sumOrderTotal(o), 0);
  const avgTicket = doneMonth.length ? (revenueMonth / doneMonth.length) : 0;

  // top item
  const tally = new Map();
  for (const o of doneMonth){
    const items = Array.isArray(o?.items) ? o.items : (Array.isArray(o?.cart?.items) ? o.cart.items : []);
    for (const it of items){
      const name = String(it?.name ?? it?.title ?? it?.productName ?? "").trim();
      if (!name) continue;
      const q = _num(it?.qty ?? it?.qtd ?? it?.quantity ?? 1) || 1;
      tally.set(name, (tally.get(name) || 0) + q);
    }
  }
  let topName = "-";
  let topQty = 0;
  for (const [k,v] of tally.entries()){
    if (v > topQty){ topQty = v; topName = k; }
  }

  // cards
  const elRev = document.getElementById("finRevenueMonth");
  const elRevMeta = document.getElementById("finRevenueMeta");
  const elDone = document.getElementById("finDoneMonth");
  const elDoneCmp = document.getElementById("finDoneCompare");
  const elAvg = document.getElementById("finAvgTicket");
  const elAvgMeta = document.getElementById("finAvgTicketMeta");
  const elTop = document.getElementById("finTopItem");
  const elTopMeta = document.getElementById("finTopItemMeta");

  if (elRev) elRev.textContent = brl(revenueMonth);
  if (elRevMeta) elRevMeta.textContent = `${doneMonth.length} pedido(s) concluído(s) no mês.`;

  if (elDone) elDone.textContent = String(doneMonth.length);
  const delta = doneMonth.length - donePrev.length;
  const pct = donePrev.length ? Math.round((delta / donePrev.length) * 100) : (doneMonth.length ? 100 : 0);
  const sign = delta > 0 ? "+" : (delta < 0 ? "−" : "");
  if (elDoneCmp) elDoneCmp.textContent = `Mês anterior: ${donePrev.length} • Variação: ${sign}${Math.abs(delta)} (${sign}${Math.abs(pct)}%)`;

  if (elAvg) elAvg.textContent = doneMonth.length ? brl(avgTicket) : "—";
  if (elAvgMeta) elAvgMeta.textContent = doneMonth.length ? "Média por pedido concluído." : "Sem pedidos concluídos no período.";

  if (elTop) elTop.textContent = topName;
  if (elTopMeta) elTopMeta.textContent = topQty ? `${topQty} unidade(s) vendida(s) no mês.` : "Sem itens vendidos no período.";

  // Hoje
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const today1 = new Date(); today1.setHours(24,0,0,0);
  const t0 = today0.getTime();
  const t1 = today1.getTime();

  let todayOrders = 0;
  let todayRevenue = 0;
  let todayCanceled = 0;

  for (const o of (__JPED_FIN_DATA || [])){
    const t = _orderMs(o);
    if (!t) continue;
    if (t < t0 || t >= t1) continue;
    if (_isCanceled(o)) { todayCanceled++; continue; }
    if (_isDone(o)) {
      todayOrders++;
      todayRevenue += _sumOrderTotal(o);
    }
  }

  const elTO = document.getElementById("finTodayOrders");
  const elTR = document.getElementById("finTodayRevenue");
  const elTC = document.getElementById("finTodayCanceled");
  const elTM = document.getElementById("finTodayMeta");
  if (elTO) elTO.textContent = String(todayOrders);
  if (elTR) elTR.textContent = brl(todayRevenue);
  if (elTC) elTC.textContent = String(todayCanceled);
  if (elTM) elTM.textContent = "Baseado no histórico (orders_history).";

  // Insights (simples e úteis)
  const insightsEl = document.getElementById("finInsights");
  if (insightsEl){
    const totalAll = monthOrders.length;
    const canceledMonth = monthOrders.filter(_isCanceled).length;
    const cancelRate = totalAll ? Math.round((canceledMonth/totalAll)*100) : 0;

    // horário mais comum (concluídos)
    const hourTally = new Array(24).fill(0);
    for (const o of doneMonth){
      const t = _orderMs(o);
      if (!t) continue;
      const d = new Date(t);
      hourTally[d.getHours()]++;
    }
    let bestHour = 0, bestHourCount = 0;
    for (let h=0; h<24; h++){
      if (hourTally[h] > bestHourCount){ bestHour = h; bestHourCount = hourTally[h]; }
    }

    const parts = [];
    parts.push({
      title: "Taxa de cancelamento",
      desc: totalAll ? `${canceledMonth} cancelado(s) em ${totalAll} pedido(s) no mês selecionado.` : "Sem dados no período.",
      badge: totalAll ? `${cancelRate}%` : "—"
    });

    parts.push({
      title: "Pico de pedidos concluídos",
      desc: doneMonth.length ? `Horário mais frequente: ${String(bestHour).padStart(2,"0")}:00.` : "Sem pedidos concluídos no período.",
      badge: doneMonth.length ? `${bestHourCount}` : "—"
    });

    parts.push({
      title: "Top 3 itens do mês",
      desc: (() => {
        if (!tally.size) return "Sem itens no período.";
        const top3 = Array.from(tally.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3);
        return top3.map(([n,q]) => `${n} (${q})`).join(" • ");
      })(),
      badge: tally.size ? "TOP" : "—"
    });

    insightsEl.innerHTML = parts.map(p => `
      <div class="finInsightItem">
        <div>
          <div class="finInsightTitle">${p.title}</div>
          <div class="finInsightDesc">${p.desc}</div>
        </div>
        <span class="finInsightBadge">${p.badge}</span>
      </div>
    `).join("");
  }

  const statusEl = document.getElementById("finStatus");
  if (statusEl){
    statusEl.textContent = `Atualizado: ${new Date().toLocaleString()} • Fonte: restaurants/${RESTAURANT_ID}/orders_history`;
  }
}

async function _downloadFinancePDF(){
  const host = document.getElementById("financeReport");
  if (!host) return;

  const hasCanvas = typeof window.html2canvas === "function";
  const hasPdf = !!(window.jspdf && window.jspdf.jsPDF);

  if (!hasCanvas || !hasPdf){
    alert("Para gerar PDF, precisamos carregar as bibliotecas (html2canvas + jsPDF). Confira sua conexão e recarregue a página.");
    return;
  }

  const btn = document.getElementById("finPdf");
  if (btn) btn.disabled = true;

  try{
    const canvas = await window.html2canvas(host, { scale: 2, backgroundColor: "#ffffff" });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // margens
    const margin = 10;
    const usableW = pageW - margin*2;
    const usableH = pageH - margin*2;

    // tamanho no PDF mantendo proporção
    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;

    // se cabe em uma página, simples
    if (imgH <= usableH){
      pdf.setFontSize(14);
      pdf.text("Relatório Financeiro (Resumo do mês)", margin, margin-2);
      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", margin, margin+4, imgW, imgH);
    } else {
      // quebra em páginas cortando o canvas
      const pxPerMm = canvas.width / imgW;
      const pagePxH = Math.floor(usableH * pxPerMm);

      let y = 0;
      let page = 0;

      while (y < canvas.height){
        if (page > 0) pdf.addPage();

        if (page === 0){
          pdf.setFontSize(14);
          pdf.text("Relatório Financeiro (Resumo do mês)", margin, margin-2);
        }

        const sliceH = Math.min(pagePxH, canvas.height - y);

        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceH;

        const ctx = slice.getContext("2d");
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        const imgData = slice.toDataURL("image/png");
        const sliceMmH = sliceH / pxPerMm;

        pdf.addImage(imgData, "PNG", margin, margin+4, imgW, sliceMmH);

        y += sliceH;
        page++;
      }
    }

    const monthStr = document.getElementById("finMonth")?.value || _monthKey(new Date());
    const fname = `relatorio_${RESTAURANT_ID || "rest"}_${monthStr}.pdf`;
    pdf.save(fname);
  }catch(err){
    console.warn("PDF: falha ao gerar:", err);
    alert("Não foi possível gerar o PDF. Veja o console (F12).");
  }finally{
    if (btn) btn.disabled = false;
  }
}

async function _startFinancePanel(){
  if (__JPED_FIN_READY) return;
  __JPED_FIN_READY = true;

  const monthInput = document.getElementById("finMonth");
  const monthLabel = document.getElementById("finMonthLabel");
  const refreshBtn = document.getElementById("finRefresh");
  const pdfBtn = document.getElementById("finPdf");

  // default mês atual
  const now = new Date();
  const def = _monthKey(now);
  if (monthInput && !monthInput.value) monthInput.value = def;
  if (monthLabel) monthLabel.textContent = _fmtMonth(monthInput?.value || def);

  const rerender = () => _renderFinance(monthInput?.value || def);

  if (monthInput){
    monthInput.addEventListener("change", rerender);
  }
  if (refreshBtn){
    refreshBtn.addEventListener("click", async () => {
      await _loadFinanceData();
      rerender();
    });
  }
  if (pdfBtn){
    pdfBtn.addEventListener("click", _downloadFinancePDF);
  }

  // carrega primeira vez
  await _loadFinanceData();
  rerender();
}


/* =========================================================
   CLIENTES / FEEDBACKS
   - Relatório com avaliações da entrega gravadas em orders_public.deliveryReview
   - Contagem de pedidos por cliente
   ========================================================= */
let __JPED_CUSTOMERS_READY = false;
let __JPED_CUSTOMERS_LOADING = false;
let __JPED_CUSTOMERS_DATA = [];
let __JPED_CUSTOMERS_UNSUB = null;

function _ordersPublicCol(){
  return Firestore.collection(db, "restaurants", RESTAURANT_ID, "orders_public");
}

function _escapeHtml(v){
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _fmtDateTime(v){
  const ms = _safeMs(v);
  if (!ms) return "-";
  return new Date(ms).toLocaleString("pt-BR");
}

function _customerDisplayName(order){
  return String(
    order?.customer?.name ||
    order?.customerName ||
    order?.checkout?.customerName ||
    order?.name ||
    "Cliente sem nome"
  ).trim() || "Cliente sem nome";
}

function _customerKey(order){
  const uid = String(order?.customerUid || "").trim();
  if (uid) return `uid:${uid}`;
  const phone = String(order?.customer?.phone || order?.phone || "").replace(/\D+/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${_customerDisplayName(order).toLowerCase()}`;
}

function _starsHtml(n){
  const rating = Math.max(0, Math.min(5, Number(n || 0)));
  let html = '<span class="custStars" aria-label="' + rating + ' estrelas">';
  for (let i = 1; i <= 5; i++) html += `<span class="custStar${i <= rating ? ' is-on' : ''}">★</span>`;
  html += '</span>';
  return html;
}

async function _loadCustomersData(){
  if (__JPED_CUSTOMERS_LOADING) return;
  __JPED_CUSTOMERS_LOADING = true;

  const statusEl = document.getElementById("custStatus");
  const subEl = document.getElementById("custSub");

  try{
    if (statusEl) statusEl.textContent = "Carregando clientes e feedbacks...";
    if (subEl) subEl.textContent = "Buscando histórico completo em orders_public.";

    const col = _ordersPublicCol();
    let docs = [];

    try{
      const q = Firestore.query(col, Firestore.orderBy("createdAt","desc"), Firestore.limit(1500));
      const snap = await Firestore.getDocs(q);
      docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }catch(err1){
      try{
        const q2 = Firestore.query(col, Firestore.orderBy("updatedAt","desc"), Firestore.limit(1500));
        const snap2 = await Firestore.getDocs(q2);
        docs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      }catch(err2){
        const snap3 = await Firestore.getDocs(col);
        docs = snap3.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    __JPED_CUSTOMERS_DATA = docs || [];
    if (statusEl) statusEl.textContent = `Base carregada: ${__JPED_CUSTOMERS_DATA.length} pedido(s).`;
    if (subEl) subEl.textContent = "Relatório pronto com pedidos, estrelas e comentários.";
  }catch(err){
    console.warn("Clientes: falha ao carregar dados:", err?.code || err, err?.message || "");
    __JPED_CUSTOMERS_DATA = [];
    if (statusEl) statusEl.textContent = "Não foi possível carregar os feedbacks (veja o console F12).";
    if (subEl) subEl.textContent = "Verifique permissões do Firestore para orders_public.";
  }finally{
    __JPED_CUSTOMERS_LOADING = false;
  }
}

function _buildCustomerFeedbackRows(searchTerm){
  const orders = Array.isArray(__JPED_CUSTOMERS_DATA) ? __JPED_CUSTOMERS_DATA : [];
  const counts = new Map();
  const uniqueKeys = new Set();

  for (const order of orders){
    const key = _customerKey(order);
    uniqueKeys.add(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const rows = [];
  let ratingSum = 0;

  for (const order of orders){
    const review = order?.deliveryReview;
    const rating = Number(review?.rating || 0);
    const comment = String(review?.comment || "").trim();
    if (!rating && !comment) continue;

    const customerName = _customerDisplayName(order);
    const key = _customerKey(order);
    const orderCount = counts.get(key) || 1;
    const orderNum = order?.orderNumber ? `#${order.orderNumber}` : `#${order.id?.slice?.(0,6) || '-'}`;
    const when = _fmtDateTime(review?.createdAt || order?.updatedAt || order?.createdAt);

    const hay = `${customerName} ${comment} ${orderNum}`.toLowerCase();
    if (searchTerm && !hay.includes(searchTerm)) continue;

    rows.push({
      customerName,
      orderCount,
      rating,
      comment: comment || "Sem comentário.",
      orderNum,
      when,
      sortMs: _safeMs(review?.createdAt) ?? _safeMs(order?.updatedAt) ?? _safeMs(order?.createdAt) ?? 0
    });

    if (rating > 0) ratingSum += rating;
  }

  rows.sort((a,b) => b.sortMs - a.sortMs);

  return {
    rows,
    uniqueCustomerCount: uniqueKeys.size,
    totalOrders: orders.length,
    totalFeedbacks: rows.length,
    avgRating: rows.length ? (ratingSum / rows.length) : 0
  };
}

function _renderCustomers(){
  const tbody = document.getElementById("customersFeedbackTableBody");
  const search = (document.getElementById("custSearch")?.value || "").trim().toLowerCase();
  const data = _buildCustomerFeedbackRows(search);

  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText("custUniqueCustomers", String(data.uniqueCustomerCount));
  setText("custTotalOrders", String(data.totalOrders));
  setText("custTotalFeedbacks", String(data.totalFeedbacks));
  setText("custAvgRating", data.totalFeedbacks ? data.avgRating.toFixed(1) : "-");
  setText("custUniqueMeta", data.uniqueCustomerCount ? "Baseado em clientes únicos identificados." : "Nenhum cliente encontrado ainda.");
  setText("custOrdersMeta", data.totalOrders ? "Pedidos encontrados no histórico público." : "Sem pedidos carregados." );
  setText("custFeedbackMeta", data.totalFeedbacks ? "Avaliações enviadas após a entrega." : "Nenhum feedback recebido ainda." );
  setText("custAvgMeta", data.totalFeedbacks ? "Média das avaliações recebidas." : "Aguardando estrelas dos clientes." );
  setText("custFeedbackCount", data.totalFeedbacks ? `${data.totalFeedbacks} feedback${data.totalFeedbacks === 1 ? '' : 's'}` : "Sem feedbacks");
  setText("custStatus", `Atualizado: ${new Date().toLocaleString()} • Fonte: restaurants/${RESTAURANT_ID}/orders_public`);

  if (!tbody) return;
  if (!data.rows.length){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${search ? 'Nenhum feedback encontrado para esta busca.' : 'Nenhuma avaliação de entrega foi enviada ainda.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = data.rows.map((row) => `
    <tr>
      <td>
        <div class="custClientCell">
          <strong>${_escapeHtml(row.customerName)}</strong>
        </div>
      </td>
      <td><span class="custCountBadge">${row.orderCount}</span></td>
      <td>${_starsHtml(row.rating)}</td>
      <td><div class="custComment">${_escapeHtml(row.comment)}</div></td>
      <td><span class="custOrderBadge">${_escapeHtml(row.orderNum)}</span></td>
      <td>${_escapeHtml(row.when)}</td>
    </tr>
  `).join("");
}

function _subscribeCustomersRealtime(){
  if (__JPED_CUSTOMERS_UNSUB) return;

  const statusEl = document.getElementById("custStatus");
  const subEl = document.getElementById("custSub");
  const col = _ordersPublicCol();

  try{
    __JPED_CUSTOMERS_UNSUB = Firestore.onSnapshot(col, (snap) => {
      __JPED_CUSTOMERS_DATA = (snap?.docs || []).map(d => ({ id: d.id, ...d.data() }));
      if (statusEl) statusEl.textContent = `Atualizado em tempo real: ${__JPED_CUSTOMERS_DATA.length} pedido(s).`;
      if (subEl) subEl.textContent = "Novos pedidos e avaliações aparecem automaticamente.";
      _renderCustomers();
    }, (err) => {
      console.warn("Clientes: falha no tempo real:", err?.code || err, err?.message || "");
      if (statusEl) statusEl.textContent = "Tempo real indisponível. Usando recarga manual.";
      if (subEl) subEl.textContent = "Clique em atualizar para recarregar os pedidos.";
    });
  }catch(err){
    console.warn("Clientes: não foi possível iniciar onSnapshot:", err?.code || err, err?.message || "");
  }
}

async function _startCustomersPanel(){
  const refreshBtn = document.getElementById("custRefresh");
  const searchInput = document.getElementById("custSearch");

  if (!__JPED_CUSTOMERS_READY){
    __JPED_CUSTOMERS_READY = true;

    if (searchInput){
      searchInput.addEventListener("input", _renderCustomers);
    }
    if (refreshBtn){
      refreshBtn.addEventListener("click", async () => {
        await _loadCustomersData();
        _renderCustomers();
      });
    }

    _subscribeCustomersRealtime();
  }

  await _loadCustomersData();
  _renderCustomers();
}


/* ===== Configurações (Settings) ===== */
let __JPED_SETTINGS_STARTED = false;
let __JPED_SETTINGS_UNSUB = null;

function _settingsDocRef(){
  return Firestore.doc(db, "restaurants", RESTAURANT_ID, "config", "app");
}

function _setEl(id){ return document.getElementById(id); }

function _setText(id, txt){
  const el = _setEl(id);
  if (el) el.textContent = txt;
}

function _val(id){ return (_setEl(id)?.value ?? ""); }
function _setVal(id, v){
  const el = _setEl(id);
  if (el) el.value = (v ?? "") === null ? "" : String(v ?? "");
}
function _checked(id){ return !!_setEl(id)?.checked; }
function _setChecked(id, v){
  const el = _setEl(id);
  if (el) el.checked = !!v;
}

function _numOrNull(v){
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function _intOrNull(v){
  const n = _numOrNull(v);
  if (n === null) return null;
  return Math.max(0, Math.round(n));
}

function _csvToArr(v){
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function _arrToCsv(a){
  return (Array.isArray(a) ? a : []).join(", ");
}


/* ===== Identidade (logo + fundo) ===== */
function _ensureIdentityUI(){
  // já existe?
  if (document.getElementById("setIdentityCard")) return;

  // tenta achar um ponto bom pra inserir (depois do Instagram, ou no fim do bloco settings)
  // insere no bloco de configurações
const host = document.getElementById("settingsInfoCard");

  const wrap = document.createElement("div");
  wrap.id = "setIdentityCard";
  wrap.style.marginTop = "14px";
  wrap.innerHTML = `
    <div style="padding:18px;border:1px solid #e5e7eb;border-radius:20px;background:#fff;max-width:760px;margin:0 0 20px 0;box-shadow:0 10px 30px rgba(15,23,42,.06)">
     <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
  <div>
    <div style="font-weight:900;color:#0f172a;font-size:18px;line-height:1.1">Identidade da loja</div>
    <div style="font-size:13px;color:#64748b;margin-top:4px">Envie a logo e a imagem de capa do seu restaurante.</div>
  </div>

  <div style="padding:8px 12px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155">
    Visual da loja
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
  <div style="min-width:0">
    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px">Logo (redonda)</div>

    <label style="display:flex;flex-direction:column;justify-content:center;align-items:center;border:2px dashed #cbd5e1;border-radius:16px;padding:18px;text-align:center;cursor:pointer;background:#f8fafc;min-height:120px;transition:.2s">
      <div style="font-size:28px;line-height:1">🟢</div>
      <div style="font-weight:800;color:#0f172a;margin-top:8px">Enviar logo</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">Clique para selecionar PNG ou JPG</div>

      <input id="setLogoFile" type="file" accept="image/*" style="display:none">
      <input id="setLogoUrl" type="hidden">
    </label>

    <div id="setLogoStatus" class="muted" style="font-size:12px;margin-top:8px;color:#64748b"></div>
  </div>

  <div style="min-width:0">
    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px">Fundo (capa)</div>

    <label style="display:flex;flex-direction:column;justify-content:center;align-items:center;border:2px dashed #cbd5e1;border-radius:16px;padding:18px;text-align:center;cursor:pointer;background:#f8fafc;min-height:120px;transition:.2s">
      <div style="font-size:28px;line-height:1">🖼️</div>
      <div style="font-weight:800;color:#0f172a;margin-top:8px">Enviar capa</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">Clique para selecionar PNG ou JPG</div>

      <input id="setCoverFile" type="file" accept="image/*" style="display:none">
      <input id="setCoverUrl" type="hidden">
    </label>

    <div id="setCoverStatus" class="muted" style="font-size:12px;margin-top:8px;color:#64748b"></div>
  </div>
</div>

  <div id="setIdentityPreview" style="position:relative;height:170px;border-radius:22px;overflow:hidden;border:1px solid #e5e7eb;background:#f1f5f9;box-shadow:0 10px 25px rgba(15,23,42,.08)">
    <div id="setCoverPreview" style="position:absolute;inset:0;background-size:cover;background-position:center;filter:saturate(1.05)"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.48));"></div>

    <div style="position:absolute;left:18px;right:18px;bottom:18px;display:flex;align-items:end;gap:14px">
      <img id="setLogoPreview" alt="Logo" style="width:74px;height:74px;border-radius:999px;object-fit:cover;background:#fff;border:3px solid rgba(255,255,255,0.92);box-shadow:0 10px 25px rgba(0,0,0,.18);display:none;flex:0 0 auto" />

      <div style="color:#fff;min-width:0">
        <div id="setPreviewName" style="font-weight:900;font-size:20px;line-height:1.1;text-shadow:0 2px 10px rgba(0,0,0,.25)"></div>
        <div id="setPreviewDesc" style="opacity:.96;font-size:13px;margin-top:4px;text-shadow:0 2px 10px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%"></div>
      </div>
    </div>
  </div>

  <div class="muted" style="font-size:12px;margin-top:8px;color:#64748b">
    Dica: use uma imagem larga para a capa e uma logo quadrada para melhor resultado.
  </div>
</div>
  `;

host.prepend(wrap);
try{
  const ig = _setEl("setInstagram");
  if (ig) {
    const row = ig.closest(".formRow") || ig.parentElement;
    if (row) row.style.display = "none";
  }
}catch(_){}

  // esconde WhatsApp (identidade agora é só logo + fundo)
  try{
    const wa = _setEl("setWhatsapp");
    if (wa) {
      const row = wa.closest(".formRow") || wa.parentElement;
      if (row) row.style.display = "none";
    }
  }catch(_){}

  // wire preview sync
  ["setName","setDesc","setLogoUrl","setCoverUrl"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => { try{ _updateIdentityPreview(); }catch(_){} });
  });

  // clear buttons
  const clearCover = document.getElementById("setCoverClear");
  if (clearCover) clearCover.onclick = () => {
    const u = document.getElementById("setCoverUrl"); if (u) u.value = "";
    try{ _updateIdentityPreview(); }catch(_){}
  };
  const clearLogo = document.getElementById("setLogoClear");
  if (clearLogo) clearLogo.onclick = () => {
    const u = document.getElementById("setLogoUrl"); if (u) u.value = "";
    try{ _updateIdentityPreview(); }catch(_){}
  };

  // upload handlers
  const coverFile = document.getElementById("setCoverFile");
  if (coverFile) {
    coverFile.value = "";
    coverFile.onchange = async () => {
      const f = coverFile.files?.[0];
      if (!f) return;
      const status = document.getElementById("setCoverStatus");
      const urlInput = document.getElementById("setCoverUrl");
      if (status) status.textContent = "Enviando...";
      coverFile.disabled = true;
      if (urlInput) urlInput.disabled = true;
      try{
        const finalUrl = await uploadBrandImage(f, "cover");
        if (urlInput) urlInput.value = finalUrl || "";
        if (status) status.textContent = "Fundo enviado ✅";
        _updateIdentityPreview();
      }catch(e){
        console.warn("Upload cover falhou:", e?.code || e, e?.message || e);
        if (status) status.textContent = "Falha ❌";
        alert(e?.message || "Não foi possível enviar o fundo.");
      }finally{
        coverFile.disabled = false;
        if (urlInput) urlInput.disabled = false;
      }
    };
  }

  const logoFile = document.getElementById("setLogoFile");
  if (logoFile) {
    logoFile.value = "";
    logoFile.onchange = async () => {
      const f = logoFile.files?.[0];
      if (!f) return;
      const status = document.getElementById("setLogoStatus");
      const urlInput = document.getElementById("setLogoUrl");
      if (status) status.textContent = "Enviando...";
      logoFile.disabled = true;
      if (urlInput) urlInput.disabled = true;
      try{
        const finalUrl = await uploadBrandImage(f, "logo");
        if (urlInput) urlInput.value = finalUrl || "";
        if (status) status.textContent = "Logo enviada ✅";
        _updateIdentityPreview();
      }catch(e){
        console.warn("Upload logo falhou:", e?.code || e, e?.message || e);
        if (status) status.textContent = "Falha ❌";
        alert(e?.message || "Não foi possível enviar a logo.");
      }finally{
        logoFile.disabled = false;
        if (urlInput) urlInput.disabled = false;
      }
    };
  }

  // preview inicial
  try{ _updateIdentityPreview(); }catch(_){}
}

function _updateIdentityPreview(){
  const name = (_setEl("setName")?.value || "").trim();
  const desc = (_setEl("setDesc")?.value || "").trim();
  const logoUrl = (document.getElementById("setLogoUrl")?.value || "").trim();
  const coverUrl = (document.getElementById("setCoverUrl")?.value || "").trim();

  const elName = document.getElementById("setPreviewName");
  const elDesc = document.getElementById("setPreviewDesc");
  if (elName) elName.textContent = name || "Seu restaurante";
  if (elDesc) elDesc.textContent = desc || "";

  const cover = document.getElementById("setCoverPreview");
  if (cover) cover.style.backgroundImage = coverUrl ? `url("${coverUrl.replaceAll('"', '\"')}")` : "none";

  const logo = document.getElementById("setLogoPreview");
  if (logo) {
    if (logoUrl) {
      logo.src = logoUrl;
      logo.style.display = "block";
    } else {
      logo.removeAttribute("src");
      logo.style.display = "none";
    }
  }
}
function _updatePromoPreview(){
  const on = _checked("setPromoOn");
  const title = (_val("setPromoTitle") || "").trim();
  const sub = (_val("setPromoSub") || "").trim();
  const code = (_val("setCouponCode") || "").trim();
  const pct = (_val("setCouponPct") || "").trim();
  const notice = (_val("setNotice") || "").trim();

  const box = document.getElementById("promoBannerPreview");
  if (!box) return;

  box.classList.toggle("isOff", !on);

  const t = document.getElementById("promoPrevTitle");
  const s = document.getElementById("promoPrevSub");
  const c = document.getElementById("promoPrevCoupon");
  const n = document.getElementById("promoPrevNotice");

  if (t) t.textContent = title || "Título da promoção";
  if (s) s.textContent = sub || "Subtítulo da promoção";

  if (c){
    if (code) c.textContent = `CUPOM: ${code}${pct ? ` • ${pct}%` : ""}`;
    else c.textContent = "CUPOM: —";
  }

  if (n){
    n.textContent = notice ? `Aviso: ${notice}` : "Aviso: —";
    n.style.display = notice ? "inline-flex" : "none";
  }
}

function _wirePromoPreview(){
  const ids = ["setPromoOn","setPromoTitle","setPromoSub","setCouponCode","setCouponPct","setNotice"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", _updatePromoPreview);
    el.addEventListener("change", _updatePromoPreview);
  });
  _updatePromoPreview();
}





/* =========================================================
   HORÁRIOS (ABERTO/FECHADO) — admin entende automaticamente
   - hours.manualOpen: chave do admin (checkbox)
   - hours.isOpen: ABERTO efetivo (manualOpen + dentro do horário)
   - compatível com versões antigas (que só liam hours.isOpen)
   ========================================================= */
let __JPED_HOURS_TICK = null;
let __JPED_HOURS_LAST_EFFECTIVE = null;
let __JPED_HOURS_LAST_WRITE_AT = 0;
let __JPED_HOURS_READY = false;

function _normalizeTimeStr(raw){
  const s = String(raw ?? "").trim();
  if (!s) return "";

  // aceita: "8", "08", "800", "0800", "8:0", "8:00", "08:00"
  const m1 = s.match(/^([0-2]?\d)(?::?([0-5]?\d))?$/);
  if (m1){
    let hh = parseInt(m1[1],10);
    let mm = (m1[2] == null) ? 0 : parseInt(m1[2],10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return s;
    hh = Math.max(0, Math.min(23, hh));
    mm = Math.max(0, Math.min(59, mm));
    return String(hh).padStart(2,"0") + ":" + String(mm).padStart(2,"0");
  }

  // aceita "08h00"
  const m2 = s.match(/^([0-2]?\d)\s*[hH]\s*([0-5]?\d)$/);
  if (m2){
    let hh = Math.max(0, Math.min(23, parseInt(m2[1],10)));
    let mm = Math.max(0, Math.min(59, parseInt(m2[2],10)));
    return String(hh).padStart(2,"0") + ":" + String(mm).padStart(2,"0");
  }

  return s; // mantém como veio (se for estranho)
}

function _timeStrToMin(str){
  const s = _normalizeTimeStr(str);
  const m = s.match(/^([0-2]\d):([0-5]\d)$/);
  if (!m) return null;
  const hh = parseInt(m[1],10);
  const mm = parseInt(m[2],10);
  if (hh > 23 || mm > 59) return null;
  return hh*60 + mm;
}

function _isWithinOpenHours(openStr, closeStr, now){
  const o = _timeStrToMin(openStr);
  const c = _timeStrToMin(closeStr);

  // se não configurou horário, considera "sempre aberto"
  if (o == null || c == null) return true;

  const cur = now.getHours()*60 + now.getMinutes();

  // mesmo horário -> assume 24h aberto
  if (o === c) return true;

  // normal (ex: 08:00 -> 18:00)
  if (o < c) return cur >= o && cur < c;

  // cruza meia-noite (ex: 18:00 -> 02:00)
  return (cur >= o) || (cur < c);
}

function _ensureOpenNowPill(){
  let el = document.getElementById("setOpenNowPill");
  if (el) return el;

  // tenta colocar perto do pill do RID (se existir)
  const anchor = document.getElementById("setRidPill") || document.getElementById("setStatus") || document.getElementById("pageTitle") || document.body;
  el = document.createElement("div");
  el.id = "setOpenNowPill";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.gap = "8px";
  el.style.padding = "8px 12px";
  el.style.borderRadius = "999px";
  el.style.fontWeight = "700";
  el.style.fontSize = "12px";
  el.style.border = "1px solid #e5e7eb";
  el.style.background = "#fff";
  el.style.margin = "8px 0";
  el.textContent = "Status: —";

  try{
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(el, anchor.nextSibling);
    } else {
      document.body.prepend(el);
    }
  }catch(_){
    document.body.prepend(el);
  }
  return el;
}

function _paintOpenNowPill(isOpenEff, reason){
  const el = _ensureOpenNowPill();
  if (!el) return;
  el.textContent = isOpenEff ? `ABERTO agora${reason ? " • " + reason : ""}` : `FECHADO agora${reason ? " • " + reason : ""}`;
  if (isOpenEff){
    el.style.borderColor = "#bbf7d0";
    el.style.background = "#f0fdf4";
    el.style.color = "#166534";
  } else {
    el.style.borderColor = "#fecaca";
    el.style.background = "#fff1f2";
    el.style.color = "#991b1b";
  }
}

function _effectiveOpenFromHours(hours){
  const h = hours || {};
  const openStr = h.open ?? "";
  const closeStr = h.close ?? "";
  const within = _isWithinOpenHours(openStr, closeStr, new Date());
  // compat: antigo hours.isOpen era o "manual". novo: hours.manualOpen
  const manual = (h.manualOpen != null) ? !!h.manualOpen : (h.isOpen !== false);
  return {
    within,
    manual,
    effective: (manual && within),
    openStr: _normalizeTimeStr(openStr),
    closeStr: _normalizeTimeStr(closeStr)
  };
}

async function _maybeSyncEffectiveOpen(hours){
  if (!__JPED_HOURS_READY) return;
  if (!RESTAURANT_ID) return;
  if (!ADMIN_OK) return;
  if (!SUBSCRIPTION_OK) return;

  const r = _effectiveOpenFromHours(hours);
  const eff = r.effective;

  // evita loop infinito: só escreve se mudou e não escreveu há pouco
  const now = Date.now();
  if (__JPED_HOURS_LAST_EFFECTIVE === eff) return;
  if (now - __JPED_HOURS_LAST_WRITE_AT < 25_000) return;

  __JPED_HOURS_LAST_EFFECTIVE = eff;
  __JPED_HOURS_LAST_WRITE_AT = now;

  try{
    await Firestore.setDoc(_settingsDocRef(), {
      updatedAt: Firestore.serverTimestamp(),
      hours: {
        open: r.openStr,
        close: r.closeStr,
        manualOpen: r.manual,
        isOpen: eff
      }
    }, { merge: true });
  }catch(e){
    console.warn("Falha ao sincronizar horário (isOpen):", e?.code || e, e?.message || "");
  }
}

function _tickOpenNowFromForm(){
  const openStr = _normalizeTimeStr(_val("setOpen"));
  const closeStr = _normalizeTimeStr(_val("setClose"));
  const manual = _checked("setIsOpen");
  const within = _isWithinOpenHours(openStr, closeStr, new Date());
  const eff = manual && within;

  const reason = within ? "" : `fora do horário (${openStr||"??"}–${closeStr||"??"})`;
  _paintOpenNowPill(eff, reason);

  // normaliza inputs sem atrapalhar o usuário
  try{
    const elO = _setEl("setOpen");
    if (elO && openStr && elO.value !== openStr) elO.value = openStr;
    const elC = _setEl("setClose");
    if (elC && closeStr && elC.value !== closeStr) elC.value = closeStr;
  }catch(_){ }

  _maybeSyncEffectiveOpen({ open: openStr, close: closeStr, manualOpen: manual });
  return eff;
}

function _startHoursAutoTick(){
  if (__JPED_HOURS_TICK) return;
  try{ _tickOpenNowFromForm(); }catch(_){ }
  __JPED_HOURS_TICK = setInterval(() => {
    try{ _tickOpenNowFromForm(); }catch(_){ }
  }, 30_000);
}
function _applySettingsToForm(cfg){
  cfg = cfg || {};
  const r = cfg.restaurant || {};
  const hours = cfg.hours || {};
  const delivery = cfg.delivery || {};
  const pay = cfg.payments || {};
  const promo = cfg.promo || {};
  const notif = cfg.notifications || {};
  const theme = cfg.theme || {};
  const adv = cfg.advanced || {};

  _setVal("setName", r.name);
  _setVal("setDesc", r.desc);
  // WhatsApp removido da Identidade (mantém compatibilidade: não exibe/nem salva)
 
  _setVal("setLogoUrl", r.logoUrl);
  _setVal("setCoverUrl", r.coverUrl);
  try{ _updateIdentityPreview(); }catch(_){ }

  _setVal("setOpen", hours.open);
  _setVal("setClose", hours.close);
  _setVal("setPrepMin", hours.prepMin);
  _setVal("setAutoMsg", hours.autoMsg);
  _setChecked("setIsOpen", (hours.manualOpen ?? hours.isOpen) !== false); // default true
  _setChecked("setAutoConfirm", !!hours.autoConfirm);

  _setVal("setDeliveryFee", delivery.fee);
  _setVal("setDeliveryKm", delivery.maxKm);
  _setVal("setDeliveryBaseKm", delivery.baseKm ?? delivery.fixedUntilKm);
  _setVal("setDeliveryExtraPerKm", delivery.extraPerKm);
  _setVal("setMinOrder", delivery.minOrder);
  _setVal("setDeliveryEta", delivery.etaMin);
  _setVal("setNeighborhoods", _arrToCsv(delivery.neighborhoods));
  _setChecked("setPickup", !!delivery.pickup);

  const geo = delivery.geoapify || {};
  _setVal("setGeoapifyKey", geo.apiKey);
  _setVal("setStoreAddress", geo.storeAddress);
  _setVal("setStoreLat", geo.storeLat);
  _setVal("setStoreLng", geo.storeLng);

  _setVal("setPixKey", pay.pixKey);
  _setVal("setPixName", pay.pixName);
  _setChecked("setCash", pay.cash !== false); // default true
  _setChecked("setCard", !!pay.cardOnDelivery);
  _setVal("setPayNote", pay.note);

  _setChecked("setPromoOn", !!promo.enabled);
  _setVal("setPromoTitle", promo.title);
  _setVal("setPromoSub", promo.subtitle);
  _setVal("setCouponCode", promo.couponCode);
  _setVal("setCouponPct", promo.couponPct);
  _setVal("setNotice", promo.notice);
  _setVal("setPromoEndsAt", _toDatetimeLocalValue(promo.endsAt));

  try { _applyPromosPanelData(cfg); } catch (_) {}

  _setChecked("setSoundNewOrder", notif.soundNewOrder !== false); // default true
  _setChecked("setSoundChat", notif.soundChat !== false); // default true
  _setVal("setVolume", (notif.volume ?? "") === "" ? "" : String(notif.volume ?? ""));
  _setVal("setToasts", (notif.toasts === "off") ? "off" : "on");

  _setVal("setPrimary", theme.primary);
  _setVal("setCurrency", theme.currency || "BRL");
  _setChecked("setShowImages", theme.showImages !== false); // default true
  _setChecked("setCompactMenu", !!theme.compactMenu);

  _setVal("setCloudName", adv.cloudinaryCloudName);
  _setVal("setUploadPreset", adv.cloudinaryUploadPreset);
  _setVal("setMenuUrl", adv.menuUrl);
  _setVal("setWaTemplate", adv.whatsappTemplate);
}

function _collectSettingsFromForm(){
  
  const payload = {
    updatedAt: Firestore.serverTimestamp(),
restaurant: {
  name: _val("setName").trim(),
  desc: _val("setDesc").trim(),
  logoUrl: _val("setLogoUrl").trim(),
  coverUrl: _val("setCoverUrl").trim(),
},

    hours: {
      open: _normalizeTimeStr(_val("setOpen")),
      close: _normalizeTimeStr(_val("setClose")),
      prepMin: _intOrNull(_val("setPrepMin")),
      autoMsg: _val("setAutoMsg").trim(),
      manualOpen: _checked("setIsOpen"),
      isOpen: (_checked("setIsOpen") && _isWithinOpenHours(_normalizeTimeStr(_val("setOpen")), _normalizeTimeStr(_val("setClose")), new Date())),
      autoConfirm: _checked("setAutoConfirm"),
    },
    delivery: {
      fee: _numOrNull(_val("setDeliveryFee")),
      maxKm: _numOrNull(_val("setDeliveryKm")),
      baseKm: _numOrNull(_val("setDeliveryBaseKm")),
      extraPerKm: _numOrNull(_val("setDeliveryExtraPerKm")),
      pricingMode: "base_until_km_then_extra",
      minOrder: _numOrNull(_val("setMinOrder")),
      etaMin: _intOrNull(_val("setDeliveryEta")),
      neighborhoods: _csvToArr(_val("setNeighborhoods")),
      pickup: _checked("setPickup"),
      geoapify: {
        apiKey: _val("setGeoapifyKey").trim(),
        storeAddress: _val("setStoreAddress").trim(),
        storeLat: _numOrNull(_val("setStoreLat")),
        storeLng: _numOrNull(_val("setStoreLng")),
      },
    },
    payments: {
      pixKey: _val("setPixKey").trim(),
      pixName: _val("setPixName").trim(),
      cash: _checked("setCash"),
      cardOnDelivery: _checked("setCard"),
      note: _val("setPayNote").trim(),
    },
promo: {
  enabled: _checked("setPromoOn"),
  title: _val("setPromoTitle").trim(),
  subtitle: _val("setPromoSub").trim(),
  couponCode: _val("setCouponCode").trim(),
  couponPct: _intOrNull(_val("setCouponPct")),
  notice: _val("setNotice").trim(),
  endsAt: _promoEndsAtISOFromInput(),
  campaigns: _buildPromoCampaignsPayload(),
  featuredCampaignId: (__JPED_PROMO_FEATURED_ID || "")
},
    notifications: {
      soundNewOrder: _checked("setSoundNewOrder"),
      soundChat: _checked("setSoundChat"),
      volume: _numOrNull(_val("setVolume")),
      toasts: (_val("setToasts") === "off") ? "off" : "on"
    },
    theme: {
      primary: _val("setPrimary").trim(),
      currency: _val("setCurrency").trim() || "BRL",
      showImages: _checked("setShowImages"),
      compactMenu: _checked("setCompactMenu"),
    },
    advanced: {
      cloudinaryCloudName: _val("setCloudName").trim(),
      cloudinaryUploadPreset: _val("setUploadPreset").trim(),
      menuUrl: _val("setMenuUrl").trim(),
      whatsappTemplate: _val("setWaTemplate").trim(),
    }
  };

  // limpa campos vazios (deixa o merge mais limpo)
  function clean(obj){
    if (!obj || typeof obj !== "object") return obj;
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v && typeof v === "object" && !Array.isArray(v) && !(v?.seconds && v?.nanoseconds)) {
        clean(v);
        if (Object.keys(v).length === 0) delete obj[k];
      } else if (v === "" || v === null) {
        delete obj[k];
      }
    });
    return obj;
  }
  return clean(payload);
}


async function _lookupStoreGeoFromForm(){
  const apiKey = _val("setGeoapifyKey").trim();
  const address = _val("setStoreAddress").trim();

  if (!apiKey) {
    alert("Digite a Geoapify API Key.");
    return;
  }
  if (!address) {
    alert("Digite o endereço da loja.");
    return;
  }

  const btn = _setEl("setGeoLookup");
  const prev = btn ? btn.textContent : "";
  try{
    if (btn){ btn.disabled = true; btn.textContent = "Buscando..."; }
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&format=json&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const row = data?.results?.[0];
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Endereço não encontrado.");
    }
    _setVal("setStoreLat", lat);
    _setVal("setStoreLng", lng);
    _setText("setStatus", "Localização da loja preenchida.");
  }catch(e){
    console.error("Falha ao buscar localização da loja:", e);
    alert(`Não foi possível localizar a loja. ${e?.message || ""}`.trim());
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = prev || "Buscar latitude/longitude"; }
  }
}

function _wireGeoLookupButton(){
  const btn = _setEl("setGeoLookup");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    _lookupStoreGeoFromForm();
  });
}

async function _saveSettings(){
  if (!SUBSCRIPTION_OK) {
    alert("Assinatura expirada. Ative um plano para salvar configurações.");
    return;
  }
  if (!ADMIN_OK) {
    alert("Sem permissão de admin.");
    return;
  }
  if (!RESTAURANT_ID) {
    alert("Sem restaurantId.");
    return;
  }

  const btn = _setEl("setSave");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
  _setText("setStatus", "Salvando no Firestore...");

  try{
    const payload = _collectSettingsFromForm();
    await Firestore.setDoc(_settingsDocRef(), payload, { merge: true });

    _setText("setStatus", "Salvo ✅");
  }catch(e){
    console.warn("Falha ao salvar configurações:", e?.code || e, e?.message || e);
    _setText("setStatus", "Erro ao salvar ❌");
    alert(e?.message || "Não foi possível salvar as configurações.");
  }finally{
    if (btn) { btn.disabled = false; btn.textContent = "Salvar"; }
  }
}

async function _reloadSettingsOnce(){
  if (!RESTAURANT_ID) return;
  try{
    const snap = await Firestore.getDoc(_settingsDocRef());
    const data = snap.exists() ? (snap.data() || {}) : {};
    _applySettingsToForm(data);
    __JPED_HOURS_READY = true;
    try{
      const h = (data && data.hours) ? data.hours : {};
      const r = _effectiveOpenFromHours(h);
      _paintOpenNowPill(r.effective, r.within ? "" : `fora do horário (${r.openStr||"??"}–${r.closeStr||"??"})`);
      __JPED_HOURS_LAST_EFFECTIVE = r.effective;
    }catch(_){ }
    _setText("setStatus", snap.exists() ? "Carregado." : "Ainda não existe config salva (você pode salvar agora).");
  }catch(e){
    console.warn("Falha ao carregar configurações:", e?.code || e, e?.message || e);
    _setText("setStatus", "Erro ao carregar ❌");
  }
  try {
  _ensurePromoEndsAtField();

  const promo = (data && data.promo) ? data.promo : {};
  const inp = document.getElementById("setPromoEndsAt");

  if (inp) {
    inp.value = _toDatetimeLocalValue(promo.endsAt || "");
  }

  _updatePromoEndsAtPreview();
} catch (_) {}
}
function _promoFieldHost() {
  return (
    document.getElementById("promoSettingsBox") ||
    document.getElementById("settingsPromo") ||
    document.getElementById("page-settings") ||
    document.querySelector('[data-settings-section="promo"]') ||
    document.getElementById("page-settings")
  );
}

function _toDatetimeLocalValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function _promoEndsAtISOFromInput() {
  const inp = document.getElementById("setPromoEndsAt");
  if (!inp) return "";

  const v = String(inp.value || "").trim();
  if (!v) return "";

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString();
}

function _formatPromoEndsAtPretty(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Sem expiração";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "Data inválida";

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  
}

function _updatePromoEndsAtPreview() {
  const inp = document.getElementById("setPromoEndsAt");
  const out = document.getElementById("setPromoEndsAtPreview");
  const clearBtn = document.getElementById("setPromoEndsAtClear");
  const quickBtns = document.querySelectorAll("[data-promo-exp]");

  if (!inp || !out) return;

  const iso = _promoEndsAtISOFromInput();

  if (!iso) {
    out.innerHTML = `
      <div style="font-size:12px;opacity:.8;font-weight:700">STATUS</div>
      <div style="margin-top:4px;font-size:16px;font-weight:900">Sem expiração</div>
      <div style="margin-top:6px;font-size:12px;opacity:.8">O banner continuará ativo até você remover manualmente.</div>
    `;
  } else {
    out.innerHTML = `
      <div style="font-size:12px;opacity:.8;font-weight:700">EXPIRA EM</div>
      <div style="margin-top:4px;font-size:16px;font-weight:900">${_formatPromoEndsAtPretty(iso)}</div>
      <div style="margin-top:6px;font-size:12px;opacity:.8">Quando passar desse horário, o banner some automaticamente.</div>
    `;
  }

  if (clearBtn) clearBtn.classList.toggle("hidden", !inp.value);

  quickBtns.forEach((btn) => {
    btn.classList.remove("is-active");
    if (btn.dataset.applied === "1") btn.classList.add("is-active");
  });
}

function _setPromoExpiration(hoursToAdd) {
  const inp = document.getElementById("setPromoEndsAt");
  if (!inp) return;

  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + Number(hoursToAdd || 0));

  inp.value = _toDatetimeLocalValue(d.toISOString());

  document.querySelectorAll("[data-promo-exp]").forEach((b) => {
    b.dataset.applied = "0";
    b.classList.remove("is-active");
  });

  const active = document.querySelector(`[data-promo-exp="${hoursToAdd}"]`);
  if (active) {
    active.dataset.applied = "1";
    active.classList.add("is-active");
  }

  _updatePromoEndsAtPreview();
}

function _ensurePromoEndsAtField() {
  if (document.getElementById("setPromoEndsAt")) return;

  const host = _promoFieldHost();
  if (!host) return;

  const wrap = document.createElement("div");
  wrap.id = "promoEndsAtCard";
  wrap.style.marginTop = "14px";
  wrap.style.border = "1px solid #e5e7eb";
  wrap.style.borderRadius = "22px";
  wrap.style.background = "linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)";
  wrap.style.boxShadow = "0 14px 40px rgba(15,23,42,.08)";
  wrap.style.overflow = "hidden";

  wrap.innerHTML = `
    <div style="padding:18px 18px 14px 18px;border-bottom:1px solid #eef2f7;background:linear-gradient(180deg,rgba(16,185,129,.08),rgba(16,185,129,0))">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#10b981;color:#fff;font-size:18px;box-shadow:0 10px 24px rgba(16,185,129,.25)">
              ⏰
            </div>
            <div>
              <div style="font-weight:900;font-size:16px;color:#0f172a;line-height:1.1">
                Expiração da promoção
              </div>
              <div style="font-size:12px;color:#64748b;margin-top:4px">
                Defina até quando o banner e o cupom ficam ativos.
              </div>
            </div>
          </div>
        </div>

        <button
          id="setPromoEndsAtClear"
          type="button"
          class="ghost small hidden"
          style="border-radius:999px;padding:10px 14px;font-weight:800;border:1px solid #fecaca;background:#fff;color:#b91c1c"
        >
          Remover
        </button>
      </div>
    </div>

    <div style="padding:18px">
      <div style="display:grid;grid-template-columns:1fr 160px;gap:12px;align-items:end">
        <label style="display:block">
          <div style="font-size:12px;font-weight:800;color:#475569;margin-bottom:8px">Data e hora</div>
          <input
            id="setPromoEndsAt"
            type="datetime-local"
            class="input"
            style="width:100%;height:54px;border-radius:16px;border:1px solid #dbe3ee;background:#fff;padding:0 14px;font-size:15px;font-weight:800;color:#0f172a;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)"
          />
        </label>

        <div>
          <div style="font-size:12px;font-weight:800;color:#475569;margin-bottom:8px">Ação rápida</div>
          <button
            type="button"
            id="setPromoTomorrow23"
            class="btn small"
            style="width:100%;height:54px;border-radius:16px;font-weight:900"
          >
            Amanhã 23:59
          </button>
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="font-size:12px;font-weight:800;color:#475569;margin-bottom:8px">Atalhos</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="ghost small" data-promo-exp="1" style="border-radius:999px;padding:10px 14px;font-weight:800">+1h</button>
          <button type="button" class="ghost small" data-promo-exp="3" style="border-radius:999px;padding:10px 14px;font-weight:800">+3h</button>
          <button type="button" class="ghost small" data-promo-exp="6" style="border-radius:999px;padding:10px 14px;font-weight:800">+6h</button>
          <button type="button" class="ghost small" data-promo-exp="12" style="border-radius:999px;padding:10px 14px;font-weight:800">+12h</button>
          <button type="button" class="ghost small" data-promo-exp="24" style="border-radius:999px;padding:10px 14px;font-weight:800">+24h</button>
          <button type="button" class="ghost small" data-promo-exp="48" style="border-radius:999px;padding:10px 14px;font-weight:800">+2 dias</button>
        </div>
      </div>

      <div
        id="setPromoEndsAtPreview"
        style="margin-top:16px;padding:14px 16px;border-radius:18px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;font-size:14px;font-weight:900;box-shadow:0 14px 28px rgba(15,23,42,.18)"
      >
        Sem expiração
      </div>
    </div>
  `;

  host.appendChild(wrap);

  const inp = document.getElementById("setPromoEndsAt");
  const clearBtn = document.getElementById("setPromoEndsAtClear");
  const tomorrowBtn = document.getElementById("setPromoTomorrow23");

  if (inp) {
    inp.addEventListener("input", () => {
      document.querySelectorAll("[data-promo-exp]").forEach((b) => {
        b.dataset.applied = "0";
        b.classList.remove("is-active");
        b.style.background = "#fff";
        b.style.color = "";
        b.style.borderColor = "";
      });
      _updatePromoEndsAtPreview();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (inp) inp.value = "";
      document.querySelectorAll("[data-promo-exp]").forEach((b) => {
        b.dataset.applied = "0";
        b.classList.remove("is-active");
        b.style.background = "#fff";
        b.style.color = "";
        b.style.borderColor = "";
      });
      _updatePromoEndsAtPreview();
    });
  }

  if (tomorrowBtn) {
    tomorrowBtn.addEventListener("click", () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(23, 59, 0, 0);

      if (inp) inp.value = _toDatetimeLocalValue(d.toISOString());

      document.querySelectorAll("[data-promo-exp]").forEach((b) => {
        b.dataset.applied = "0";
        b.classList.remove("is-active");
        b.style.background = "#fff";
        b.style.color = "";
        b.style.borderColor = "";
      });

      _updatePromoEndsAtPreview();
    });
  }

  document.querySelectorAll("[data-promo-exp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _setPromoExpiration(Number(btn.dataset.promoExp || 0));

      document.querySelectorAll("[data-promo-exp]").forEach((b) => {
        b.style.background = "#fff";
        b.style.color = "";
        b.style.borderColor = "";
      });

      btn.style.background = "#0f172a";
      btn.style.color = "#fff";
      btn.style.borderColor = "#0f172a";
    });
  });

  _updatePromoEndsAtPreview();
}
function _startSettingsPanel(){
  if (__JPED_SETTINGS_STARTED) return;
  __JPED_SETTINGS_STARTED = true;

  // garante permissão e restaurante carregados
  try{
    const pill = _setEl("setRidPill");
    if (pill) pill.textContent = `RID: ${RESTAURANT_ID || "-"}`;
  }catch(_){}

  const btnSave = _setEl("setSave");
  const btnReload = _setEl("setReload");
  if (btnSave) btnSave.onclick = _saveSettings;
  if (btnReload) btnReload.onclick = _reloadSettingsOnce;

  // Identidade (logo + fundo) + remove WhatsApp da seção
  try{ _ensureIdentityUI(); }catch(_){}

  // carrega e escuta em tempo real
  _setText("setStatus", "Carregando...");
  try { _ensurePromoEndsAtField(); } catch (_) {}
  try { _wireGeoLookupButton(); } catch (_) {}
  __JPED_HOURS_READY = false;
  _reloadSettingsOnce();
try{ _wirePromoPreview(); }catch(_){}
  // inicia ticker de horário (aberto/fechado)
  try{ _startHoursAutoTick(); }catch(_){ }

  if (__JPED_SETTINGS_UNSUB) { try{ __JPED_SETTINGS_UNSUB(); }catch(_){} }
  try{
    __JPED_SETTINGS_UNSUB = Firestore.onSnapshot(_settingsDocRef(), (snap) => {
      const data = snap.exists() ? (snap.data() || {}) : {};
      _applySettingsToForm(data);
      __JPED_HOURS_READY = true;
      try{ _updatePromoPreview(); }catch(_){}
      try{
        const h = (data && data.hours) ? data.hours : {};
        const r = _effectiveOpenFromHours(h);
        _paintOpenNowPill(r.effective, r.within ? "" : `fora do horário (${r.openStr||"??"}–${r.closeStr||"??"})`);
        __JPED_HOURS_LAST_EFFECTIVE = r.effective;
      }catch(_){ }
      _setText("setStatus", snap.exists() ? "Sincronizado (tempo real)." : "Nenhuma config salva ainda.");
      try{
        const pill = _setEl("setRidPill");
        if (pill) pill.textContent = `RID: ${RESTAURANT_ID || "-"}`;
      }catch(_){}
    }, (err) => {
      console.warn("Erro settings (snapshot):", err?.code || err, err?.message || "");
      _setText("setStatus", "Sem permissão para ler config.");
    });
  }catch(e){
    console.warn("Falha ao iniciar listener settings:", e?.code || e, e?.message || e);
  }
}


/* ===== Promoções & Cupons (painel dedicado) ===== */
let __JPED_PROMOS_STARTED = false;
let __JPED_PROMO_CAMPAIGNS = [];
let __JPED_PROMO_EDIT_ID = null;
let __JPED_PROMO_FEATURED_ID = "";

function _promoPanelEl(id){ return document.getElementById(id); }
function _promoNormId(){ return `promo_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function _promoFloat(v){
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function _promoInt(v){
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function _promoToLocal(raw){
  const s = String(raw || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function _promoToISOFromField(id){
  const v = String(_promoPanelEl(id)?.value || "").trim();
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function _promoBenefitLabel(type, value){
  if (type === "fixed") return value != null ? `${brl(value)} OFF` : "Desconto fixo";
  if (type === "free_delivery") return "Frete grátis";
  return value != null ? `${value}% OFF` : "Desconto";
}
function _promoCriteriaText(c){
  const parts = [];
  if (c?.inactiveDays) parts.push(`${c.inactiveDays}+ dias sem pedir`);
  if (c?.minOrder) parts.push(`mín. ${brl(c.minOrder)}`);
  if (c?.minLevel) parts.push(`nível ${String(c.minLevel).toUpperCase()}`);
  if (c?.usageLimit) parts.push(`limite ${c.usageLimit}`);
  return parts.length ? parts.join(" • ") : "Sem critérios obrigatórios";
}
function _promoCampaignFromForm(){
  return {
    id: __JPED_PROMO_EDIT_ID || _promoNormId(),
    name: String(_promoPanelEl("promoName")?.value || "").trim(),
    code: String(_promoPanelEl("promoCode")?.value || "").trim().toUpperCase(),
    type: String(_promoPanelEl("promoType")?.value || "percent").trim(),
    value: _promoFloat(_promoPanelEl("promoValue")?.value),
    minOrder: _promoFloat(_promoPanelEl("promoMinOrder")?.value),
    inactiveDays: _promoInt(_promoPanelEl("promoInactiveDays")?.value),
    minLevel: String(_promoPanelEl("promoMinLevel")?.value || "").trim(),
    usageLimit: _promoInt(_promoPanelEl("promoUsageLimit")?.value),
    startsAt: _promoToISOFromField("promoStartsAt"),
    endsAt: _promoToISOFromField("promoEndsAtPanel"),
    note: String(_promoPanelEl("promoNote")?.value || "").trim(),
    active: !!_promoPanelEl("promoActive")?.checked,
    autoApply: !!_promoPanelEl("promoAutoApply")?.checked,
    featured: !!_promoPanelEl("promoFeatured")?.checked,
    updatedAt: new Date().toISOString()
  };
}
function _promoMirrorFeaturedToLegacy(){
  const featured = __JPED_PROMO_CAMPAIGNS.find(x => x.id === __JPED_PROMO_FEATURED_ID) || __JPED_PROMO_CAMPAIGNS.find(x => x.featured) || null;
  if (!featured) return;
  try { _setChecked("setPromoOn", !!featured.active); } catch(_) {}
  try { _setVal("setPromoTitle", featured.name || "Promoção especial"); } catch(_) {}
  try { _setVal("setPromoSub", featured.note || _promoCriteriaText(featured)); } catch(_) {}
  try { _setVal("setCouponCode", featured.code || ""); } catch(_) {}
  try { _setVal("setCouponPct", featured.type === "percent" ? (featured.value ?? "") : ""); } catch(_) {}
  try { _setVal("setNotice", featured.autoApply ? "Aplicado automaticamente quando elegível" : _promoCriteriaText(featured)); } catch(_) {}
  try { _setVal("setPromoEndsAt", _promoToLocal(featured.endsAt || "")); } catch(_) {}
}
function _buildPromoCampaignsPayload(){
  return (__JPED_PROMO_CAMPAIGNS || []).map(item => ({
    id: item.id || _promoNormId(),
    name: String(item.name || "").trim(),
    code: String(item.code || "").trim().toUpperCase(),
    type: String(item.type || "percent").trim(),
    value: item.value == null ? null : Number(item.value),
    minOrder: item.minOrder == null ? null : Number(item.minOrder),
    inactiveDays: item.inactiveDays == null ? null : parseInt(item.inactiveDays,10),
    minLevel: String(item.minLevel || "").trim(),
    usageLimit: item.usageLimit == null ? null : parseInt(item.usageLimit,10),
    startsAt: String(item.startsAt || "").trim(),
    endsAt: String(item.endsAt || "").trim(),
    note: String(item.note || "").trim(),
    active: item.active !== false,
    autoApply: !!item.autoApply,
    featured: !!item.featured,
    updatedAt: String(item.updatedAt || new Date().toISOString())
  }));
}
function _resetPromoForm(){
  __JPED_PROMO_EDIT_ID = null;
  ["promoName","promoCode","promoValue","promoMinOrder","promoInactiveDays","promoUsageLimit","promoStartsAt","promoEndsAtPanel","promoNote"].forEach(id => { const el = _promoPanelEl(id); if (el) el.value = ""; });
  const type = _promoPanelEl("promoType"); if (type) type.value = "percent";
  const lvl = _promoPanelEl("promoMinLevel"); if (lvl) lvl.value = "";
  const active = _promoPanelEl("promoActive"); if (active) active.checked = true;
  const auto = _promoPanelEl("promoAutoApply"); if (auto) auto.checked = false;
  const feat = _promoPanelEl("promoFeatured"); if (feat) feat.checked = false;
  const mode = _promoPanelEl("promoEditModeLabel"); if (mode) mode.textContent = "Nova campanha";
  const st = _promoPanelEl("promoFormStatus"); if (st) st.textContent = "Pronto para criar uma nova campanha.";
}
function _fillPromoForm(item){
  if (!item) return;
  __JPED_PROMO_EDIT_ID = item.id || null;
  const map = { promoName:item.name, promoCode:item.code, promoValue:item.value, promoMinOrder:item.minOrder, promoInactiveDays:item.inactiveDays, promoUsageLimit:item.usageLimit, promoNote:item.note };
  Object.keys(map).forEach(id => { const el = _promoPanelEl(id); if (el) el.value = (map[id] ?? "") === null ? "" : String(map[id] ?? ""); });
  const type = _promoPanelEl("promoType"); if (type) type.value = item.type || "percent";
  const lvl = _promoPanelEl("promoMinLevel"); if (lvl) lvl.value = item.minLevel || "";
  const s = _promoPanelEl("promoStartsAt"); if (s) s.value = _promoToLocal(item.startsAt);
  const e = _promoPanelEl("promoEndsAtPanel"); if (e) e.value = _promoToLocal(item.endsAt);
  const active = _promoPanelEl("promoActive"); if (active) active.checked = item.active !== false;
  const auto = _promoPanelEl("promoAutoApply"); if (auto) auto.checked = !!item.autoApply;
  const feat = _promoPanelEl("promoFeatured"); if (feat) feat.checked = (__JPED_PROMO_FEATURED_ID === item.id) || !!item.featured;
  const mode = _promoPanelEl("promoEditModeLabel"); if (mode) mode.textContent = "Editando campanha";
  const st = _promoPanelEl("promoFormStatus"); if (st) st.textContent = `Editando: ${item.name || item.code || "campanha"}`;
}
function _applyPromosPanelData(cfg){
  const promo = (cfg && cfg.promo) ? cfg.promo : {};
  __JPED_PROMO_CAMPAIGNS = Array.isArray(promo.campaigns) ? promo.campaigns.map(x => Object.assign({}, x)) : [];
  __JPED_PROMO_FEATURED_ID = String(promo.featuredCampaignId || ( (__JPED_PROMO_CAMPAIGNS.find(x => x && x.featured) || {}).id || "" ));
  if (__JPED_PROMO_FEATURED_ID) {
    __JPED_PROMO_CAMPAIGNS = __JPED_PROMO_CAMPAIGNS.map(x => Object.assign({}, x, { featured: x.id === __JPED_PROMO_FEATURED_ID }));
  }
  _renderPromosPanel();
}
function _promoPreviewSource(){
  return (__JPED_PROMO_CAMPAIGNS.find(x => x.id === __JPED_PROMO_FEATURED_ID) || __JPED_PROMO_CAMPAIGNS.find(x => x.featured) || null);
}
function _renderPromosPanel(){
  const host = _promoPanelEl("promoList");
  const status = _promoPanelEl("promoStatusChip");
  const sub = _promoPanelEl("promoAdminSub");
  const total = __JPED_PROMO_CAMPAIGNS.length;
  const active = __JPED_PROMO_CAMPAIGNS.filter(x => x.active !== false).length;
  const featuredCount = __JPED_PROMO_CAMPAIGNS.filter(x => x.featured).length;
  if (_promoPanelEl("promoCount")) _promoPanelEl("promoCount").textContent = String(total);
  if (_promoPanelEl("promoActiveCount")) _promoPanelEl("promoActiveCount").textContent = String(active);
  if (_promoPanelEl("promoFeaturedCount")) _promoPanelEl("promoFeaturedCount").textContent = String(featuredCount);
  if (status) status.textContent = total ? `${total} campanha(s)` : "Sem campanhas";
  if (sub) sub.textContent = total ? "Tudo salvo no config/app, compatível com o cupom do perfil do cliente." : "Crie campanhas para cupom, reativação e aumento de ticket médio.";
  const featured = _promoPreviewSource();
  if (_promoPanelEl("promoPreviewBadge")) _promoPanelEl("promoPreviewBadge").textContent = featured ? "Cupom em destaque ativo" : "Sem destaque";
  if (_promoPanelEl("promoAdminPrevTitle")) _promoPanelEl("promoAdminPrevTitle").textContent = featured?.name || "Nenhuma campanha em destaque";
  if (_promoPanelEl("promoAdminPrevSub")) _promoPanelEl("promoAdminPrevSub").textContent = featured?.note || (featured ? _promoCriteriaText(featured) : "Crie ou selecione uma campanha para aparecer aqui.");
  if (_promoPanelEl("promoAdminPrevCoupon")) _promoPanelEl("promoAdminPrevCoupon").textContent = `CUPOM: ${featured?.code || "—"}`;
  if (_promoPanelEl("promoAdminPrevNotice")) _promoPanelEl("promoAdminPrevNotice").textContent = `Aviso: ${featured ? _promoBenefitLabel(featured.type, featured.value) : "—"}`;
  if (_promoPanelEl("promoAdminTag")) _promoPanelEl("promoAdminTag").textContent = featured?.active === false ? "PAUSADO" : "PROMO";
  if (!host) return;
  if (!total){ host.innerHTML = '<div class="promoItemEmpty">Nenhuma campanha criada ainda. Use o formulário acima para montar sua primeira promoção premium.</div>'; return; }
  host.innerHTML = __JPED_PROMO_CAMPAIGNS.map(item => {
    const criteria = _promoCriteriaText(item);
    const starts = item.startsAt ? new Date(item.startsAt).toLocaleString("pt-BR") : "Agora";
    const ends = item.endsAt ? new Date(item.endsAt).toLocaleString("pt-BR") : "Sem expiração";
    return `
      <div class="promoItem ${item.active === false ? 'promoMuted' : ''}" data-promo-id="${_escapeHtml(item.id || '')}">
        <div class="promoItemTop">
          <div>
            <div class="promoItemName">${_escapeHtml(item.name || 'Campanha sem nome')}</div>
            <div class="promoItemCode">${_escapeHtml(item.code || 'SEM-CUPOM')}</div>
          </div>
          <div class="promoMetaPill ${item.featured ? 'promoFeaturedRibbon' : ''}">${item.featured ? 'Destaque no cliente' : 'Campanha comum'}</div>
        </div>
        <div class="promoItemMeta">
          <div class="promoMetaPill">${_escapeHtml(_promoBenefitLabel(item.type, item.value))}</div>
          <div class="promoMetaPill">${_escapeHtml(criteria)}</div>
          <div class="promoMetaPill">Início: ${_escapeHtml(starts)}</div>
          <div class="promoMetaPill">Fim: ${_escapeHtml(ends)}</div>
          <div class="promoMetaPill">${item.autoApply ? 'Auto aplicar' : 'Uso manual'}</div>
        </div>
        <div class="promoItemNote">${_escapeHtml(item.note || 'Sem observação adicional.')}</div>
        <div class="promoItemActions">
          <button class="ghost small" type="button" data-promo-edit="${_escapeHtml(item.id || '')}">Editar</button>
          <button class="ghost small" type="button" data-promo-feature="${_escapeHtml(item.id || '')}">${item.featured ? 'Cupom destaque' : 'Definir destaque'}</button>
          <button class="ghost small danger" type="button" data-promo-delete="${_escapeHtml(item.id || '')}">Excluir</button>
        </div>
      </div>`;
  }).join("");
}
async function _savePromosPanel(){
  if (!SUBSCRIPTION_OK) { alert("Assinatura expirada. Ative um plano para salvar promoções."); return; }
  if (!ADMIN_OK) { try { await checkAdminAccess(); } catch(_) {} if (!ADMIN_OK) { alert("Sem permissão de admin."); return; } }
  if (!RESTAURANT_ID) { alert("Sem restaurantId."); return; }

  const draft = _promoCampaignFromForm();
  if (!draft.name) { alert("Digite o nome da campanha."); return; }
  if (!draft.code && !draft.autoApply) { alert("Digite um código de cupom ou marque aplicação automática."); return; }
  if (draft.type !== "free_delivery" && (draft.value == null || draft.value <= 0)) { alert("Informe um valor válido para a campanha."); return; }

  if (draft.featured) __JPED_PROMO_FEATURED_ID = draft.id;
  __JPED_PROMO_CAMPAIGNS = (__JPED_PROMO_CAMPAIGNS || []).filter(x => x.id !== draft.id);
  __JPED_PROMO_CAMPAIGNS.unshift(Object.assign({}, draft, { featured: __JPED_PROMO_FEATURED_ID === draft.id }));
  __JPED_PROMO_CAMPAIGNS = __JPED_PROMO_CAMPAIGNS.map(x => Object.assign({}, x, { featured: x.id === __JPED_PROMO_FEATURED_ID }));

  _promoMirrorFeaturedToLegacy();
  const btn = _promoPanelEl("promoSaveBtn");
  if (btn){ btn.disabled = true; btn.textContent = "Salvando..."; }
  try{
    const payload = _collectSettingsFromForm();
    await Firestore.setDoc(_settingsDocRef(), payload, { merge:true });
    _resetPromoForm();
    _renderPromosPanel();
  }catch(e){
    console.warn("Falha ao salvar promoções:", e?.code || e, e?.message || e);
    alert(e?.message || "Não foi possível salvar a campanha.");
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = "Salvar campanha"; }
  }
}
function _startPromosPanel(){
  if (__JPED_PROMOS_STARTED) return;
  __JPED_PROMOS_STARTED = true;
  const saveBtn = _promoPanelEl("promoSaveBtn");
  const reloadBtn = _promoPanelEl("promoReloadBtn");
  const clearBtn = _promoPanelEl("promoClearBtn");
  if (saveBtn) saveBtn.onclick = _savePromosPanel;
  if (reloadBtn) reloadBtn.onclick = _reloadSettingsOnce;
  if (clearBtn) clearBtn.onclick = _resetPromoForm;
  const list = _promoPanelEl("promoList");
  if (list && !list.dataset.bound){
    list.dataset.bound = "1";
    list.addEventListener("click", async (ev) => {
      const editBtn = ev.target.closest("[data-promo-edit]");
      const featBtn = ev.target.closest("[data-promo-feature]");
      const delBtn = ev.target.closest("[data-promo-delete]");
      if (editBtn){
        const id = editBtn.getAttribute("data-promo-edit");
        const item = __JPED_PROMO_CAMPAIGNS.find(x => x.id === id);
        _fillPromoForm(item);
        return;
      }
      if (featBtn){
        const id = featBtn.getAttribute("data-promo-feature");
        __JPED_PROMO_FEATURED_ID = id || "";
        __JPED_PROMO_CAMPAIGNS = __JPED_PROMO_CAMPAIGNS.map(x => Object.assign({}, x, { featured: x.id === __JPED_PROMO_FEATURED_ID }));
        _promoMirrorFeaturedToLegacy();
        _renderPromosPanel();
        return;
      }
      if (delBtn){
        const id = delBtn.getAttribute("data-promo-delete");
        __JPED_PROMO_CAMPAIGNS = __JPED_PROMO_CAMPAIGNS.filter(x => x.id !== id);
        if (__JPED_PROMO_FEATURED_ID === id) __JPED_PROMO_FEATURED_ID = ((__JPED_PROMO_CAMPAIGNS[0] || {}).id || "");
        __JPED_PROMO_CAMPAIGNS = __JPED_PROMO_CAMPAIGNS.map(x => Object.assign({}, x, { featured: x.id === __JPED_PROMO_FEATURED_ID }));
        _promoMirrorFeaturedToLegacy();
        _renderPromosPanel();
      }
    });
  }
  _resetPromoForm();
  _reloadSettingsOnce();
}

async function salvarCupom(codigo) {
  if (!RESTAURANT_ID) return;

  // ✅ mesmo doc de config que você já usa no settings
  const ref = Firestore.doc(db, "restaurants", RESTAURANT_ID, "config", "app");

  await Firestore.setDoc(ref, {
    updatedAt: Firestore.serverTimestamp(),
    promo: {
      couponCode: (codigo || "").trim()
    }
  }, { merge: true });

  alert("Cupom salvo!");
}

/* ===== Melhorias visuais da aba Configurações (sem alterar regras) ===== */
(function(){
  function initSettingsUX(){
    const page = document.getElementById('page-settings');
    if (!page || page.dataset.uiReady === '1') return;
    page.dataset.uiReady = '1';

    const navButtons = Array.from(page.querySelectorAll('.setQuickNavBtn[data-target]'));
    const cards = Array.from(page.querySelectorAll('[data-settings-card]'));

    function activate(targetId){
      navButtons.forEach((btn)=> btn.classList.toggle('is-active', btn.dataset.target === targetId));
    }

    navButtons.forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.target;
        const card = id ? document.getElementById(id) : null;
        if (!card) return;
        activate(id);
        card.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      });
    });

    const toggleButtons = Array.from(page.querySelectorAll('[data-card-toggle]'));
    toggleButtons.forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const card = btn.closest('[data-settings-card]');
        if (!card) return;
        const collapsed = card.classList.toggle('is-collapsed');
        btn.textContent = collapsed ? 'Mostrar' : 'Ocultar';
      });
    });

    if ('IntersectionObserver' in window && cards.length && navButtons.length){
      const obs = new IntersectionObserver((entries)=>{
        const visible = entries
          .filter((entry)=> entry.isIntersecting)
          .sort((a,b)=> b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) activate(visible.target.id);
      }, { root: null, threshold: [0.25, 0.45, 0.65], rootMargin: '-10% 0px -55% 0px' });
      cards.forEach((card)=> obs.observe(card));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsUX, { once:true });
  } else {
    initSettingsUX();
  }

  const _origSetupSettingsPage = typeof setupSettingsPage === 'function' ? setupSettingsPage : null;
  if (_origSetupSettingsPage) {
    setupSettingsPage = async function(...args){
      const result = await _origSetupSettingsPage.apply(this, args);
      try { initSettingsUX(); } catch(_) {}
      return result;
    };
  }
})();
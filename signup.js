import * as FirebaseApp from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import * as Auth from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import * as Firestore from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** ✅ Firebase config (mesmo do seu projeto) */
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

const plansEl = document.getElementById("plans");
const selectedPlanEl = document.getElementById("selectedPlan");
const form = document.getElementById("signupForm");
const msgEl = document.getElementById("msg");

const restNameEl = document.getElementById("restName");
const restWhatsappEl = document.getElementById("restWhatsapp");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const createBtn = document.getElementById("createBtn");
const goLoginBtn = document.getElementById("goLogin");

let selectedPlan = "basic";

function showMsg(text, type = "error") {
  msgEl.style.display = "block";
  msgEl.className = type === "ok" ? "ok" : "error";
  msgEl.textContent = text;
}

function hideMsg() {
  msgEl.style.display = "none";
  msgEl.textContent = "";
}

function pickPlan(plan) {
  selectedPlan = plan;
  selectedPlanEl.textContent = plan;
  plansEl.querySelectorAll(".plan").forEach(el => {
    el.classList.toggle("selected", el.dataset.plan === plan);
  });
}

plansEl.addEventListener("click", (e) => {
  const card = e.target.closest(".plan");
  if (!card) return;
  pickPlan(card.dataset.plan);
});

pickPlan("basic");

function normalizePhone(v) {
  return String(v || "").replace(/\D+/g, "");
}

function genRestaurantId() {
  // id amigável e curto
  const rnd = Math.random().toString(36).slice(2, 8);
  return `r_${Date.now().toString(36)}_${rnd}`;
}

function planInfo(tier) {
  const map = {
    basic: { tier: "basic", name: "Básico", priceBRL: 39 },
    gold: { tier: "gold", name: "Gold", priceBRL: 69 },
    diamond: { tier: "diamond", name: "Diamante", priceBRL: 99 }
  };
  return map[tier] || map.basic;
}

goLoginBtn.addEventListener("click", () => {
  // ajuste se seu painel de login for outro arquivo
  window.location.href = "./admin.html";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMsg();

  const restName = String(restNameEl.value || "").trim();
  const restWhatsapp = normalizePhone(restWhatsappEl.value);
  const email = String(emailEl.value || "").trim();
  const password = String(passEl.value || "");

  if (restName.length < 2) return showMsg("Digite o nome do restaurante.");
  if (restWhatsapp.length < 10) return showMsg("WhatsApp inválido. Use DDI+DDD+NÚMERO (só números).");
  if (password.length < 6) return showMsg("Senha precisa ter no mínimo 6 caracteres.");

  createBtn.disabled = true;
  createBtn.textContent = "Criando...";

  try {
    // 1) cria usuário
    const cred = await Auth.createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // 2) cria restaurante
    const rid = genRestaurantId();
    const plan = planInfo(selectedPlan);

    const restaurantDoc = {
      name: restName,
      whatsapp: restWhatsapp,
      slug: restName.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
        .slice(0, 48),
      createdAt: Firestore.serverTimestamp(),
      ownerUid: uid,
      plan: {
        tier: plan.tier,
        name: plan.name,
        priceBRL: plan.priceBRL,
        status: "active",
        createdAt: Firestore.serverTimestamp()
      }
    };

    await Firestore.setDoc(Firestore.doc(db, "restaurants", rid), restaurantDoc);

// 3) cria user profile (multi-tenant) — precisa vir ANTES do config, porque as rules do config usam isOwner()
await Firestore.setDoc(
  Firestore.doc(db, "users", uid),
  {
    email,
    role: "owner",
    restaurantId: rid,
    planTier: plan.tier,
    createdAt: Firestore.serverTimestamp()
  },
  { merge: true }
);

// 4) cria config inicial
await Firestore.setDoc(
  Firestore.doc(db, "restaurants", rid, "config", "main"),
  {
    isOpen: true,
    createdAt: Firestore.serverTimestamp(),
    updatedAt: Firestore.serverTimestamp()
  },
  { merge: true }
);
    showMsg("Restaurante criado! Entrando no painel...", "ok");

    // 5) vai pro painel (ajuste se sua rota for diferente)
    setTimeout(() => {
      window.location.href = "./admin.html";
    }, 600);
  } catch (err) {
    console.error(err);
    const code = err?.code || "";
    if (code.includes("auth/email-already-in-use")) {
      showMsg("Esse email já está em uso. Faça login.");
    } else if (code.includes("permission-denied")) {
      showMsg("Permissão negada nas regras do Firestore. Precisa liberar CREATE do restaurante e do user no signup.");
    } else {
      showMsg("Erro ao criar. Veja o console (F12).");
    }
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = "Criar restaurante";
  }
});
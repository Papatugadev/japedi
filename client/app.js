// 1) Import do Firebase via CDN (web)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// 2) COLE AQUI o firebaseConfig do seu projeto
const firebaseConfig = {
  apiKey: "AIzaSyAQsb1pCGm6BNkGuKBDsBzXdnyHAyH1JXc",
  authDomain: "japed-e09f2.firebaseapp.com",
  projectId: "japed-e09f2",
  storageBucket: "japed-e09f2.firebasestorage.app",
  messagingSenderId: "715293947768",
  appId: "1:715293947768:web:66c67dc1c33953c0ec3a8d"
};

// 3) Inicializa Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 4) Pega o slug da URL: /r/pizzaria-do-ze
function getSlugFromUrl() {

  // 1) tenta pegar por query (?r=slug)
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get("r");
  if (querySlug) return querySlug;

  // 2) tenta pegar por path (/r/slug) — Vercel
  const path = window.location.pathname || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "r" && parts[1]) return parts[1];

  return null;
}

// 5) Buscar restaurante pelo slug
async function findRestaurantBySlug(slug) {
  const q = query(collection(db, "restaurants"), where("slug", "==", slug));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() }; // id = restaurantId
}

// 6) Buscar produtos do restaurante
async function loadProducts(restaurantId) {
  const productsRef = collection(db, "restaurants", restaurantId, "products");
  const snap = await getDocs(productsRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 7) Render
function renderRestaurant(rest, products) {
  document.getElementById("title").textContent = rest.name || "Restaurante";
  document.getElementById("desc").textContent = rest.whatsapp ? `WhatsApp: ${rest.whatsapp}` : "";

  const wrap = document.getElementById("products");
  wrap.innerHTML = "";

  products
    .filter(p => p.active !== false)
    .forEach(p => {
      const div = document.createElement("div");
      div.className = "box";
      div.innerHTML = `
        <div><strong>${p.name || "Produto"}</strong></div>
        <div>${p.desc || ""}</div>
        <div class="price">R$ ${Number(p.price || 0).toFixed(2)}</div>
      `;
      wrap.appendChild(div);
    });
}

// 8) Start
(async function main(){
  const slug = getSlugFromUrl();
  if (!slug) {
    document.getElementById("title").textContent = "URL inválida. Use /r/seu-slug";
    return;
  }

  const rest = await findRestaurantBySlug(slug);
  if (!rest) {
    document.getElementById("title").textContent = "Restaurante não encontrado";
    return;
  }

  const products = await loadProducts(rest.id);
  renderRestaurant(rest, products);
})();
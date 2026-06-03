import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CONFIG ───────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDe_7GdbVfwcVeG19lj_4ZkL0zKZaLP68o",
  authDomain: "fisioplus-cd92b.firebaseapp.com",
  projectId: "fisioplus-cd92b",
  storageBucket: "fisioplus-cd92b.firebasestorage.app",
  messagingSenderId: "137208430197",
  appId: "1:137208430197:web:6be479df7f7bc7fb31023c"
};

const ADMIN_EMAIL = "flcerqueira@gmail.com";

// ─── EMAILJS CONFIG ───────────────────────────────────────────────────────
const EMAILJS_SERVICE_ID = "service_tm0udfi";
const EMAILJS_TEMPLATE_ID = "template_hxr1raj";
const EMAILJS_PUBLIC_KEY = "Vr9itk38fpBYXI3E4";

async function sendApprovalEmail(userName, userEmail) {
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_name: userName,
      email: userEmail
    }, EMAILJS_PUBLIC_KEY);
    console.log("E-mail de aprovação enviado para", userEmail);
  } catch (e) {
    console.error("Erro ao enviar e-mail:", e);
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── STATE ────────────────────────────────────────────────────────────────
let currentUser = null;
let currentUserData = null;
let allExercises = [];
let favorites = new Set();
let selectedForPlan = [];
let currentPage = "dashboard";
let editingExerciseId = null;
let currentDetailExercise = null;

// ─── HELPERS ──────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function el(id) { return document.getElementById(id); }
function showError(id, msg) { const e = el(id); e.textContent = msg; e.classList.remove("hidden"); }
function hideError(id) { el(id)?.classList.add("hidden"); }

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("pt-BR");
}

// ─── AUTH STATE ───────────────────────────────────────────────────────────
// Se for link de paciente, ignora todo o fluxo de auth
const _patientPlanId = new URLSearchParams(window.location.search).get("plan");
if (_patientPlanId) {
  showPatientView(_patientPlanId);
} else {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadUserData(user);
    } else {
      currentUser = null;
      currentUserData = null;
      showAuthScreen();
    }
  });
}

async function loadUserData(user) {
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      // Admin auto-approve
      if (user.email === ADMIN_EMAIL) {
        await setDoc(doc(db, "users", user.uid), {
          name: "Admin", email: user.email,
          role: "admin", status: "approved",
          createdAt: serverTimestamp()
        });
        currentUserData = { name: "Admin", role: "admin", status: "approved" };
      } else {
        showAuthScreen();
        return;
      }
    } else {
      currentUserData = userDoc.data();
    }

    if (currentUserData.status === "pending") {
      showPendingScreen();
      return;
    }

    showApp();
  } catch (e) {
    console.error(e);
    showAuthScreen();
  }
}

// ─── AUTH SCREENS ─────────────────────────────────────────────────────────
function showAuthScreen() {
  hide("app"); hide("pending-screen"); hide("patient-view");
  show("auth-screen");
}
function showPendingScreen() {
  hide("app"); hide("auth-screen"); hide("patient-view");
  show("pending-screen");
}
function showApp() {
  hide("auth-screen"); hide("pending-screen"); hide("patient-view");
  show("app");

  // Set header info
  el("header-username").textContent = currentUserData.name || currentUser.email;
  const roleEl = el("header-role-badge");
  if (currentUserData.role === "admin") {
    roleEl.textContent = "Admin";
    roleEl.className = "badge badge-admin";
    show("admin-nav");
    el("stat-users-card").style.display = "flex";
  } else {
    roleEl.textContent = "Profissional";
    roleEl.className = "badge badge-approved";
    hide("admin-nav");
  }

  navigateTo("dashboard");
  loadFavorites();
}

// ─── AUTH TABS ────────────────────────────────────────────────────────────
window.switchAuthTab = (tab) => {
  el("login-form").classList.toggle("hidden", tab !== "login");
  el("register-form").classList.toggle("hidden", tab !== "register");
  document.querySelectorAll(".auth-tab").forEach((t, i) => {
    t.classList.toggle("active", (i === 0 && tab === "login") || (i === 1 && tab === "register"));
  });
};

// ─── LOGIN ────────────────────────────────────────────────────────────────
window.doLogin = async () => {
  hideError("login-error");
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  if (!email || !password) { showError("login-error", "Preencha todos os campos."); return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const msgs = {
      "auth/user-not-found": "Usuário não encontrado.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-credential": "E-mail ou senha inválidos.",
      "auth/too-many-requests": "Muitas tentativas. Tente mais tarde."
    };
    showError("login-error", msgs[e.code] || "Erro ao entrar.");
  }
};

// ─── REGISTER ────────────────────────────────────────────────────────────
window.doRegister = async () => {
  hideError("register-error");
  hide("register-success");
  const name = el("reg-name").value.trim();
  const crefito = el("reg-crefito").value.trim();
  const email = el("reg-email").value.trim();
  const password = el("reg-password").value;
  if (!name || !email || !password) { showError("register-error", "Preencha todos os campos obrigatórios."); return; }
  if (password.length < 6) { showError("register-error", "Senha mínima de 6 caracteres."); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      name, crefito, email, role: "professional",
      status: "pending", createdAt: serverTimestamp()
    });
    show("register-success");
    el("register-success").textContent = "Cadastro enviado! Aguarde aprovação do administrador.";
  } catch (e) {
    const msgs = {
      "auth/email-already-in-use": "Este e-mail já está cadastrado.",
      "auth/invalid-email": "E-mail inválido."
    };
    showError("register-error", msgs[e.code] || "Erro ao cadastrar.");
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────
window.doLogout = async () => {
  await signOut(auth);
  selectedForPlan = [];
  favorites.clear();
};

// ─── NAVIGATION ──────────────────────────────────────────────────────────
window.navigateTo = (page) => {
  currentPage = page;
  document.querySelectorAll("[id^='page-']").forEach(p => p.classList.add("hidden"));
  show(`page-${page}`);
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  el(`nav-${page}`)?.classList.add("active");

  if (page === "dashboard") loadDashboard();
  else if (page === "exercises") loadExercisesPage();
  else if (page === "favorites") loadFavoritesPage();
  else if (page === "plans") loadPlansPage();
  else if (page === "manage-exercises") loadManageExercises();
  else if (page === "users") loadUsers();
};

// ─── DASHBOARD ───────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const exSnap = await getDocs(collection(db, "exercises"));
    el("stat-exercises").textContent = exSnap.size;
    const planSnap = await getDocs(query(collection(db, "plans"), where("createdBy", "==", currentUser.uid)));
    el("stat-plans").textContent = planSnap.size;
    el("stat-favorites").textContent = favorites.size;
    if (currentUserData.role === "admin") {
      const usersSnap = await getDocs(query(collection(db, "users"), where("status", "==", "approved")));
      el("stat-users").textContent = usersSnap.size;
    }
  } catch (e) { console.error(e); }
}

// ─── LOAD EXERCISES ───────────────────────────────────────────────────────
async function loadExercisesFromDB() {
  const snap = await getDocs(query(collection(db, "exercises"), orderBy("name")));
  allExercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return allExercises;
}

async function loadFavorites() {
  try {
    const favDoc = await getDoc(doc(db, "favorites", currentUser.uid));
    if (favDoc.exists()) {
      favorites = new Set(favDoc.data().exerciseIds || []);
    }
  } catch (e) { console.error(e); }
}

async function saveFavorites() {
  await setDoc(doc(db, "favorites", currentUser.uid), {
    exerciseIds: [...favorites], userId: currentUser.uid
  });
}

// ─── EXERCISES PAGE ──────────────────────────────────────────────────────
async function loadExercisesPage() {
  el("plan-count").textContent = selectedForPlan.length;
  el("exercises-grid").innerHTML = `<div class="loading-center"><div class="spinner"></div><span class="text-muted">Carregando...</span></div>`;
  await loadExercisesFromDB();
  buildTagFilters();
  renderExercisesGrid(allExercises);
}

function buildTagFilters() {
  const allTags = new Set();
  allExercises.forEach(ex => (ex.tags || []).forEach(t => allTags.add(t)));
  const wrap = el("tag-filters");
  wrap.innerHTML = `<span class="filter-tag active" data-tag="all" onclick="selectTag(this,'all')">Todos</span>`;
  [...allTags].sort().forEach(tag => {
    const span = document.createElement("span");
    span.className = "filter-tag";
    span.dataset.tag = tag;
    span.textContent = tag;
    span.onclick = () => selectTag(span, tag);
    wrap.appendChild(span);
  });
}

window.selectTag = (el_tag, tag) => {
  document.querySelectorAll(".filter-tag").forEach(t => t.classList.remove("active"));
  el_tag.classList.add("active");
  filterExercises();
};

window.filterExercises = () => {
  const search = el("search-input").value.toLowerCase();
  const activeTag = document.querySelector(".filter-tag.active")?.dataset.tag || "all";
  const filtered = allExercises.filter(ex => {
    const matchSearch = !search ||
      ex.name.toLowerCase().includes(search) ||
      (ex.description || "").toLowerCase().includes(search) ||
      (ex.tags || []).some(t => t.toLowerCase().includes(search));
    const matchTag = activeTag === "all" || (ex.tags || []).includes(activeTag);
    return matchSearch && matchTag;
  });
  renderExercisesGrid(filtered);
};

function renderExercisesGrid(exercises) {
  const grid = el("exercises-grid");
  if (!exercises.length) {
    grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;"><p class="text-muted">Nenhum exercício encontrado.</p></div>`;
    return;
  }
  grid.innerHTML = exercises.map(ex => renderExerciseCard(ex)).join("");
}

function renderExerciseCard(ex) {
  const isFav = favorites.has(ex.id);
  const isSelected = selectedForPlan.find(s => s.id === ex.id);
  const imgContent = ex.imageData
    ? `<img src="${ex.imageData}" alt="${ex.name}" />`
    : `<span>🏋️</span>`;

  return `
    <div class="exercise-card ${isSelected ? 'selected' : ''}" id="excard-${ex.id}">
      <div class="exercise-img" onclick="openDetailModal('${ex.id}')">${imgContent}</div>
      <button class="fav-btn" onclick="toggleFavorite(event,'${ex.id}')" title="${isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">
        ${isFav ? "⭐" : "☆"}
      </button>
      ${isSelected ? `<div class="select-check">✅</div>` : ""}
      <div class="exercise-body" onclick="openDetailModal('${ex.id}')">
        <div class="exercise-name">${ex.name}</div>
        <div class="exercise-desc">${ex.description || ""}</div>
        <div class="tags-wrap">
          ${(ex.tags || []).map(t => `<span class="tag">${t}</span>`).join("")}
        </div>
      </div>
      <div class="exercise-actions">
        <button class="btn btn-secondary btn-sm w-full" onclick="togglePlanSelect(event,'${ex.id}')">
          ${isSelected ? "✅ Selecionado" : "➕ Adicionar ao Plano"}
        </button>
      </div>
    </div>`;
}

// ─── FAVORITES PAGE ──────────────────────────────────────────────────────
async function loadFavoritesPage() {
  el("favorites-grid").innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  await loadExercisesFromDB();
  const favExercises = allExercises.filter(ex => favorites.has(ex.id));
  const grid = el("favorites-grid");
  if (!favExercises.length) {
    grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1;"><p class="text-muted">Você ainda não tem favoritos.<br>Explore os exercícios e marque com ⭐</p></div>`;
    return;
  }
  grid.innerHTML = favExercises.map(ex => renderExerciseCard(ex)).join("");
}

// ─── TOGGLE FAVORITE ─────────────────────────────────────────────────────
window.toggleFavorite = async (e, exId) => {
  e.stopPropagation();
  if (favorites.has(exId)) favorites.delete(exId);
  else favorites.add(exId);
  await saveFavorites();
  // Re-render current page
  if (currentPage === "exercises") filterExercises();
  else if (currentPage === "favorites") loadFavoritesPage();
};

// ─── PLAN SELECTION ───────────────────────────────────────────────────────
window.togglePlanSelect = (e, exId) => {
  e.stopPropagation();
  const ex = allExercises.find(x => x.id === exId);
  if (!ex) return;
  const idx = selectedForPlan.findIndex(x => x.id === exId);
  if (idx >= 0) selectedForPlan.splice(idx, 1);
  else selectedForPlan.push(ex);
  el("plan-count").textContent = selectedForPlan.length;
  filterExercises();
  if (el("plan-panel").classList.contains("open")) renderPlanPanel();
};

// ─── PLAN PANEL ───────────────────────────────────────────────────────────
window.openPlanPanel = () => {
  el("plan-panel").classList.add("open");
  el("main").classList.add("plan-open");
  hide("plan-link-result");
  renderPlanPanel();
};
window.closePlanPanel = () => {
  el("plan-panel").classList.remove("open");
  el("main").classList.remove("plan-open");
};

function renderPlanPanel() {
  const list = el("plan-exercises-list");
  if (!selectedForPlan.length) {
    list.innerHTML = `<p class="text-muted" style="font-size:13px;text-align:center;padding:20px 0;">Selecione exercícios na biblioteca.</p>`;
    return;
  }
  list.innerHTML = selectedForPlan.map((ex, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:8px;">
      <div style="width:28px;height:28px;background:var(--accent-soft);color:var(--accent);border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;flex-shrink:0;">${i + 1}</div>
      <div style="flex:1;font-size:13px;font-weight:500;">${ex.name}</div>
      <button onclick="removePlanItem('${ex.id}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;">✕</button>
    </div>
  `).join("");
}

window.removePlanItem = (exId) => {
  selectedForPlan = selectedForPlan.filter(x => x.id !== exId);
  el("plan-count").textContent = selectedForPlan.length;
  renderPlanPanel();
  filterExercises();
};

// ─── GENERATE PLAN LINK ───────────────────────────────────────────────────
window.generatePlanLink = async () => {
  const patientName = el("plan-patient-name").value.trim();
  if (!selectedForPlan.length) { alert("Selecione ao menos um exercício."); return; }
  if (!patientName) { alert("Informe o nome do paciente."); return; }
  try {
    const planRef = await addDoc(collection(db, "plans"), {
      patientName,
      exerciseIds: selectedForPlan.map(ex => ex.id),
      createdBy: currentUser.uid,
      createdByName: currentUserData.name,
      createdAt: serverTimestamp()
    });
    const link = `${window.location.origin}${window.location.pathname}?plan=${planRef.id}`;
    el("plan-link-input").value = link;
    show("plan-link-result");
  } catch (e) {
    alert("Erro ao gerar link: " + e.message);
  }
};

window.copyPlanLink = () => {
  el("plan-link-input").select();
  navigator.clipboard.writeText(el("plan-link-input").value);
  el("plan-link-input").blur();
  alert("Link copiado!");
};

// ─── PLANS PAGE ───────────────────────────────────────────────────────────
async function loadPlansPage() {
  const tbody = el("plans-table-body");
  tbody.innerHTML = `<tr><td colspan="5" class="text-center"><div class="spinner" style="margin:20px auto;"></div></td></tr>`;
  try {
    const snap = await getDocs(query(
      collection(db, "plans"),
      where("createdBy", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    ));
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:32px;">Nenhum plano criado ainda.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const link = `${window.location.origin}${window.location.pathname}?plan=${d.id}`;
      return `
        <tr>
          <td><strong>${p.patientName}</strong></td>
          <td>${(p.exerciseIds || []).length} exercício(s)</td>
          <td>${formatDate(p.createdAt)}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="copyLink('${link}')">📋 Copiar</button>
          </td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="deletePlan('${d.id}')">🗑</button>
          </td>
        </tr>`;
    }).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Erro ao carregar.</td></tr>`; }
}

window.copyLink = (link) => { navigator.clipboard.writeText(link); alert("Link copiado!"); };
window.deletePlan = async (id) => {
  if (!confirm("Excluir este plano?")) return;
  await deleteDoc(doc(db, "plans", id));
  loadPlansPage();
};

// ─── DETAIL MODAL ────────────────────────────────────────────────────────
window.openDetailModal = (exId) => {
  const ex = allExercises.find(x => x.id === exId);
  if (!ex) return;
  currentDetailExercise = ex;
  el("detail-modal-title").textContent = ex.name;
  el("detail-desc").textContent = ex.description || "—";
  el("detail-instructions").textContent = ex.instructions || "—";
  el("detail-sets").textContent = ex.sets || "—";
  el("detail-frequency").textContent = ex.frequency || "—";
  const imgWrap = el("detail-img-wrap");
  imgWrap.innerHTML = ex.imageData
    ? `<img src="${ex.imageData}" style="width:100%;max-height:300px;object-fit:cover;border-radius:var(--radius);" />`
    : "";
  const tagsWrap = el("detail-tags-wrap");
  tagsWrap.innerHTML = (ex.tags || []).map(t => `<span class="tag">${t}</span>`).join(" ");
  const isSelected = selectedForPlan.find(s => s.id === exId);
  const addBtn = el("detail-add-plan-btn");
  addBtn.textContent = isSelected ? "✅ Já no Plano" : "➕ Adicionar ao Plano";
  addBtn.onclick = () => { togglePlanSelect(new Event("click"), exId); closeDetailModal(); };
  show("detail-modal");
};
window.closeDetailModal = () => hide("detail-modal");

// ─── MANAGE EXERCISES (Admin) ─────────────────────────────────────────────
async function loadManageExercises() {
  const tbody = el("manage-exercises-tbody");
  tbody.innerHTML = `<tr><td colspan="4" class="text-center"><div class="spinner" style="margin:20px auto;"></div></td></tr>`;
  await loadExercisesFromDB();
  if (!allExercises.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:32px;">Nenhum exercício cadastrado. Clique em "Novo Exercício".</td></tr>`;
    return;
  }
  tbody.innerHTML = allExercises.map(ex => `
    <tr>
      <td>
        ${ex.imageData
          ? `<img src="${ex.imageData}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;" />`
          : `<div style="width:52px;height:52px;background:var(--surface2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;">🏋️</div>`}
      </td>
      <td><strong>${ex.name}</strong></td>
      <td><div class="tags-wrap">${(ex.tags || []).map(t => `<span class="tag">${t}</span>`).join("")}</div></td>
      <td>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="openExerciseModal('${ex.id}')">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteExercise('${ex.id}')">🗑</button>
        </div>
      </td>
    </tr>`).join("");
}

// ─── EXERCISE MODAL ───────────────────────────────────────────────────────
window.openExerciseModal = (exId = null) => {
  editingExerciseId = exId;
  el("exercise-modal-title").textContent = exId ? "Editar Exercício" : "Novo Exercício";
  el("exercise-edit-id").value = exId || "";
  el("ex-name").value = "";
  el("ex-desc").value = "";
  el("ex-instructions").value = "";
  el("ex-sets").value = "";
  el("ex-frequency").value = "";
  el("ex-tags").value = "";
  el("ex-img-data").value = "";
  el("ex-img-preview").classList.add("hidden");
  el("upload-placeholder").classList.remove("hidden");

  if (exId) {
    const ex = allExercises.find(x => x.id === exId);
    if (ex) {
      el("ex-name").value = ex.name || "";
      el("ex-desc").value = ex.description || "";
      el("ex-instructions").value = ex.instructions || "";
      el("ex-sets").value = ex.sets || "";
      el("ex-frequency").value = ex.frequency || "";
      el("ex-tags").value = (ex.tags || []).join(", ");
      if (ex.imageData) {
        el("ex-img-data").value = ex.imageData;
        el("ex-img-preview").src = ex.imageData;
        el("ex-img-preview").classList.remove("hidden");
        el("upload-placeholder").classList.add("hidden");
      }
    }
  }
  show("exercise-modal");
};
window.closeExerciseModal = () => hide("exercise-modal");

window.previewImage = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert("Imagem muito grande. Use imagens menores que 2MB.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    el("ex-img-data").value = data;
    el("ex-img-preview").src = data;
    el("ex-img-preview").classList.remove("hidden");
    el("upload-placeholder").classList.add("hidden");
  };
  reader.readAsDataURL(file);
};

window.saveExercise = async () => {
  const name = el("ex-name").value.trim();
  const description = el("ex-desc").value.trim();
  const instructions = el("ex-instructions").value.trim();
  const sets = el("ex-sets").value.trim();
  const frequency = el("ex-frequency").value.trim();
  const tagsRaw = el("ex-tags").value.trim();
  const imageData = el("ex-img-data").value;
  const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

  if (!name) { alert("Informe o nome do exercício."); return; }

  const data = { name, description, instructions, sets, frequency, tags, imageData, updatedAt: serverTimestamp() };

  try {
    if (editingExerciseId) {
      await updateDoc(doc(db, "exercises", editingExerciseId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "exercises"), data);
    }
    closeExerciseModal();
    loadManageExercises();
  } catch (e) { alert("Erro ao salvar: " + e.message); }
};

window.deleteExercise = async (id) => {
  if (!confirm("Excluir este exercício?")) return;
  await deleteDoc(doc(db, "exercises", id));
  loadManageExercises();
};

// ─── USERS (Admin) ────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = el("users-tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="text-center"><div class="spinner" style="margin:20px auto;"></div></td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:32px;">Nenhum usuário.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const u = d.data();
      const isAdmin = u.email === ADMIN_EMAIL;
      const statusBadge = isAdmin
        ? `<span class="badge badge-admin">Admin</span>`
        : u.status === "approved"
          ? `<span class="badge badge-approved">✅ Ativo</span>`
          : `<span class="badge badge-pending">⏳ Pendente</span>`;
      const actions = isAdmin ? "—" : u.status === "pending"
        ? `<button class="btn btn-primary btn-sm" onclick="approveUser('${d.id}')">✅ Aprovar</button>`
        : `<button class="btn btn-danger btn-sm" onclick="revokeUser('${d.id}')">🚫 Revogar</button>`;
      return `
        <tr>
          <td><strong>${u.name || "—"}</strong></td>
          <td>${u.email}</td>
          <td>${u.crefito || "—"}</td>
          <td>${statusBadge}</td>
          <td>${actions}</td>
        </tr>`;
    }).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Erro ao carregar.</td></tr>`; }
}

window.approveUser = async (uid) => {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  const userDoc = await getDoc(doc(db, "users", uid));
  if (userDoc.exists()) {
    const u = userDoc.data();
    await sendApprovalEmail(u.name || "Profissional", u.email);
  }
  loadUsers();
};
window.revokeUser = async (uid) => {
  if (!confirm("Revogar acesso deste usuário?")) return;
  await updateDoc(doc(db, "users", uid), { status: "pending" });
  loadUsers();
};

// ─── PATIENT VIEW ─────────────────────────────────────────────────────────
async function showPatientView(planId) {
  hide("auth-screen"); hide("app"); hide("pending-screen");
  show("patient-view");

  const planDoc = await getDoc(doc(db, "plans", planId));
  if (!planDoc.exists()) {
    el("patient-exercises-list").innerHTML = `<div class="alert alert-danger">Plano não encontrado ou expirado.</div>`;
    return;
  }
  const plan = planDoc.data();
  el("patient-plan-title").textContent = `Plano de Exercícios — ${plan.patientName}`;
  el("patient-plan-subtitle").textContent = `Prescrito por ${plan.createdByName || "seu fisioterapeuta"} • ${formatDate(plan.createdAt)}`;

  // Load exercises
  const exerciseIds = plan.exerciseIds || [];
  const exercises = await Promise.all(exerciseIds.map(async (id) => {
    const d = await getDoc(doc(db, "exercises", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  }));

  const container = el("patient-exercises-list");
  container.innerHTML = exercises.filter(Boolean).map((ex, i) => `
    <div class="patient-exercise">
      <div class="patient-exercise-header" onclick="togglePatientExercise('pex-${i}')">
        <div class="patient-exercise-num">${i + 1}</div>
        <div class="patient-exercise-info">
          <div class="patient-exercise-name">${ex.name}</div>
          <div style="font-size:12px;color:var(--text-muted);">${(ex.tags || []).join(" • ")}</div>
        </div>
        <span id="pex-arrow-${i}" style="color:var(--text-muted);font-size:18px;">▼</span>
      </div>
      <div id="pex-${i}" class="patient-exercise-body hidden">
        ${ex.imageData ? `<img src="${ex.imageData}" class="patient-exercise-img" style="display:block;" />` : ""}
        <div class="mb-4">
          <div class="section-label">Descrição</div>
          <div class="exercise-detail-text">${ex.description || "—"}</div>
        </div>
        <div class="mb-4">
          <div class="section-label">Como Executar</div>
          <div class="exercise-detail-text" style="white-space:pre-line;">${ex.instructions || "—"}</div>
        </div>
        ${ex.sets || ex.frequency ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${ex.sets ? `<div><div class="section-label">Séries / Repetições</div><div class="exercise-detail-text">${ex.sets}</div></div>` : ""}
          ${ex.frequency ? `<div><div class="section-label">Frequência</div><div class="exercise-detail-text">${ex.frequency}</div></div>` : ""}
        </div>` : ""}
      </div>
    </div>`).join("");
}

window.togglePatientExercise = (id) => {
  const body = el(id);
  const idx = id.replace("pex-", "");
  const arrow = el(`pex-arrow-${idx}`);
  const isHidden = body.classList.contains("hidden");
  body.classList.toggle("hidden", !isHidden);
  arrow.textContent = isHidden ? "▲" : "▼";
};



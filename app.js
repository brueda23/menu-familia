"use strict";

const DIAS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const COMIDAS = [["desayuno","Desayuno"],["comida","Comida"],["merienda","Merienda"],["cena","Cena"]];
const SECCIONES = ["Fruta y verdura","Carne y pescado","Lácteos y huevos","Panadería","Despensa","Congelados","Bebidas","Limpieza y hogar","Otros"];
const UNIDADES = ["g","kg","ml","l","ud","cda","cdta","al gusto"];
const GUESS = [
  ["Fruta y verdura", /tomate|cebolla|ajo|patata|zanahoria|pimiento|lechuga|calabac|calabaza|espinaca|puerro|pepino|manzana|plátano|platano|naranja|limón|limon|fresa|pera|uva|kiwi|perejil|brócoli|brocoli|judía verde|champi|seta|aguacate|fruta|verdura/i],
  ["Carne y pescado", /pollo|ternera|cerdo|lomo|chorizo|jamón|jamon|morcilla|carne|merluza|salmón|salmon|bacalao|gamba|calamar|mejillón|pescado|panceta|tocino|salchicha|hamburguesa|pavo/i],
  ["Lácteos y huevos", /leche|yogur|queso|huevo|mantequilla|nata/i],
  ["Panadería", /\bpan\b|baguette|barra|pan de molde|bollo/i],
  ["Congelados", /congelad|helado/i],
  ["Bebidas", /agua|zumo|refresco|vino|cerveza/i],
];
const LIMPIEZA = /limpi|detergente|papel|lavavajillas|suavizante|lejía|lejia|bolsa|jabón|jabon|champú|champu|pasta de dientes/i;

const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x"; }
function guessSeccion(n) { for (const [s, re] of GUESS) if (re.test(n)) return s; return "Despensa"; }

/* ---------- fechas ---------- */
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const fDia = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
function weekLabel(m) { const e = addDays(m, 6); return m.getMonth() === e.getMonth() ? `${m.getDate()} – ${fDia.format(e)}` : `${fDia.format(m)} – ${fDia.format(e)}`; }

/* ---------- estado ---------- */
const state = {
  tab: "menu", user: null, hogar: null,
  recetas: new Map(), recetasLoaded: false,
  personas: 4,
  week: mondayOf(new Date()),
  weekDoc: { comidas: {}, extras: {}, marcados: {} }, weekLoaded: false,
};
const W = () => state.weekDoc;
const LK = () => weekKey(state.week);

/* ---------- Supabase ---------- */
const cfg = window.APP_CONFIG || {};
const configured = cfg.supabaseUrl && !/TU-PROYECTO/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/PEGA-AQUI/.test(cfg.supabaseAnonKey);
const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

/* ---------- utilidades UI ---------- */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function banner(msg) { const b = $("#banner"); b.textContent = msg || ""; b.hidden = !msg; }
function armButton(btn, label, action) {
  if (btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.orig; action(); return; }
  btn.dataset.orig = btn.textContent; btn.classList.add("armed"); btn.textContent = label;
  setTimeout(() => { if (btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.orig; } }, 3500);
}
function openSheet(build) { const c = $("#sheetCard"); c.replaceChildren(); build(c); $("#sheet").hidden = false; const f = c.querySelector("[autofocus]"); if (f) f.focus(); }
function closeSheet() { $("#sheet").hidden = true; $("#sheetCard").replaceChildren(); }
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

/* Ejecuta una escritura; si falla, avisa y vuelve a cargar los datos reales. */
async function write(promise, reload) {
  try {
    const { error } = await promise;
    if (error) throw error;
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? "No se pudo guardar. Inténtalo de nuevo." : "Sin conexión: no se ha guardado.");
    if (reload) reload();
  }
}

/* ---------- carga de datos ---------- */
async function loadHogar() {
  const { data, error } = await sb.from("hogares").select("*").maybeSingle();
  if (error) throw error;
  state.hogar = data;
  if (data) { state.personas = data.personas; $("#brandSub").textContent = data.nombre; }
  return data;
}
async function loadRecetas() {
  const { data, error } = await sb.from("recetas").select("*").order("nombre");
  if (error) { banner("No se pudieron cargar las recetas."); return; }
  state.recetas = new Map(data.map(r => [r.id, r]));
  state.recetasLoaded = true; renderAll();
}
let weekReq = 0;
async function loadWeek() {
  const key = LK(), req = ++weekReq;
  const [s, x, m] = await Promise.all([
    sb.from("menu_slots").select("slot,receta_id,texto").eq("lunes", key),
    sb.from("extras").select("id,nombre,seccion").eq("lunes", key).order("created_at"),
    sb.from("marcados").select("item_key").eq("lunes", key),
  ]);
  if (req !== weekReq) return;
  if (s.error || x.error || m.error) { banner("No se pudo cargar el menú de esta semana. Comprueba la conexión."); state.weekLoaded = true; renderAll(); return; }
  const comidas = {};
  for (const r of s.data) comidas[r.slot] = r.receta_id ? { r: r.receta_id } : { t: r.texto };
  state.weekDoc = {
    comidas,
    extras: Object.fromEntries(x.data.map(e => [e.id, { nombre: e.nombre, seccion: e.seccion }])),
    marcados: Object.fromEntries(m.data.map(r => [r.item_key, true])),
  };
  state.weekLoaded = true; banner(""); renderAll();
}
const debounced = {};
function soon(name, fn) { clearTimeout(debounced[name]); debounced[name] = setTimeout(fn, 300); }
function subscribeRealtime() {
  sb.channel("familia")
    .on("postgres_changes", { event: "*", schema: "public" }, p => {
      if (p.table === "recetas") soon("recetas", loadRecetas);
      else if (p.table === "hogares") soon("hogar", () => loadHogar().then(renderAll));
      else soon("week", loadWeek);
    })
    .subscribe();
  // Al volver a la app tras un rato, refresca por si se perdió algún aviso.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.hogar) { loadRecetas(); loadWeek(); } });
}

/* ---------- datos derivados ---------- */
function unidadBase(u) {
  switch (u) {
    case "g": return { kind: "g", mult: 1 }; case "kg": return { kind: "g", mult: 1000 };
    case "ml": return { kind: "ml", mult: 1 }; case "l": return { kind: "ml", mult: 1000 };
    case "al gusto": return { kind: "gusto", mult: 0 };
    default: return { kind: u || "ud", mult: 1 };
  }
}
function fmtCant(it) {
  if (it.kind === "extra") return "";
  if (it.kind === "gusto") return "al gusto";
  if (!it.cant) return "";
  const c = it.cant;
  if (it.kind === "g") return c >= 1000 ? (Math.round(c / 100) / 10).toLocaleString("es-ES") + " kg" : Math.max(5, Math.round(c / 5) * 5) + " g";
  if (it.kind === "ml") return c >= 1000 ? (Math.round(c / 100) / 10).toLocaleString("es-ES") + " l" : Math.max(5, Math.round(c / 5) * 5) + " ml";
  if (it.kind === "ud") { const n = Math.ceil(c - 0.05); return n + (n === 1 ? " ud" : " uds"); }
  return (Math.round(c * 10) / 10).toLocaleString("es-ES") + " " + it.kind;
}
function listaCompra() {
  const items = new Map();
  const comidas = W().comidas;
  for (const slot of Object.keys(comidas).sort()) {
    const v = comidas[slot]; if (!v || !v.r) continue;
    const r = state.recetas.get(v.r); if (!r) continue;
    const factor = state.personas / (Number(r.raciones) || state.personas);
    for (const ing of r.ingredientes || []) {
      if (!ing || !String(ing.nombre || "").trim()) continue;
      const { kind, mult } = unidadBase(ing.unidad);
      const key = slug(ing.nombre) + "_" + slug(kind);
      let it = items.get(key);
      if (!it) { it = { key, nombre: String(ing.nombre).trim(), kind, cant: 0, seccion: SECCIONES.includes(ing.seccion) ? ing.seccion : guessSeccion(ing.nombre), platos: new Set() }; items.set(key, it); }
      const c = parseFloat(String(ing.cantidad ?? "").replace(",", "."));
      if (isFinite(c) && kind !== "gusto") it.cant += c * mult * factor;
      it.platos.add(r.nombre);
    }
  }
  for (const [id, x] of Object.entries(W().extras)) {
    items.set("x_" + id, { key: "x_" + id, extraId: id, nombre: x.nombre, kind: "extra", cant: 0, seccion: SECCIONES.includes(x.seccion) ? x.seccion : "Otros", platos: new Set() });
  }
  return [...items.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/* ---------- render ---------- */
function renderHeader() {
  $("#weekLabel").textContent = weekLabel(state.week);
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === state.tab));
  for (const v of ["menu", "compra", "recetas"]) $("#v-" + v).hidden = v !== state.tab;
  $("#nRecetas").textContent = state.recetasLoaded ? String(state.recetas.size) : "";
  const items = listaCompra(); const marc = W().marcados;
  $("#nCompra").textContent = items.length ? String(items.filter(i => !marc[i.key]).length) : "";
}

function renderMenu() {
  const grid = $("#menuGrid"); grid.replaceChildren();
  if (!state.weekLoaded) { grid.append(h("div", { class: "empty", text: "Cargando el menú de la semana…" })); return; }
  const comidas = W().comidas;
  const today = weekKey(new Date());
  let llenos = 0;
  DIAS.forEach((dia, i) => {
    const fecha = addDays(state.week, i);
    const esHoy = weekKey(fecha) === today;
    const card = h("article", { class: "day" + (esHoy ? " today" : "") },
      h("div", { class: "day-h" }, h("h3", { text: dia }), h("span", { text: esHoy ? "Hoy · " + fDia.format(fecha) : fDia.format(fecha) })));
    for (const [k, label] of COMIDAS) {
      const v = comidas[i + "-" + k];
      let txt = "Añadir", cls = "v add";
      if (v && v.r) { const r = state.recetas.get(v.r); txt = r ? r.nombre : "…"; cls = "v"; llenos++; }
      else if (v && v.t) { txt = v.t; cls = "v free"; llenos++; }
      card.append(h("button", { class: "slot", onclick: () => openPicker(i, k) },
        h("span", { class: "k", text: label }), h("span", { class: cls, text: txt })));
    }
    grid.append(card);
  });
  $("#menuInfo").textContent = llenos ? `${llenos} de 28 huecos planificados` : "Semana sin planificar. Toca un hueco para elegir el plato.";
}

function renderCompra() {
  $("#personas").textContent = state.personas;
  const box = $("#listaCompra"); box.replaceChildren();
  const items = listaCompra(); const marc = W().marcados;
  const done = items.filter(i => marc[i.key]);
  $("#progressBar").style.width = items.length ? (done.length / items.length * 100) + "%" : "0%";
  $("#compraInfo").textContent = items.length ? `${done.length} de ${items.length} en el carro` : "";
  if (!items.length) { box.append(h("div", { class: "empty", text: "La lista se crea sola con los platos del menú. Elige platos en la pestaña Menú o añade cosas sueltas arriba." })); return; }
  const cols = h("div", { class: "shop-cols" });
  for (const sec of SECCIONES) {
    const list = items.filter(i => i.seccion === sec && !marc[i.key]);
    if (list.length) cols.append(secBox(sec, list, false));
  }
  if (done.length) cols.append(secBox("En el carro", done, true));
  box.append(cols);
}
function secBox(title, list, isCart) {
  const s = h("div", { class: "sec" + (isCart ? " cart" : "") }, h("h3", {}, title, h("span", { text: String(list.length) })));
  for (const it of list) {
    const id = "chk-" + it.key;
    s.append(h("label", { class: "item" + (isCart ? " done" : ""), for: id },
      h("input", { type: "checkbox", id, checked: isCart || null, onchange: e => toggleItem(it.key, e.target.checked) }),
      h("span", { class: "nm" }, it.nombre, h("span", { class: "from", text: it.extraId ? "Añadido a mano" : [...it.platos].join(" · ") })),
      h("span", { class: "qty" }, fmtCant(it),
        it.extraId ? h("button", { class: "x", type: "button", "aria-label": "Quitar " + it.nombre, onclick: e => { e.preventDefault(); removeExtra(it.extraId); } }, "quitar") : null)));
  }
  return s;
}

function renderRecetas() {
  const box = $("#listaRecetas"); box.replaceChildren();
  if (!state.recetasLoaded) { box.append(h("div", { class: "empty", text: "Cargando recetas…" })); return; }
  const q = norm($("#recetaBuscar").value);
  const all = [...state.recetas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const list = all.filter(r => !q || norm(r.nombre).includes(q) || (r.ingredientes || []).some(i => norm(i.nombre).includes(q)));
  if (!all.length) { box.append(h("div", { class: "empty", text: "Aún no hay recetas. Añade la primera con «Nueva receta»: nombre, para qué comida es y sus ingredientes." })); return; }
  if (!list.length) { box.append(h("div", { class: "empty", text: "Ninguna receta coincide con la búsqueda." })); return; }
  const grid = h("div", { class: "recs" });
  for (const r of list) {
    const n = (r.ingredientes || []).length;
    grid.append(h("button", { class: "rec", onclick: () => openEditor(r.id) },
      h("b", { text: r.nombre }),
      h("div", { class: "chips" }, (r.tipos || []).map(t => h("span", { class: "chip", text: (COMIDAS.find(c => c[0] === t) || [t, t])[1] }))),
      h("span", { class: "meta", text: `${n} ingrediente${n === 1 ? "" : "s"} · ${r.raciones || state.personas} raciones` + (r.ejemplo ? " · ejemplo" : "") })));
  }
  box.append(grid);
}
function renderAll() { renderHeader(); renderMenu(); renderCompra(); renderRecetas(); }

/* ---------- acciones: menú ---------- */
function setSlot(slotKey, val) {
  const lunes = LK();
  if (val) W().comidas[slotKey] = val; else delete W().comidas[slotKey];
  renderAll();
  const q = val
    ? sb.from("menu_slots").upsert({ hogar_id: state.hogar.id, lunes, slot: slotKey, receta_id: val.r || null, texto: val.t || null })
    : sb.from("menu_slots").delete().eq("lunes", lunes).eq("slot", slotKey);
  write(q, loadWeek);
}
function openPicker(dia, comida) {
  const slotKey = dia + "-" + comida;
  const cur = W().comidas[slotKey];
  const label = COMIDAS.find(c => c[0] === comida)[1];
  openSheet(card => {
    const search = h("input", { class: "field", id: "pickBuscar", placeholder: "Buscar plato", autocomplete: "off" });
    const listBox = h("div", { class: "form-grid" });
    const choose = val => { setSlot(slotKey, val); closeSheet(); };
    const draw = () => {
      listBox.replaceChildren();
      const q = norm(search.value);
      const all = [...state.recetas.values()].filter(r => !q || norm(r.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      const mk = (title, arr) => arr.length ? h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: title }),
        h("div", { class: "pick-list" }, arr.map(r => h("button", { class: "pick" + (cur && cur.r === r.id ? " on" : ""), onclick: () => choose({ r: r.id }) },
          h("span", { text: r.nombre }), h("small", { text: (r.ingredientes || []).length + " ingr." }))))) : null;
      const a = mk("Recetas de " + label.toLowerCase(), all.filter(r => (r.tipos || []).includes(comida)));
      const b = mk("Otras recetas", all.filter(r => !(r.tipos || []).includes(comida)));
      if (a) listBox.append(a); if (b) listBox.append(b);
      if (!a && !b) listBox.append(h("div", { class: "empty", text: state.recetas.size ? "No hay recetas con ese nombre." : "Aún no hay recetas. Créalas en la pestaña Recetas." }));
    };
    search.addEventListener("input", draw);
    const free = h("input", { class: "field", id: "pickLibre", placeholder: "Sobras, cena fuera, cumpleaños…", value: cur && cur.t ? cur.t : "", autocomplete: "off" });
    card.append(
      h("div", { class: "sheet-h" }, h("h2", { text: `${DIAS[dia]} · ${label}` }), h("button", { class: "icon-btn", "aria-label": "Cerrar", onclick: closeSheet }, "×")),
      search, listBox,
      h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "O escribe algo sin receta (no suma a la compra)" }),
        h("form", { class: "row", onsubmit: e => { e.preventDefault(); const t = free.value.trim(); if (t) choose({ t }); } }, free, h("button", { class: "btn", type: "submit" }, "Poner"))),
      cur ? h("div", { class: "sheet-foot" }, h("button", { class: "btn danger", onclick: () => choose(null) }, "Quitar de este hueco")) : null
    );
    draw();
  });
}
$("#copyPrev").addEventListener("click", async () => {
  const lunes = LK();
  const { data, error } = await sb.from("menu_slots").select("slot,receta_id,texto").eq("lunes", weekKey(addDays(state.week, -7)));
  if (error) { toast("No se pudo leer la semana anterior."); return; }
  if (!data.length) { toast("La semana anterior está vacía."); return; }
  await write(sb.from("menu_slots").delete().eq("lunes", lunes));
  await write(sb.from("menu_slots").insert(data.map(r => ({ ...r, hogar_id: state.hogar.id, lunes }))));
  await loadWeek();
  toast("Menú copiado de la semana anterior");
});
$("#clearWeek").addEventListener("click", e => armButton(e.currentTarget, "Pulsa otra vez para vaciar", async () => {
  const lunes = LK();
  state.weekDoc.comidas = {}; state.weekDoc.marcados = {}; renderAll();
  await write(sb.from("menu_slots").delete().eq("lunes", lunes), loadWeek);
  await write(sb.from("marcados").delete().eq("lunes", lunes), loadWeek);
  toast("Menú vaciado");
}));

/* ---------- generar menú automático ---------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/* Reparte recetas en los huecos elegidos. Puntúa cada candidata (menos es mejor):
   ya usada esta semana, repetida en el mismo día, igual que ayer o usada la semana pasada. */
function generarMenu(base, comidas, evitar, antes = {}) {
  const nuevo = {}, usadas = new Map(), sinReceta = [];
  const get = slot => base[slot] || nuevo[slot];
  for (const v of Object.values(base)) if (v && v.r) usadas.set(v.r, (usadas.get(v.r) || 0) + 1);
  for (const k of comidas) {
    const pool = [...state.recetas.values()].filter(r => (r.tipos || []).includes(k));
    if (!pool.length) { sinReceta.push(k); continue; }
    for (let d = 0; d < 7; d++) {
      const slot = d + "-" + k;
      if (base[slot]) continue;
      const mismoDia = new Set(COMIDAS.map(([c]) => (get(d + "-" + c) || {}).r).filter(Boolean));
      const ayer = (get((d - 1) + "-" + k) || {}).r;
      const elegido = shuffle(pool.slice())
        .map(r => ({ r, s: (usadas.get(r.id) || 0) * 10 + (mismoDia.has(r.id) ? 20 : 0) + (r.id === ayer ? 5 : 0) + (evitar.has(r.id) ? 3 : 0) + ((antes[slot] || {}).r === r.id ? 6 : 0) + Math.random() * 2 }))
        .sort((a, b) => a.s - b.s)[0].r;
      nuevo[slot] = { r: elegido.id };
      usadas.set(elegido.id, (usadas.get(elegido.id) || 0) + 1);
    }
  }
  return { nuevo, sinReceta };
}
$("#generar").addEventListener("click", openGenerar);
function openGenerar() {
  if (!state.recetas.size) { toast("Primero añade algunas recetas en la pestaña Recetas."); return; }
  openSheet(card => {
    const checks = h("div", { class: "checks" }, COMIDAS.map(([k, l]) => h("label", {},
      h("input", { type: "checkbox", id: "gen-" + k, value: k, checked: (k === "comida" || k === "cena") || null }), l)));
    const modo = h("div", { class: "checks" },
      h("label", {}, h("input", { type: "radio", name: "genModo", id: "gen-huecos", value: "huecos", checked: true }), "Solo los huecos vacíos"),
      h("label", {}, h("input", { type: "radio", name: "genModo", id: "gen-todo", value: "todo" }), "Rehacer (sustituye lo que haya)"));
    const evitar = h("label", { style: "display:flex;gap:8px;align-items:center" },
      h("input", { type: "checkbox", id: "gen-evitar", checked: true, style: "accent-color:var(--accent)" }), "Evitar los platos de la semana pasada");
    const go = h("button", { class: "btn primary", type: "button" }, "Generar");
    go.addEventListener("click", async () => {
      const comidas = [...checks.querySelectorAll("input:checked")].map(x => x.value);
      if (!comidas.length) { toast("Elige al menos una comida"); return; }
      const rehacer = modo.querySelector("input:checked").value === "todo";
      go.disabled = true; go.textContent = "Generando…";
      let prev = new Set();
      if (evitar.querySelector("input").checked) {
        const { data } = await sb.from("menu_slots").select("receta_id").eq("lunes", weekKey(addDays(state.week, -7)));
        prev = new Set((data || []).map(r => r.receta_id).filter(Boolean));
      }
      const antes = { ...W().comidas };
      const base = { ...antes };
      const borrar = rehacer ? Object.keys(base).filter(s => comidas.includes(s.split("-")[1])) : [];
      for (const s of borrar) delete base[s];
      const { nuevo, sinReceta } = generarMenu(base, comidas, prev, antes);
      const n = Object.keys(nuevo).length;
      closeSheet();
      if (!n && !borrar.length) {
        toast(sinReceta.length === comidas.length ? "No hay recetas marcadas para esas comidas." : "No quedaban huecos vacíos.");
        return;
      }
      const lunes = LK();
      state.weekDoc.comidas = { ...base, ...nuevo }; renderAll();
      if (borrar.length) await write(sb.from("menu_slots").delete().eq("lunes", lunes).in("slot", borrar), loadWeek);
      if (n) await write(sb.from("menu_slots").upsert(Object.entries(nuevo).map(([slot, v]) => ({ hogar_id: state.hogar.id, lunes, slot, receta_id: v.r, texto: null }))), loadWeek);
      const falta = sinReceta.map(k => COMIDAS.find(c => c[0] === k)[1].toLowerCase());
      toast(`${n} platos generados` + (falta.length ? `. Sin recetas de ${falta.join(" ni ")}.` : ". Toca cualquiera para cambiarlo."));
    });
    card.append(
      h("div", { class: "sheet-h" }, h("h2", { text: "Generar menú" }), h("button", { class: "icon-btn", "aria-label": "Cerrar", onclick: closeSheet }, "×")),
      h("p", { style: "margin:0;color:var(--muted)", text: `Reparte vuestras recetas en la semana del ${weekLabel(state.week)}, sin repetir platos mientras haya alternativas. Usa el campo «Sirve para» de cada receta.` }),
      h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "Qué comidas" }), checks),
      h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "Cómo" }), modo),
      evitar,
      h("div", { class: "sheet-foot" }, h("button", { class: "btn", type: "button", onclick: closeSheet }, "Cancelar"), go)
    );
  });
}

/* ---------- acciones: compra ---------- */
function toggleItem(key, on) {
  const lunes = LK();
  if (on) W().marcados[key] = true; else delete W().marcados[key];
  renderAll();
  write(on ? sb.from("marcados").upsert({ hogar_id: state.hogar.id, lunes, item_key: key })
           : sb.from("marcados").delete().eq("lunes", lunes).eq("item_key", key), loadWeek);
}
function removeExtra(id) {
  delete W().extras[id]; delete W().marcados["x_" + id]; renderAll();
  write(sb.from("extras").delete().eq("id", id), loadWeek);
  write(sb.from("marcados").delete().eq("lunes", LK()).eq("item_key", "x_" + id));
}
$("#extraSeccion").replaceChildren(...SECCIONES.map(s => h("option", { value: s, text: s })));
$("#extraSeccion").value = "Otros";
$("#extraNombre").addEventListener("input", e => {
  const v = e.target.value, g = guessSeccion(v);
  $("#extraSeccion").value = LIMPIEZA.test(v) ? "Limpieza y hogar" : (g === "Despensa" ? "Otros" : g);
});
$("#addExtra").addEventListener("submit", async e => {
  e.preventDefault();
  const nombre = $("#extraNombre").value.trim(); if (!nombre) return;
  const seccion = $("#extraSeccion").value;
  $("#extraNombre").value = ""; $("#extraNombre").focus();
  const id = crypto.randomUUID();
  W().extras[id] = { nombre, seccion }; renderAll();
  write(sb.from("extras").insert({ id, hogar_id: state.hogar.id, lunes: LK(), nombre, seccion }), loadWeek);
});
$("#uncheckAll").addEventListener("click", () => {
  if (!Object.keys(W().marcados).length) return;
  W().marcados = {}; renderAll();
  write(sb.from("marcados").delete().eq("lunes", LK()), loadWeek);
});
let personasT;
function setPersonas(n) {
  n = Math.max(1, Math.min(20, n)); if (n === state.personas) return;
  state.personas = n; renderAll();
  clearTimeout(personasT);
  personasT = setTimeout(() => write(sb.from("hogares").update({ personas: n }).eq("id", state.hogar.id)), 600);
}
$("#perMenos").addEventListener("click", () => setPersonas(state.personas - 1));
$("#perMas").addEventListener("click", () => setPersonas(state.personas + 1));
$("#copyList").addEventListener("click", () => {
  const items = listaCompra(); const marc = W().marcados;
  const pend = items.filter(i => !marc[i.key]);
  if (!pend.length) { toast(items.length ? "Ya está todo en el carro" : "La lista está vacía"); return; }
  let txt = `Compra ${weekLabel(state.week)}\n`;
  for (const sec of SECCIONES) {
    const l = pend.filter(i => i.seccion === sec); if (!l.length) continue;
    txt += `\n${sec.toUpperCase()}\n` + l.map(i => { const q = fmtCant(i); return "- " + i.nombre + (q ? " (" + q + ")" : ""); }).join("\n") + "\n";
  }
  const fallback = () => openSheet(card => {
    const ta = h("textarea", { class: "field", id: "copyText", readonly: true }); ta.value = txt;
    card.append(h("div", { class: "sheet-h" }, h("h2", { text: "Lista para copiar" }), h("button", { class: "icon-btn", "aria-label": "Cerrar", onclick: closeSheet }, "×")),
      h("p", { style: "margin:0;color:var(--muted)", text: "Selecciona el texto y cópialo para pegarlo en WhatsApp o en notas." }), ta);
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  });
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    navigator.share({ text: txt }).catch(() => {});
    return;
  }
  try { navigator.clipboard.writeText(txt).then(() => toast("Lista copiada: pégala en WhatsApp o en notas"), fallback); } catch (e) { fallback(); }
});

/* ---------- acciones: recetas ---------- */
$("#recetaBuscar").addEventListener("input", renderRecetas);
$("#nuevaReceta").addEventListener("click", () => openEditor(null));
function openEditor(id) {
  const r = id ? state.recetas.get(id) : null;
  const draft = r ? JSON.parse(JSON.stringify(r)) : { nombre: "", tipos: ["comida"], raciones: state.personas, ingredientes: [], notas: "" };
  if (!draft.ingredientes || !draft.ingredientes.length) draft.ingredientes = [{ nombre: "", cantidad: "", unidad: "g", seccion: "" }];
  openSheet(card => {
    const nombre = h("input", { class: "field", id: "recNombre", value: draft.nombre, placeholder: "Ej.: Lentejas con chorizo", autofocus: !r || null });
    const raciones = h("input", { class: "field", id: "recRaciones", type: "number", min: "1", max: "30", value: String(draft.raciones || 4), style: "width:6em" });
    const tipos = h("div", { class: "checks" }, COMIDAS.map(([k, l]) => h("label", {}, h("input", { type: "checkbox", id: "tipo-" + k, value: k, checked: (draft.tipos || []).includes(k) || null }), l)));
    const ingBox = h("div", {});
    const notas = h("textarea", { class: "field", id: "recNotas", placeholder: "Notas o pasos (opcional)", style: "min-height:80px" }); notas.value = draft.notas || "";
    let n = 0;
    const addRow = ing => {
      const i = n++;
      const sec = h("select", { class: "field sec-sel", id: "ing-sec-" + i, "aria-label": "Sección del súper" }, h("option", { value: "", text: "Sección…" }), SECCIONES.map(s => h("option", { value: s, text: s })));
      sec.value = ing.seccion || "";
      const nm = h("input", { class: "field", id: "ing-nom-" + i, value: ing.nombre || "", placeholder: "Ingrediente", "aria-label": "Ingrediente", onchange: e => { if (!sec.value && e.target.value.trim()) sec.value = guessSeccion(e.target.value); } });
      const cant = h("input", { class: "field", id: "ing-cant-" + i, value: ing.cantidad ?? "", placeholder: "Cant.", inputmode: "decimal", "aria-label": "Cantidad" });
      const uni = h("select", { class: "field", id: "ing-uni-" + i, "aria-label": "Unidad" }, UNIDADES.map(u => h("option", { value: u, text: u })));
      uni.value = UNIDADES.includes(ing.unidad) ? ing.unidad : "ud";
      const row = h("div", { class: "ing", "data-row": "" },
        h("div", { class: "nm" }, nm, h("button", { class: "icon-btn", type: "button", "aria-label": "Quitar ingrediente", onclick: () => row.remove() }, "×")),
        cant, uni, sec);
      ingBox.append(row);
      return nm;
    };
    draft.ingredientes.forEach(addRow);
    const del = r ? h("button", { class: "btn danger", type: "button", onclick: e => armButton(e.currentTarget, "Pulsa otra vez para borrar", async () => {
      closeSheet();
      state.recetas.delete(id); renderAll();
      await write(sb.from("recetas").delete().eq("id", id), () => { loadRecetas(); loadWeek(); });
      loadWeek();
      toast("Receta borrada");
    }) }, "Borrar receta") : h("span");
    const save = async () => {
      const name = nombre.value.trim();
      if (!name) { nombre.focus(); toast("Ponle un nombre a la receta"); return; }
      const ings = [...ingBox.querySelectorAll("[data-row]")].map(row => {
        const [nm, cant, uni, sec] = row.querySelectorAll("input, select");
        return { nombre: nm.value.trim(), cantidad: cant.value.trim(), unidad: uni.value, seccion: sec.value || (nm.value.trim() ? guessSeccion(nm.value) : "") };
      }).filter(x => x.nombre);
      const body = {
        id: id || crypto.randomUUID(), hogar_id: state.hogar.id, nombre: name,
        tipos: [...tipos.querySelectorAll("input:checked")].map(x => x.value),
        raciones: Math.min(30, Math.max(1, parseInt(raciones.value, 10) || 4)),
        ingredientes: ings, notas: notas.value.trim(), ejemplo: false, updated_at: new Date().toISOString(),
      };
      closeSheet();
      state.recetas.set(body.id, body); renderAll();
      await write(sb.from("recetas").upsert(body), loadRecetas);
      toast(id ? "Receta guardada" : "Receta creada");
    };
    card.append(
      h("div", { class: "sheet-h" }, h("h2", { text: r ? "Editar receta" : "Nueva receta" }), h("button", { class: "icon-btn", "aria-label": "Cerrar", onclick: closeSheet }, "×")),
      h("div", { class: "form-grid" },
        h("label", {}, h("span", { class: "lbl-sm", text: "Nombre" }), nombre),
        h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "Sirve para" }), tipos),
        h("label", { style: "display:flex;align-items:center;gap:10px" }, h("span", { class: "lbl-sm", text: "Raciones de la receta" }), raciones)),
      h("div", {}, h("span", { class: "lbl-sm", text: "Ingredientes (cantidades para esas raciones)" }), ingBox,
        h("button", { class: "btn", type: "button", style: "margin-top:8px", onclick: () => addRow({ unidad: "g" }).focus() }, "+ Ingrediente")),
      notas,
      h("div", { class: "sheet-foot" }, del, h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: closeSheet }, "Cancelar"), h("button", { class: "btn primary", type: "button", onclick: save }, "Guardar")))
    );
  });
}

/* ---------- familia ---------- */
$("#familyBtn").addEventListener("click", openFamily);
async function openFamily() {
  const me = (state.user.email || "").toLowerCase();
  openSheet(card => {
    const list = h("div", { class: "pick-list" }, h("div", { class: "member", text: "Cargando…" }));
    const email = h("input", { class: "field", id: "famEmail", type: "email", placeholder: "email@ejemplo.com", autocomplete: "off" });
    const nombreFam = h("input", { class: "field", id: "famNombre", value: state.hogar.nombre });
    const draw = async () => {
      const { data, error } = await sb.from("miembros").select("email").order("added_at");
      list.replaceChildren();
      if (error) { list.append(h("div", { class: "member", text: "No se pudo cargar la lista." })); return; }
      for (const m of data) {
        list.append(h("div", { class: "member" }, h("span", { text: m.email + (m.email === me ? " (tú)" : "") }),
          m.email === me ? null : h("button", { class: "btn danger", type: "button", onclick: e => armButton(e.currentTarget, "¿Quitar?", async () => {
            await write(sb.from("miembros").delete().eq("email", m.email)); draw();
          }) }, "Quitar")));
      }
    };
    card.append(
      h("div", { class: "sheet-h" }, h("h2", { text: "Familia" }), h("button", { class: "icon-btn", "aria-label": "Cerrar", onclick: closeSheet }, "×")),
      h("label", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "Nombre de la familia" }),
        h("form", { class: "row", onsubmit: async e => { e.preventDefault(); const v = nombreFam.value.trim(); if (!v) return;
          await write(sb.from("hogares").update({ nombre: v }).eq("id", state.hogar.id)); await loadHogar(); toast("Nombre guardado"); } },
          nombreFam, h("button", { class: "btn", type: "submit" }, "Guardar"))),
      h("div", { class: "form-grid" }, h("span", { class: "lbl-sm", text: "Quién puede entrar" }), list,
        h("p", { style: "margin:0;color:var(--muted)", text: "Añade el email de cada persona. Después, que abra la app y pida su enlace de acceso con ese email." }),
        h("form", { class: "row", onsubmit: async e => { e.preventDefault(); const v = email.value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(v)) { toast("Escribe un email válido"); return; }
          email.value = ""; await write(sb.from("miembros").insert({ email: v, hogar_id: state.hogar.id })); draw(); toast("Añadido: " + v); } },
          email, h("button", { class: "btn primary", type: "submit" }, "Añadir"))),
      h("div", { class: "sheet-foot" }, h("span", { style: "color:var(--muted)", text: "Has entrado como " + me }),
        h("button", { class: "btn", type: "button", onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "Cerrar sesión"))
    );
    draw();
  });
}

/* ---------- navegación ---------- */
function setTab(t) { state.tab = t; try { history.replaceState(null, "", "#" + t); } catch (e) {} renderHeader(); }
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => setTab(t.dataset.tab));
function tabFromHash() { const t = location.hash.slice(1); return ["menu", "compra", "recetas"].includes(t) ? t : "menu"; }
window.addEventListener("hashchange", () => { state.tab = tabFromHash(); renderHeader(); });
function setWeek(d) {
  state.week = mondayOf(d); state.weekDoc = { comidas: {}, extras: {}, marcados: {} }; state.weekLoaded = false;
  renderAll(); loadWeek();
}
$("#prevWeek").addEventListener("click", () => setWeek(addDays(state.week, -7)));
$("#nextWeek").addEventListener("click", () => setWeek(addDays(state.week, 7)));
$("#thisWeek").addEventListener("click", () => setWeek(new Date()));

/* ---------- acceso ---------- */
function showLogin(msg) {
  $("#appView").hidden = true; $("#loginView").hidden = false;
  if (msg) $("#loginIntro").textContent = msg;
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const btn = $("#loginBtn"), out = $("#loginMsg");
  btn.disabled = true; out.className = ""; out.textContent = "Enviando…";
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  btn.disabled = false;
  if (error) {
    out.textContent = /rate|seconds|limit/i.test(error.message)
      ? "Has pedido demasiados enlaces seguidos. Espera unos minutos y vuelve a intentarlo."
      : "No se pudo enviar el enlace: " + error.message;
    return;
  }
  out.className = "ok"; out.textContent = "Listo. Revisa tu correo (" + email + ") y abre el enlace desde este mismo dispositivo.";
});

let entered = false;
async function enter(session) {
  if (entered) return; entered = true;
  state.user = session.user;
  try {
    const hogar = await loadHogar();
    if (!hogar) {
      entered = false;
      showLogin(`Has entrado como ${state.user.email}, pero ese email no está en ninguna familia. Pide que te añadan desde el botón «Familia» de la app.`);
      $("#loginForm").hidden = true;
      $("#loginMsg").replaceChildren(h("button", { class: "btn", onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "Entrar con otro email"));
      return;
    }
  } catch (e) {
    entered = false;
    showLogin("No se pudo conectar con la base de datos. Comprueba la conexión y recarga la página.");
    return;
  }
  $("#loginView").hidden = true; $("#appView").hidden = false;
  state.tab = tabFromHash();
  renderAll();
  loadRecetas(); loadWeek(); subscribeRealtime();
}

async function start() {
  if (!sb) {
    showLogin("Falta configurar la app: rellena config.js con la URL y la anon key de tu proyecto de Supabase (mira el README).");
    $("#loginForm").hidden = true;
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) enter(session);
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session) enter(session); else if (!entered) showLogin();
}
start();

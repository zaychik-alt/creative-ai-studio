const $ = (s) => document.querySelector(s);
const state = { mode: "image", reference: null, filter: "all", busy: false };
const DB_NAME = "creative-ai-studio";
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("items", { keyPath: "id" });
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}
function storeItem(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").put(item);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
function getItems() {
  return new Promise((resolve, reject) => {
    const req = db.transaction("items").objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.createdAt-a.createdAt));
    req.onerror = () => reject(req.error);
  });
}
function deleteItem(id) {
  return new Promise((resolve) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").delete(id); tx.oncomplete = resolve;
  });
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function setBusy(busy, title = "Creando...", text = "La IA está trabajando en tu idea.") {
  state.busy = busy;
  $("#generateBtn").disabled = busy;
  $("#generateBtn").innerHTML = busy ? "Procesando..." : `<span>✧</span> Generar ${state.mode === "image" ? "imagen" : "video"} <span class="arrow">↗</span>`;
  $("#emptyState").hidden = true; $("#resultImage").hidden = true; $("#resultVideo").hidden = true;
  $("#loadingState").hidden = !busy;
  $("#loadingTitle").textContent = title; $("#loadingText").textContent = text;
}
async function resizeReferenceForVideo(file, size) {
  const [targetW, targetH] = size.split("x").map(Number);
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(targetW / bitmap.width, targetH / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  ctx.drawImage(bitmap, (targetW - width) / 2, (targetH - height) / 2, width, height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
  return new File([blob], "video-reference.jpg", { type: "image/jpeg" });
}
function showResult(type, url, prompt, id = crypto.randomUUID()) {
  $("#loadingState").hidden = true; $("#emptyState").hidden = true;
  const image = type === "image";
  $("#resultImage").hidden = !image; $("#resultVideo").hidden = image;
  if (image) $("#resultImage").src = url;
  else $("#resultVideo").src = url;
  $("#resultActions").hidden = false;
  $("#resultLabel").textContent = image ? "Imagen generada" : "Video generado";
  $("#downloadBtn").href = url; $("#downloadBtn").download = image ? "creative-ai-image.png" : "creative-ai-video.mp4";
  storeItem({ id, type, url, prompt, createdAt: Date.now() }).then(renderGallery).catch(() => toast("No se pudo guardar en la galería local."));
}
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tab").forEach(b => b.classList.toggle("selected", b.dataset.mode === mode));
  $("#imageOptions").hidden = mode !== "image"; $("#videoOptions").hidden = mode !== "video";
  $("#panelTitle").textContent = mode === "image" ? "Describe tu imagen" : "Describe tu video";
  $("#previewTitle").textContent = mode === "image" ? "Resultado" : "Vista previa del video";
  $("#prompt").placeholder = mode === "image" ? "Describe tu idea con todos los detalles que quieras..." : "Describe la escena, los movimientos de cámara y qué debe ocurrir...";
  $("#generateBtn").innerHTML = `<span>✧</span> Generar ${mode === "image" ? "imagen" : "video"} <span class="arrow">↗</span>`;
  $("#resultActions").hidden = true; $("#resultImage").hidden = true; $("#resultVideo").hidden = true; $("#loadingState").hidden = true; $("#emptyState").hidden = false;
}
function showPage(page) {
  $("#createPage").hidden = page !== "create"; $("#galleryPage").hidden = page !== "gallery";
  $("#crumbName").textContent = page === "create" ? "Crear" : "Mi galería";
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  if (page === "gallery") renderGallery();
}
document.querySelectorAll(".mode-tab").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
$("#reference").addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast("La imagen supera los 25 MB."); e.target.value = ""; return; }
  state.reference = file;
  const img = $("#referencePreview"); img.src = URL.createObjectURL(file); img.hidden = false;
  $("#removeRef").hidden = false;
});
$("#removeRef").addEventListener("click", e => {
  e.preventDefault(); state.reference = null; $("#reference").value = ""; $("#referencePreview").hidden = true; $("#removeRef").hidden = true;
});
$("#generateBtn").addEventListener("click", async () => {
  if (state.busy) return;
  const prompt = $("#prompt").value.trim();
  if (!prompt) { toast("Primero escribe una descripción."); $("#prompt").focus(); return; }
  setBusy(true, state.mode === "image" ? "Creando tu imagen..." : "Preparando tu video...", "Esto puede tardar un poco. Puedes dejar esta pestaña abierta.");
  try {
    const form = new FormData(); form.append("prompt", prompt);
    if (state.reference && state.mode === "image") form.append("reference", state.reference);
    let response;
    if (state.mode === "image") {
      form.append("model", $("#imageModel").value); form.append("size", $("#imageSize").value); form.append("quality", $("#imageQuality").value);
      response = await fetch("/api/images", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Error generando imagen.");
      showResult("image", data.image, prompt);
    } else {
      const videoSize = $("#videoSize").value;
      if (state.reference) form.append("reference", await resizeReferenceForVideo(state.reference, videoSize));
      form.append("model", $("#videoModel").value); form.append("size", videoSize); form.append("seconds", $("#videoSeconds").value);
      response = await fetch("/api/videos", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Error iniciando video.");
      await pollVideo(data.id, prompt);
    }
  } catch (err) {
    $("#loadingState").hidden = true; $("#emptyState").hidden = false;
    toast(err.message || "Ocurrió un error.");
  } finally {
    state.busy = false; $("#generateBtn").disabled = false;
    $("#generateBtn").innerHTML = `<span>✧</span> Generar ${state.mode === "image" ? "imagen" : "video"} <span class="arrow">↗</span>`;
  }
});
async function pollVideo(id, prompt) {
  const start = Date.now();
  while (Date.now() - start < 12 * 60 * 1000) {
    const response = await fetch(`/api/videos/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo consultar el video.");
    if (data.status === "completed") {
      const url = `/api/videos/${encodeURIComponent(id)}/content`;
      setBusy(false); showResult("video", url, prompt, id); return;
    }
    if (data.status === "failed") throw new Error(data.error?.message || "La generación del video falló.");
    $("#loadingTitle").textContent = "Generando tu video...";
    $("#loadingText").textContent = `Estado: ${data.status || "en cola"}. Esto puede tardar varios minutos.`;
    await new Promise(r => setTimeout(r, 7000));
  }
  throw new Error("La generación sigue en proceso. Revisa más tarde el estado en tu cuenta de API.");
}
async function renderGallery() {
  const grid = $("#galleryGrid"); grid.innerHTML = "";
  const items = (await getItems()).filter(item => state.filter === "all" || item.type === state.filter);
  $("#galleryEmpty").hidden = items.length > 0;
  for (const item of items) {
    const card = document.createElement("article"); card.className = "gallery-card";
    const media = item.type === "image" ? document.createElement("img") : document.createElement("video");
    media.src = item.url; if (item.type === "video") media.controls = true;
    const info = document.createElement("div"); info.className = "gallery-card-info";
    const p = document.createElement("p"); p.textContent = item.prompt;
    const remove = document.createElement("button"); remove.textContent = "Eliminar"; remove.addEventListener("click", async () => { await deleteItem(item.id); renderGallery(); });
    info.append(p, remove); card.append(media, info); grid.append(card);
  }
}
document.querySelectorAll(".filter").forEach(b => b.addEventListener("click", () => {
  state.filter = b.dataset.filter; document.querySelectorAll(".filter").forEach(x => x.classList.toggle("active", x === b)); renderGallery();
}));
$("#clearGallery").addEventListener("click", async () => {
  if (!confirm("¿Eliminar todas las creaciones guardadas en este navegador?")) return;
  const tx = db.transaction("items", "readwrite"); tx.objectStore("items").clear(); tx.oncomplete = renderGallery;
});
$("#backToCreate").addEventListener("click", () => showPage("create"));
$("#helpBtn").addEventListener("click", () => $("#helpDialog").showModal());
$("#closeHelp").addEventListener("click", () => $("#helpDialog").close());

(async () => {
  try {
    await openDB();
    const res = await fetch("/api/status"); const data = await res.json();
    $("#apiStatus").textContent = data.configured ? "API conectada" : "Falta configurar API";
    $(".status-dot").classList.toggle("ok", data.configured);
    if (!data.configured) toast("Para generar, configura OPENAI_API_KEY en el servidor.");
    renderGallery();
  } catch { $("#apiStatus").textContent = "Servidor no disponible"; }
})();

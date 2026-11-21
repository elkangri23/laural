const labels = {
  unknown: "Estado sin confirmar",
  operational: "Todos los sistemas operativos",
  degraded: "Servicio parcialmente degradado",
  maintenance: "Mantenimiento en curso",
};
const noticeLabels = { incident: "Incidencia", maintenance: "Mantenimiento", notice: "Aviso" };

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

function renderStatus(documentData) {
  const state = Object.hasOwn(labels, documentData.state) ? documentData.state : "unknown";
  const summary = document.getElementById("status-summary");
  const dot = document.createElement("span");
  dot.className = `status-dot ${state}`;
  dot.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = documentData.summary || labels[state];
  summary.replaceChildren(dot, text);
  document.getElementById("status-updated").textContent = `Última actualización: ${formatDate(documentData.updatedAt)}`;

  const container = document.getElementById("notices");
  const notices = Array.isArray(documentData.notices) ? documentData.notices.slice(0, 8) : [];
  if (notices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-notices";
    empty.textContent = "No hay avisos publicados.";
    container.replaceChildren(empty);
    return;
  }
  const cards = notices.map((notice) => {
    const kind = Object.hasOwn(noticeLabels, notice.kind) ? notice.kind : "notice";
    const card = document.createElement("article");
    card.className = `notice ${kind}`;
    const meta = document.createElement("div");
    meta.className = "notice-meta";
    const label = document.createElement("span");
    label.textContent = noticeLabels[kind];
    const date = document.createElement("time");
    date.dateTime = notice.updatedAt;
    date.textContent = formatDate(notice.updatedAt);
    const title = document.createElement("h3");
    title.textContent = notice.title;
    const message = document.createElement("p");
    message.textContent = notice.message;
    meta.append(label, date);
    card.append(meta, title, message);
    return card;
  });
  container.replaceChildren(...cards);
}

async function refresh() {
  try {
    const response = await fetch("/status.json", { cache: "no-store", credentials: "omit" });
    const documentData = await response.json();
    if (!response.ok && response.status !== 503) throw new Error("status unavailable");
    renderStatus(documentData);
    document.getElementById("refresh-state").textContent = "Actualizado automáticamente cada minuto";
  } catch {
    renderStatus({ state: "unknown", summary: "No se pudo comprobar el estado. Inténtalo de nuevo más tarde.", updatedAt: new Date().toISOString(), notices: [] });
    document.getElementById("refresh-state").textContent = "No se pudo actualizar";
  }
}

void refresh();
window.setInterval(() => void refresh(), 60_000);

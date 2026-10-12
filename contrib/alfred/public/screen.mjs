// Alfred — the screen around the globe: the voice indicator (top left), the clock (top right) and
// "Notícias do dia" (bottom left). The pure parts are unit-tested; the rest only fills elements,
// always with textContent (news text comes from outside and is never read as HTML).

/** The clock's pieces for `date`: { hm: "20:43", sec: "23", day: "Domingo", date: "11 de outubro de 2026" }. */
export function clockParts(date = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  const day = date.toLocaleDateString("pt-BR", { weekday: "long" });
  return {
    hm: `${two(date.getHours())}:${two(date.getMinutes())}`,
    sec: two(date.getSeconds()),
    day: day.charAt(0).toUpperCase() + day.slice(1),
    date: date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }),
  };
}

/** Keeps the clock elements up to date, ticking on each new second. Returns a stop function. */
export function startClock({ hm, sec, day, date }, now = () => new Date()) {
  let timer = 0;
  const tick = () => {
    const at = now();
    const p = clockParts(at);
    hm.textContent = p.hm;
    sec.textContent = p.sec;
    day.textContent = p.day;
    date.textContent = p.date;
    timer = setTimeout(tick, 1000 - at.getMilliseconds() + 5);
  };
  tick();
  return () => clearTimeout(timer);
}

/**
 * What the indicator says. `phase` is the globe's state; `mic` tells whether anything listens
 * while he waits (the name "Alfred" or the claps); `music` while the opening theme plays.
 */
export function indicatorFor(phase, { mic = true, music = false } = {}) {
  if (music) return { state: "speaking", label: "Tocando música" };
  if (phase === "listening") return { state: "listening", label: "Ouvindo" };
  if (phase === "thinking") return { state: "thinking", label: "Pensando" };
  if (phase === "speaking") return { state: "speaking", label: "Falando" };
  return mic ? { state: "idle", label: "Voz ativa" } : { state: "off", label: "Microfone desligado" };
}

/**
 * The news panel's content from /api/news: the main story (with its category, or the source
 * when the feed has none) and up to three more titles. null when there is nothing to show.
 */
export function newsView(feed) {
  const items = (Array.isArray(feed?.items) ? feed.items : []).filter((i) => i && typeof i.title === "string" && i.title.trim());
  if (!items.length) return null;
  const [main, ...rest] = items;
  const tag = String(main.category || feed.source || "").trim();
  return {
    tag: tag ? `${tag}.` : "",
    title: main.title.trim(),
    summary: String(main.summary ?? "").trim(),
    more: rest.slice(0, 3).map((i, n) => ({ n: String(n + 2).padStart(2, "0"), title: i.title.trim() })),
  };
}

/** Fills the news panel (or hides it when `view` is null). */
export function renderNews(el, view) {
  el.panel.hidden = !view;
  if (!view) return;
  el.tag.textContent = view.tag;
  el.tag.hidden = !view.tag;
  el.title.textContent = view.title;
  el.summary.textContent = view.summary;
  el.summary.hidden = !view.summary;
  el.more.replaceChildren(
    ...view.more.map((m) => {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = m.n;
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = m.title;
      li.title = m.title; // the whole title on hover when it does not fit
      li.append(n, t);
      return li;
    })
  );
}

/**
 * Loads the news now and again every `everyMs` (30 minutes). A failed refresh keeps what is on
 * the screen. Returns a stop function.
 */
export function startNews({ load, show, everyMs = 30 * 60_000 }) {
  let timer = 0;
  let stopped = false;
  const run = async () => {
    try {
      const view = newsView(await load());
      if (view && !stopped) show(view);
    } catch {}
    if (!stopped) timer = setTimeout(run, everyMs);
  };
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

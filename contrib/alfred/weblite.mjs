// Alfred — "internet leve" for brains that cannot search the web themselves (the local AI and
// Gemini's free tier). Before asking the brain, the server spots questions about exchange rates,
// weather, news or "who/what is …", fetches the answer from free public services (no key) and hands
// it to the brain as context. Anything else goes to the brain unchanged.

import { isHot, isLate } from "./care.mjs";
import { ofWhom } from "./memory.mjs";

const UA = "Alfred/1.0 (assistente pessoal; https://github.com/bs0299330-stack/OmniRoute)";
const TIMEOUT_MS = 5000;

// ---------- Spotting the question (pure, unit-tested) ----------

const CURRENCIES = [
  [/d[oó]lar/i, "USD", "dólar"],
  [/\beuros?\b/i, "EUR", "euro"],
  [/bitcoin|\bbtc\b/i, "BTC", "bitcoin"],
  [/\blibras?\b/i, "GBP", "libra"],
  [/peso argentino/i, "ARS", "peso argentino"],
];
// Money needs a currency ("quanto custa um iPhone?" and "câmbio automático" are not rates).
const MONEY = /cota[cç][aã]o d[oa]s? (?:moedas?|hoje|dia)|^(?:qual (?:[eé] )?a )?cota[cç][aã]o[?.!]*$/i;
const WEATHER =
  /previs[aã]o do tempo|como (est[aá]|vai estar|vai ficar|fica|t[aá]) o (tempo|clima)|\bclima\b|vai chover|chov|\bchuva|temperatura (?:de |para |pra )?(?:hoje|agora|amanh[aã]|l[aá] fora|em\b|no\b|na\b)|qual (?:[eé] )?a temperatura[?.!]*$|quantos graus|faz(endo)? (frio|calor)|(est[aá]|t[aá]) (frio|quente|calor)/i;
// …but not the oven, a fever or the computer ("temperatura ideal para assar um bolo").
const NOT_WEATHER = /\b(forno|assar|bolo|febre|corpo|beb[eê]|piscina|geladeira|freezer|motor|cpu|processador|computador|placa de v[ií]deo)\b/i;
const NEWS = /\bnot[ií]cias?\b|\bmanchetes?\b|o que (est[aá] )?(aconteceu|acontecendo) (hoje|no brasil|no mundo|aqui|na regi[aã]o|em rond[oô]nia)|novidades de hoje/i;
// "notícias de Rondônia", "da região", "daqui", "de Vilhena", "locais"
const LOCAL_NEWS = /\b(rond[oô]nia|\bRO\b|regi[aã]o|regionais?|locais|local|daqui|aqui|cone sul|vilhena|cabixi|colorado|cerejeiras|pimenteiras|da cidade|do estado|meu estado|minha cidade)\b/i;
const WHO = /^(?:quem (?:é|e|foi|era)|o que (?:é|e|foi|significa)|onde fica|quando (?:foi|nasceu|morreu))\s+(.{2,80}?)[?.!]*$/i;
// "Alfred," at the start is the wake word, not part of the question.
const WAKE = /^(?:(?:ei|ok|olá|ola|oi)[\s,]+)?alfredo?[\s,.!]+/i;
const CITY = /\b(?:em|no|na|para|pra)\s+((?:[A-ZÀ-Ý][\wÀ-ÿ'-]*)(?:\s+(?:(?:d[aeo]s?|del|di)\s+)?[A-ZÀ-Ý][\wÀ-ÿ'-]*)*)/;
// a city typed in lowercase ("clima em cacoal"): only after "em/para/pra", and not "em casa"
const CITY_LOWER = /\b(?:em|para|pra)\s+([a-zà-ÿ][a-zà-ÿ'-]{2,}(?:\s+(?:d[aeo]s?\s+)?[a-zà-ÿ][a-zà-ÿ'-]{2,})?)/;
const NOT_A_CITY = /^(casa|hoje|amanh[aã]|agora|depois|aqui|l[aá]|cidade|rua|minha|sua|nossa|esta|essa|o|a|os|as|um|uma|mim|voc[eê])\b/i;
const NOT_A_SUBJECT = /^(voc[eê]|vc|tu|isso|isto|aquilo|que\b|eu\b|o senhor|alfredo?\b)/i;

/** What to look up for this question: `{ kind, … }` or null. */
export function detectLookup(text) {
  const q = String(text ?? "").trim().replace(WAKE, "");
  if (!q) return null;
  if (WEATHER.test(q) && !NOT_WEATHER.test(q)) {
    const lower = q.match(CITY_LOWER)?.[1]?.trim() ?? "";
    const city = q.match(CITY)?.[1]?.trim() || (NOT_A_CITY.test(lower) ? "" : lower.replace(/\s+(hoje|amanh[aã]|agora)$/i, ""));
    const day = /depois de amanh[aã]/i.test(q) ? 2 : /amanh[aã]/i.test(q) ? 1 : 0;
    return { kind: "weather", city, day };
  }
  const codes = CURRENCIES.filter(([re]) => re.test(q)).map(([, code]) => code);
  if (codes.length || MONEY.test(q)) return { kind: "money", codes: codes.length ? codes : ["USD"] };
  if (NEWS.test(q)) return LOCAL_NEWS.test(q) ? { kind: "news", local: true } : { kind: "news" };
  const who = q.match(WHO);
  if (who && !NOT_A_SUBJECT.test(who[1].trim())) return { kind: "wiki", query: who[1].trim() };
  return null;
}

/** A short label for the "Pesquisando: …" status. */
export function lookupLabel(lookup, config = {}) {
  if (lookup.kind === "weather") return `clima em ${lookup.city || config.city || "São Paulo"}`;
  if (lookup.kind === "money") return "cotação " + lookup.codes.map((c) => CURRENCY_NAME[c] ?? c).join(", ");
  if (lookup.kind === "news") return lookup.local ? "notícias da região" : "notícias de hoje";
  return lookup.query;
}
const CURRENCY_NAME = Object.fromEntries(CURRENCIES.map(([, code, name]) => [code, name]));

// WMO weather codes (Open-Meteo) → words.
const WMO = {
  0: "céu limpo",
  1: "poucas nuvens",
  2: "parcialmente nublado",
  3: "nublado",
  45: "neblina",
  48: "neblina",
  51: "garoa fraca",
  53: "garoa",
  55: "garoa forte",
  61: "chuva fraca",
  63: "chuva",
  65: "chuva forte",
  66: "chuva congelante",
  67: "chuva congelante",
  71: "neve fraca",
  73: "neve",
  75: "neve forte",
  80: "pancadas de chuva fracas",
  81: "pancadas de chuva",
  82: "pancadas de chuva fortes",
  95: "trovoadas",
  96: "trovoadas com granizo",
  99: "trovoadas com granizo",
};
export const weatherWords = (code) => WMO[code] ?? "tempo variável";

const brl = (n) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Number(n) >= 1000 ? 0 : 2 });

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const decode = (s) =>
  String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ENTITIES[e.toLowerCase()] ?? m
  );
const tagText = (item, tag) => {
  const m = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
};
const plainText = (html) =>
  decode(String(html).replace(/<[^>]*>/g, " "))
    .replace(/<[^>]*>/g, "") // tags that arrived escaped (&lt;i&gt;)
    .replace(/\s+/g, " ")
    .trim();

/** Cuts a summary to about `max` characters, at the end of a sentence when there is one. */
export function shortSummary(text, max = 300) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end > max * 0.4) return cut.slice(0, end + 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "") + "…";
}

/**
 * The stories of an RSS feed for the screen: `{ title, category, summary }`. The summary is the
 * feed's subtitle (g1) or the first real paragraph of the story (Agência Brasil), never photo
 * captions, "Notícias relacionadas" or embedded posts. Everything comes out as plain text.
 */
export function rssItems(xml, max = 6) {
  const items = [];
  for (const raw of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const item = raw[0];
    const title = plainText(tagText(item, "title")).slice(0, 200);
    if (!title || items.some((i) => i.title === title)) continue;
    const category = plainText(tagText(item, "category")).slice(0, 40);
    let summary = plainText(tagText(item, "atom:subtitle"));
    if (!summary) {
      let body = tagText(item, "description");
      if (/&lt;/.test(body)) body = decode(body); // HTML sent as escaped text
      summary =
        body
          .split(/<\/p>|<br\s*\/?>|\n/i)
          .map(plainText)
          .find((p) => p.length >= 60 && !/^(notícias relacionadas|leia também|foto:|ver esse post)/i.test(p) && !/instagram|^©/i.test(p)) ?? "";
    }
    items.push({ title, category, summary: shortSummary(summary) });
    if (items.length >= max) break;
  }
  return items;
}

// ---------- Fetching (free services, no key) ----------

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function money(codes, fetchImpl) {
  // AwesomeAPI: live quotes in reais. Fallbacks: ExchangeRate-API (daily) and CoinGecko (bitcoin).
  try {
    const pairs = codes.map((c) => `${c}-BRL`).join(",");
    const data = await getJson(`https://economia.awesomeapi.com.br/json/last/${pairs}`, fetchImpl);
    const lines = codes
      .map((c) => data[`${c}BRL`])
      .filter(Boolean)
      .map((q) => `${CURRENCY_NAME[q.code] ?? q.code}: ${brl(q.bid)} (variação no dia: ${q.pctChange}%)`);
    if (lines.length) return { source: "AwesomeAPI (cotação ao vivo)", text: lines.join("; ") };
  } catch {}
  const lines = [];
  const sources = [];
  const fiat = codes.filter((c) => c !== "BTC");
  if (fiat.length) {
    try {
      const data = await getJson("https://open.er-api.com/v6/latest/BRL", fetchImpl);
      const before = lines.length;
      for (const c of fiat) if (data.rates?.[c]) lines.push(`${CURRENCY_NAME[c] ?? c}: ${brl(1 / data.rates[c])} (cotação do dia)`);
      if (lines.length > before) sources.push("ExchangeRate-API");
    } catch {}
  }
  if (codes.includes("BTC")) {
    try {
      const data = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl", fetchImpl);
      if (data.bitcoin?.brl) {
        lines.push(`bitcoin: ${brl(data.bitcoin.brl)}`);
        sources.push("CoinGecko");
      }
    } catch {}
  }
  return lines.length ? { source: sources.join(" e "), text: lines.join("; ") } : null;
}

// The states' abbreviations, as INMET writes them after each town ("Cabixi - RO").
const UF = {
  Acre: "AC", Alagoas: "AL", Amapá: "AP", Amazonas: "AM", Bahia: "BA", Ceará: "CE", "Distrito Federal": "DF",
  "Espírito Santo": "ES", Goiás: "GO", Maranhão: "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG", Pará: "PA", Paraíba: "PB", Paraná: "PR", Pernambuco: "PE", Piauí: "PI",
  "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", Rondônia: "RO", Roraima: "RR",
  "Santa Catarina": "SC", "São Paulo": "SP", Sergipe: "SE", Tocantins: "TO",
};

/** Where a city is: `{ name, admin1, latitude, longitude, country_code }` (Open-Meteo), or null. */
export async function geocode(city, fetchImpl = fetch) {
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
    fetchImpl
  );
  return geo.results?.[0] ?? null;
}

/** "à tarde, às 16 horas" — when the chance of rain is highest in the next hours, or null. */
export function rainSoon(hourly, now = new Date()) {
  const times = hourly?.time ?? [];
  const chance = hourly?.precipitation_probability ?? [];
  let best = -1;
  for (let i = 0; i < times.length; i++) if (chance[i] != null && (best < 0 || chance[i] > chance[best])) best = i;
  if (best < 0) return null;
  const when = new Date(times[best]);
  const hour = Number.isNaN(when.getTime()) ? null : when.getHours();
  const max = chance[best];
  if (max < 30 || hour === null) return { max, text: "sem chuva à vista nas próximas horas" };
  const sameHour = now.getHours() === hour && Math.abs(now - when) < 3600_000;
  return { max, text: `nas próximas horas, a maior chance de chuva é ${sameHour ? "agora" : `por volta das ${hour} horas`} (${max}%)` };
}

async function weather(city, day, fetchImpl) {
  const place = await geocode(city, fetchImpl);
  if (!place) return null;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    "&current=temperature_2m,apparent_temperature,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3" +
    (day === 0 ? "&hourly=precipitation_probability&forecast_hours=12" : "");
  const [f, alerts] = await Promise.all([getJson(url, fetchImpl), inmetAlerts(place, fetchImpl).catch(() => [])]);
  const where = [place.name, place.admin1].filter(Boolean).join(", ");
  const days = ["hoje", "amanhã", "depois de amanhã"];
  const lines = [];
  if (day === 0 && f.current) {
    lines.push(
      `agora em ${where}: ${Math.round(f.current.temperature_2m)} °C (sensação de ${Math.round(f.current.apparent_temperature)} °C), ${weatherWords(f.current.weather_code)}`
    );
  }
  const d = f.daily;
  if (d?.time?.[day] !== undefined) {
    lines.push(
      `${days[day]} em ${where}: ${weatherWords(d.weather_code[day])}, mínima de ${Math.round(d.temperature_2m_min[day])} °C, máxima de ${Math.round(d.temperature_2m_max[day])} °C, chance de chuva de ${d.precipitation_probability_max[day] ?? 0}%`
    );
  }
  if (!lines.length) return null;
  const soon = day === 0 ? rainSoon(f.hourly) : null;
  if (soon) lines.push(soon.text);
  // today: the alerts in force now; another day: the ones still in force by then
  const warn = alerts.filter((a) => (day === 0 ? a.now : !a.ends || brDay(a.ends) >= brDay(new Date()) + day)).map((a) => a.short);
  if (warn.length) lines.push(`alertas oficiais do INMET: ${warn.join("; ")}`);
  return {
    source: warn.length ? "Open-Meteo e INMET" : "Open-Meteo",
    text: lines.join("; "),
    data: {
      place: place.name,
      state: place.admin1 ?? "",
      current: f.current
        ? { temp: Math.round(f.current.temperature_2m), words: weatherWords(f.current.weather_code) }
        : null,
      day:
        d?.time?.[day] !== undefined
          ? {
              words: weatherWords(d.weather_code[day]),
              min: Math.round(d.temperature_2m_min[day]),
              max: Math.round(d.temperature_2m_max[day]),
              rain: d.precipitation_probability_max[day] ?? 0,
            }
          : null,
      alerts,
    },
  };
}

// ---------- Weather alerts (INMET, the Brazilian weather service; free, no key) ----------

const INMET_URL = "https://apiprevmet3.inmet.gov.br/avisos/ativos";
const LEVELS = { "perigo potencial": 1, perigo: 2, "grande perigo": 3 };

/** "às 10 horas", "ao meio-dia", "à meia-noite", "à 1 hora". */
function atClock(date) {
  const words = spokenTime(date).replace(/ em ponto$/, "");
  return /^meio-dia/.test(words) ? `ao ${words}` : /^(meia-noite|1 hora)/.test(words) ? `à ${words}` : `às ${words}`;
}

// INMET writes Brasília time ("2026-10-14 23:59"); the PC may be in another time zone (Rondônia
// is an hour behind), so the day is counted in Brasília and the hour is said in local time.
const inmetDate = (s) => {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? { at: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5])), hm: +m[4] * 60 + +m[5], day: +m[3] } : null;
};
const brDay = (d) => Math.floor((d.getTime() - 3 * 3600_000) / 86_400_000);
const dayName = (t, now) => {
  const diff = brDay(t.at) - brDay(now);
  return diff <= 0 ? "hoje" : diff === 1 ? "amanhã" : `dia ${t.day}`;
};

/** "até o fim do dia", "até o fim de amanhã", "até amanhã às 10 horas". */
function untilWords(end, now) {
  const day = dayName(end, now);
  if (end.hm >= 23 * 60 + 55) return day === "hoje" ? "até o fim do dia" : day === "amanhã" ? "até o fim de amanhã" : `até o fim do ${day}`;
  return `até ${day === "hoje" ? "" : `${day} `}${atClock(end.at)}`;
}

/** "a partir de amanhã", "a partir de hoje às 15 horas". */
function fromWords(start, now) {
  const day = dayName(start, now);
  return start.hm <= 5 ? `a partir de ${day}` : `a partir de ${day} ${atClock(start.at)}`;
}

/**
 * The INMET alerts that cover `place` (from geocode()), today's and the coming ones:
 * `[{ id, level, severity, what, now, short, spoken }]`, the most severe first.
 */
export function alertsFor(feed, place, now = new Date()) {
  const uf = UF[place?.admin1] ?? "";
  if (!place?.name || !uf) return [];
  const town = new RegExp(`(?:^|,)\\s*${place.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} - ${uf} \\(`, "i");
  const out = [];
  for (const list of [feed?.hoje, feed?.futuro]) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || a.encerrado || !town.test(String(a.municipios ?? ""))) continue;
      const level = LEVELS[String(a.severidade ?? "").trim().toLowerCase()] ?? 1;
      const start = inmetDate(a.inicio);
      const end = inmetDate(a.fim);
      if (end && end.at < now) continue;
      const what = String(a.descricao ?? "tempo severo").trim().toLowerCase();
      const severity = String(a.severidade ?? "perigo potencial").trim().toLowerCase();
      // the same warning renewed for the next day is one warning (the most severe one is kept)
      const twin = out.findIndex((o) => o.what === what);
      if (twin >= 0 && out[twin].level >= level) continue;
      if (twin >= 0) out.splice(twin, 1);
      const live = !start || start.at <= now;
      const when = live ? (end ? untilWords(end, now) : "") : start ? fromWords(start, now) : "";
      const risk = shortSummary(String(a.riscos?.[0] ?? "").trim(), 160);
      out.push({
        id: String(a.id ?? a.codigo ?? `${what}-${a.inicio}`),
        level,
        severity,
        what,
        now: live,
        ends: end?.at ?? null,
        short: `${what} (${severity})${when ? `, ${when}` : ""}`,
        spoken: `Atenção, mestre: o INMET emitiu um alerta de ${severity} para ${what} em ${place.name}${when ? `, ${when}` : ""}.${risk ? ` ${risk}` : ""}`,
      });
    }
  }
  return out.sort((a, b) => b.level - a.level);
}

/** The INMET alerts for a place (see alertsFor); [] when INMET does not answer. */
export async function inmetAlerts(place, fetchImpl = fetch, now = new Date()) {
  const res = await fetchImpl(INMET_URL, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  return alertsFor(await res.json(), place, now);
}

/** The alerts for the user's city, for the server to announce the severe ones by itself. */
export async function cityAlerts(city, fetchImpl = fetch) {
  const place = await geocode(city, fetchImpl);
  return place ? inmetAlerts(place, fetchImpl) : [];
}

/** The latest stories, `{ source, items }` (Agência Brasil, then g1), or null when both fail. */
export async function newsFeed(fetchImpl = fetch, max = 4) {
  for (const [source, url] of [
    ["Agência Brasil", "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml"],
    ["g1", "https://g1.globo.com/rss/g1/"],
  ]) {
    try {
      // g1 fills its feed with automatic weather posts at night: those are not headlines.
      const items = rssItems(await getText(url, fetchImpl), 12)
        .filter((i) => !/^previs[aã]o do tempo/i.test(i.title))
        .slice(0, max);
      if (items.length) return { source, items };
    } catch {}
  }
  return null;
}

// News from the user's own state, read when the city is there (only Rondônia for now: the Cone
// Sul papers first, then g1 Rondônia).
const LOCAL_FEEDS = {
  Rondônia: [
    ["Extra de Rondônia", "https://www.extraderondonia.com.br/feed/"],
    ["Vilhena Notícias", "https://www.vilhenanoticias.com.br/feed/"],
    ["g1 Rondônia", "https://g1.globo.com/rss/g1/ro/rondonia/"],
  ],
};

/** The state's latest stories, `{ source, items }`, two from each paper that answers; or null. */
export async function localNewsFeed(state, fetchImpl = fetch, max = 4) {
  const feeds = LOCAL_FEEDS[state];
  if (!feeds) return null;
  const lists = await Promise.all(
    feeds.map(([source, url]) =>
      getText(url, fetchImpl)
        .then((xml) => rssItems(xml, 6).map((i) => ({ ...i, source })))
        .catch(() => [])
    )
  );
  const items = [];
  for (let round = 0; items.length < max && lists.some((l) => l.length > round); round++) {
    for (const list of lists) if (list[round] && items.length < max && !items.some((i) => i.title === list[round].title)) items.push(list[round]);
  }
  if (!items.length) return null;
  const sources = [...new Set(items.map((i) => i.source))];
  return { source: sources.join(", "), items };
}

async function news(fetchImpl, { local = false, city = "" } = {}) {
  if (local) {
    const place = city ? await geocode(city, fetchImpl).catch(() => null) : null;
    const feed = await localNewsFeed(place?.admin1 ?? "Rondônia", fetchImpl);
    if (feed) {
      const titles = feed.items.map((i) => i.title);
      return {
        source: feed.source,
        text: "manchetes da região (resuma em poucas frases): " + feed.items.map((i) => `"${i.title}" (${i.source})`).join("; "),
        titles,
      };
    }
  }
  const feed = await newsFeed(fetchImpl);
  if (!feed) return null;
  const titles = feed.items.map((i) => i.title);
  return { source: feed.source, text: "manchetes (resuma em poucas frases): " + titles.map((t) => `"${t}"`).join("; "), titles };
}

async function wiki(query, fetchImpl) {
  let title = "";
  try {
    const found = await getJson(
      `https://pt.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`,
      fetchImpl
    );
    title = found.pages?.[0]?.key ?? "";
  } catch {}
  title ||= query.replace(/\s+/g, "_");
  try {
    const page = await getJson(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, fetchImpl);
    const extract = String(page.extract ?? "").trim();
    if (!extract || page.type === "disambiguation") return null;
    return { source: "Wikipédia", text: `${page.title}: ${extract.slice(0, 900)}` };
  } catch {
    return null;
  }
}

/**
 * Fetches what the question needs. Resolves `{ source, text }`, or null when nothing useful came
 * back (the brain then answers alone and says it could not check).
 */
export async function lookup(found, { city = "", fetchImpl = fetch } = {}) {
  try {
    if (found.kind === "money") return await money(found.codes, fetchImpl);
    if (found.kind === "weather") return await weather(found.city || city || "São Paulo", found.day, fetchImpl);
    if (found.kind === "news") return await news(fetchImpl, { local: found.local, city });
    if (found.kind === "wiki") return await wiki(found.query, fetchImpl);
  } catch {}
  return null;
}

// ---------- Bom dia (the briefing spoken when Alfred starts) ----------

/**
 * "Curiosidade do dia": something that happened on this date, from the Portuguese Wikipedia's
 * "Neste dia" feed. Resolves `{ year, text }` or null.
 */
export async function onThisDay(now = new Date(), fetchImpl = fetch) {
  const two = (n) => String(n).padStart(2, "0");
  try {
    const feed = await getJson(
      `https://api.wikimedia.org/feed/v1/wikipedia/pt/onthisday/selected/${two(now.getMonth() + 1)}/${two(now.getDate())}`,
      fetchImpl
    );
    const events = (Array.isArray(feed.selected) ? feed.selected : [])
      .map((e) => ({
        year: Number(e.year),
        text: String(e.text ?? "")
          .replace(/\s*\([^)]*\)/g, "") // "(bandeiras)" and the like read badly aloud
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((e) => Number.isInteger(e.year) && e.text.length > 10 && e.text.length <= 220);
    if (!events.length) return null;
    const e = events[now.getFullYear() % events.length]; // a different one each year
    return { year: e.year, text: /[.!?]$/.test(e.text) ? e.text : `${e.text}.` };
  } catch {
    return null;
  }
}

/** "7 horas e 15 minutos", "1 hora em ponto", "meio-dia e meia"… as Alfred would say it. */
export function spokenTime(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  const hours = h === 0 ? "meia-noite" : h === 12 ? "meio-dia" : `${h} ${h === 1 ? "hora" : "horas"}`;
  if (m === 0) return h === 0 || h === 12 ? hours : `${hours} em ponto`;
  if (m === 30 && (h === 0 || h === 12)) return `${hours} e meia`;
  return `${hours} e ${m} ${m === 1 ? "minuto" : "minutos"}`;
}

/**
 * The daily briefing: greeting, day and time, the weather in the user's city and the top
 * headlines. Parts whose lookup failed are simply left out.
 */
export function buildBriefing(now = new Date(), { weather = null, news = null, local = null, name = "", birthdays = [], curiosity = null } = {}) {
  const h = now.getHours();
  const [greeting, wish] =
    h >= 5 && h < 12 ? ["Bom dia", "um excelente dia"] : h >= 12 && h < 18 ? ["Boa tarde", "uma excelente tarde"] : ["Boa noite", "uma excelente noite"];
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const time = spokenTime(now);
  const sir = name ? `mestre ${name.split(" ")[0]}` : "mestre";
  const parts = [`${greeting}, ${sir}. Hoje é ${date}, e ${/^(meia-noite|meio-dia|1 hora)/.test(time) ? "é" : "são"} ${time}.`];
  for (const b of birthdays) {
    parts.push(b.who ? `Não se esqueça: hoje é aniversário ${ofWhom(b.who)}.` : "E hoje é o seu aniversário! Meus parabéns, mestre.");
  }
  const w = weather?.data;
  if (w?.day || w?.current) {
    const now_ = w.current ? `agora faz ${w.current.temp} ${Math.abs(w.current.temp) === 1 ? "grau" : "graus"}, com ${w.current.words}. ` : "";
    const day = w.day
      ? `${w.current ? "Para" : "para"} hoje, ${w.day.words}, mínima de ${w.day.min} e máxima de ${w.day.max} graus` +
        (w.day.rain >= 30 ? `, com ${w.day.rain} por cento de chance de chuva.` : ".")
      : "";
    parts.push(`Em ${w.place}, ${now_}${day}`.trim());
    const alert = (w.alerts ?? [])[0];
    if (alert) parts.push(`O INMET tem um alerta de ${alert.severity} para ${alert.what}${alert.now ? "" : " chegando"}.`);
    if (isHot(w)) parts.push("Vai fazer calor, mestre: não se esqueça de beber bastante água.");
  }
  const titles = (news?.titles ?? []).slice(0, 3);
  if (titles.length) parts.push(`Nas notícias, segundo ${/^g1$/i.test(news.source) ? "o" : "a"} ${news.source}: ${titles.map((t) => t.replace(/[.!?…]+$/, "")).join(". ")}.`);
  const near = local?.items?.[0];
  if (near) parts.push(`E aqui na região, segundo o ${near.source}: ${near.title.replace(/[.!?…]+$/, "")}.`);
  if (curiosity) {
    const year = curiosity.year < 0 ? `${-curiosity.year} antes de Cristo` : curiosity.year;
    parts.push(`Uma curiosidade: neste mesmo dia, em ${year}: ${curiosity.text}`);
  }
  parts.push(isLate(now) ? "Já é tarde, mestre. Não deixe de descansar." : `Tenha ${wish}, mestre.`);
  return parts.join(" ");
}

/** Looks up the weather, the news and the curiosity (in parallel) and builds the briefing. */
export async function briefing({ city = "", now = new Date(), fetchImpl = fetch, name = "", birthdays = [] } = {}) {
  const [weather, news, curiosity] = await Promise.all([
    lookup({ kind: "weather", city: city || "São Paulo", day: 0 }, { fetchImpl }),
    lookup({ kind: "news" }, { fetchImpl }),
    onThisDay(now, fetchImpl),
  ]);
  // a headline from the user's state, when Alfred knows papers there
  const state = weather?.data?.state ?? "";
  const local = state ? await localNewsFeed(state, fetchImpl, 1).catch(() => null) : null;
  return buildBriefing(now, { weather, news, local, name, birthdays, curiosity });
}

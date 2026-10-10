// Alfred — "internet leve" for brains that cannot search the web themselves (the local AI and
// Gemini's free tier). Before asking the brain, the server spots questions about exchange rates,
// weather, news or "who/what is …", fetches the answer from free public services (no key) and hands
// it to the brain as context. Anything else goes to the brain unchanged.

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
const MONEY = /cota[cç][aã]o|c[aâ]mbio|quanto (est[aá]|t[aá]|custa|vale)|pre[cç]o do|valor do|d[oó]lar|bitcoin|\beuro/i;
const WEATHER =
  /previs[aã]o do tempo|como (est[aá]|vai estar|vai ficar|fica|t[aá]) o (tempo|clima)|\bclima\b|vai chover|chov|\bchuva|temperatura|quantos graus|faz(endo)? (frio|calor)|(est[aá]|t[aá]) (frio|quente|calor)/i;
const NEWS = /\bnot[ií]cias?\b|\bmanchetes?\b|o que (est[aá] )?(aconteceu|acontecendo) (hoje|no brasil|no mundo)|novidades de hoje/i;
const WHO = /^(?:quem (?:é|e|foi|era)|o que (?:é|e|foi|significa)|onde fica|quando (?:foi|nasceu|morreu))\s+(.{2,80}?)[?.!]*$/i;
// "Alfred," at the start is the wake word, not part of the question.
const WAKE = /^(?:(?:ei|ok|olá|ola|oi)[\s,]+)?alfredo?[\s,.!]+/i;
const CITY = /\b(?:em|no|na|para|pra)\s+((?:[A-ZÀ-Ý][\wÀ-ÿ'-]*)(?:\s+(?:(?:d[aeo]s?|del|di)\s+)?[A-ZÀ-Ý][\wÀ-ÿ'-]*)*)/;

/** What to look up for this question: `{ kind, … }` or null. */
export function detectLookup(text) {
  const q = String(text ?? "").trim().replace(WAKE, "");
  if (!q) return null;
  if (WEATHER.test(q)) {
    const city = q.match(CITY)?.[1]?.trim() ?? "";
    const day = /depois de amanh[aã]/i.test(q) ? 2 : /amanh[aã]/i.test(q) ? 1 : 0;
    return { kind: "weather", city, day };
  }
  if (MONEY.test(q)) {
    const codes = CURRENCIES.filter(([re]) => re.test(q)).map(([, code]) => code);
    return { kind: "money", codes: codes.length ? codes : ["USD"] };
  }
  if (NEWS.test(q)) return { kind: "news" };
  const who = q.match(WHO);
  if (who) return { kind: "wiki", query: who[1].trim() };
  return null;
}

/** A short label for the "Pesquisando: …" status. */
export function lookupLabel(lookup, config = {}) {
  if (lookup.kind === "weather") return `clima em ${lookup.city || config.city || "São Paulo"}`;
  if (lookup.kind === "money") return "cotação " + lookup.codes.map((c) => CURRENCY_NAME[c] ?? c).join(", ");
  if (lookup.kind === "news") return "notícias de hoje";
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

/** Pulls `<item><title>` texts out of an RSS feed (titles only; nothing is ever executed). */
export function rssTitles(xml, max = 6) {
  const titles = [];
  for (const item of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const m = item[0].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = m?.[1]
      ?.replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (title && !titles.includes(title)) titles.push(title.slice(0, 200));
    if (titles.length >= max) break;
  }
  return titles;
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

async function weather(city, day, fetchImpl) {
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
    fetchImpl
  );
  const place = geo.results?.[0];
  if (!place) return null;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    "&current=temperature_2m,apparent_temperature,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3";
  const f = await getJson(url, fetchImpl);
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
  return lines.length ? { source: "Open-Meteo", text: lines.join("; ") } : null;
}

async function news(fetchImpl) {
  for (const [source, url] of [
    ["Agência Brasil", "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml"],
    ["g1", "https://g1.globo.com/rss/g1/"],
  ]) {
    try {
      // g1 fills its feed with automatic weather posts at night: those are not headlines.
      const titles = rssTitles(await getText(url, fetchImpl), 12)
        .filter((t) => !/^previs[aã]o do tempo/i.test(t))
        .slice(0, 4);
      if (titles.length) {
        return { source, text: "manchetes (resuma em poucas frases): " + titles.map((t) => `"${t}"`).join("; ") };
      }
    } catch {}
  }
  return null;
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
    if (found.kind === "news") return await news(fetchImpl);
    if (found.kind === "wiki") return await wiki(found.query, fetchImpl);
  } catch {}
  return null;
}

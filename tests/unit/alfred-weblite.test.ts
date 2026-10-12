import test from "node:test";
import assert from "node:assert/strict";

import { detectLookup, lookup, lookupLabel, rssItems, shortSummary, weatherWords } from "../../contrib/alfred/weblite.mjs";

test("detectLookup spots rates, weather, news and who/what questions — and leaves the rest alone", () => {
  assert.deepEqual(detectLookup("Alfred, quanto está o dólar hoje?"), { kind: "money", codes: ["USD"] });
  assert.deepEqual(detectLookup("qual a cotação do euro e do bitcoin"), { kind: "money", codes: ["EUR", "BTC"] });
  assert.deepEqual(detectLookup("Como vai estar o tempo amanhã em Campinas?"), { kind: "weather", city: "Campinas", day: 1 });
  assert.deepEqual(detectLookup("está frio em Porto Alegre?"), { kind: "weather", city: "Porto Alegre", day: 0 });
  assert.deepEqual(detectLookup("vai chover depois de amanhã?"), { kind: "weather", city: "", day: 2 });
  assert.deepEqual(detectLookup("quais as notícias de hoje"), { kind: "news" });
  assert.deepEqual(detectLookup("quem foi Santos Dumont?"), { kind: "wiki", query: "Santos Dumont" });
  assert.deepEqual(detectLookup("Alfred, o que é fotossíntese"), { kind: "wiki", query: "fotossíntese" });
  for (const plain of ["quanto tempo leva para cozinhar arroz", "me conta uma piada", "boa noite", "", undefined]) {
    assert.equal(detectLookup(plain as string), null, String(plain));
  }
  assert.equal(lookupLabel({ kind: "weather", city: "", day: 0 }, { city: "Recife" }), "clima em Recife");
  assert.equal(lookupLabel({ kind: "money", codes: ["USD", "BTC"] }), "cotação dólar, bitcoin");
  assert.equal(weatherWords(61), "chuva fraca");
});

test("rssItems: title, category and a clean summary, never captions, related links or posts", () => {
  const story = "Lead da matéria com mais de sessenta caracteres para valer como resumo da notícia.";
  const xml = `<rss><channel><title>Feed</title>
    <item><title><![CDATA[Câmara aprova <b>projeto</b>]]></title><category>Política</category><category>tag</category>
      <description>&lt;p&gt;&lt;img src="x.jpg"&gt;&lt;/p&gt;&lt;p&gt;Foto: Fulano/Agência Brasil&lt;/p&gt;&lt;p&gt;Notícias relacionadas: outra coisa qualquer que é bem longa mesmo, com mais de sessenta.&lt;/p&gt;&lt;p&gt;${story} &amp;quot;ok&amp;quot;&lt;/p&gt;</description></item>
    <item><title>Chuva &amp; frio no Sul</title><atom:subtitle>Frente fria chega &lt;i&gt;amanhã&lt;/i&gt;.</atom:subtitle>
      <description><![CDATA[ <img src="y.jpg" /> ]]> texto</description></item>
    <item><title>Chuva &amp; frio no Sul</title></item>
    <item><title>Sem resumo</title><script>alert(1)</script></item></channel></rss>`;
  assert.deepEqual(rssItems(xml), [
    { title: "Câmara aprova projeto", category: "Política", summary: `${story} "ok"` },
    { title: "Chuva & frio no Sul", category: "", summary: "Frente fria chega amanhã." },
    { title: "Sem resumo", category: "", summary: "" },
  ]);
  assert.equal(rssItems(xml, 1).length, 1);
});

test("shortSummary cuts at a sentence end, or at a word with an ellipsis", () => {
  assert.equal(shortSummary("Curto."), "Curto.");
  const long = "Primeira frase bem comprida que explica o caso todo com calma e detalhes. " + "palavra ".repeat(60);
  assert.equal(shortSummary(long, 120), "Primeira frase bem comprida que explica o caso todo com calma e detalhes.");
  const words = "palavra ".repeat(60).trim();
  const cut = shortSummary(words, 50);
  assert.ok(cut.endsWith("palavra…") && cut.length <= 51, cut);
});

// A fake fetch that answers by URL prefix.
function fakeFetch(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const impl = async (url: string) => {
    asked.push(url);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit || hit[1] instanceof Error) return new Response("no", { status: 429 });
    const body = typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]);
    return new Response(body, { status: 200 });
  };
  return { impl, asked };
}

test("money: live quote first, daily rate as fallback when the live service refuses", async () => {
  const live = fakeFetch({
    "https://economia.awesomeapi.com.br/": { USDBRL: { code: "USD", bid: "5.0123", pctChange: "-0.4" } },
  });
  const a = await lookup({ kind: "money", codes: ["USD"] }, { fetchImpl: live.impl });
  assert.equal(a?.source, "AwesomeAPI (cotação ao vivo)");
  assert.match(a?.text ?? "", /^dólar: R\$\s?5,01 \(variação no dia: -0.4%\)$/);
  const fallback = fakeFetch({
    "https://open.er-api.com/": { rates: { USD: 0.2 } },
    "https://api.coingecko.com/": { bitcoin: { brl: 411964 } },
  });
  const b = await lookup({ kind: "money", codes: ["USD", "BTC"] }, { fetchImpl: fallback.impl });
  assert.match(b?.text ?? "", /dólar: R\$\s?5,00 \(cotação do dia\); bitcoin: R\$\s?411\.964/);
});

test("weather: finds the city, then today's or tomorrow's forecast; default city when none is said", async () => {
  const f = fakeFetch({
    "https://geocoding-api.open-meteo.com/": { results: [{ name: "Recife", admin1: "Pernambuco", latitude: -8, longitude: -35 }] },
    "https://api.open-meteo.com/": {
      current: { temperature_2m: 27.4, apparent_temperature: 30.2, weather_code: 2 },
      daily: {
        time: ["d0", "d1", "d2"],
        weather_code: [2, 63, 0],
        temperature_2m_min: [22, 21, 20],
        temperature_2m_max: [30, 28, 31],
        precipitation_probability_max: [10, 80, 0],
      },
    },
  });
  const tomorrow = await lookup({ kind: "weather", city: "", day: 1 }, { city: "Recife", fetchImpl: f.impl });
  assert.equal(tomorrow?.source, "Open-Meteo");
  assert.equal(tomorrow?.text, "amanhã em Recife, Pernambuco: chuva, mínima de 21 °C, máxima de 28 °C, chance de chuva de 80%");
  assert.match(f.asked[0], /name=Recife/);
  const today = await lookup({ kind: "weather", city: "Recife", day: 0 }, { fetchImpl: f.impl });
  assert.match(today?.text ?? "", /^agora em Recife, Pernambuco: 27 °C \(sensação de 30 °C\), parcialmente nublado; hoje/);
});

test("news and wiki: skip automatic weather posts; nothing useful → null (Alfred says he could not check)", async () => {
  const feed = `<rss><channel><item><title>Previsão do tempo hoje para Osasco</title></item><item><title>Senado vota PEC</title></item></channel></rss>`;
  const n = await lookup({ kind: "news" }, { fetchImpl: fakeFetch({ "https://agenciabrasil.ebc.com.br/": feed }).impl });
  assert.deepEqual(n, { source: "Agência Brasil", text: 'manchetes (resuma em poucas frases): "Senado vota PEC"', titles: ["Senado vota PEC"] });
  const w = await lookup(
    { kind: "wiki", query: "Santos Dumont" },
    {
      fetchImpl: fakeFetch({
        "https://pt.wikipedia.org/w/rest.php/": { pages: [{ key: "Santos_Dumont" }] },
        "https://pt.wikipedia.org/api/rest_v1/page/summary/Santos_Dumont": { title: "Santos Dumont", extract: "Aeronauta brasileiro." },
      }).impl,
    }
  );
  assert.deepEqual(w, { source: "Wikipédia", text: "Santos Dumont: Aeronauta brasileiro." });
  assert.equal(await lookup({ kind: "news" }, { fetchImpl: fakeFetch({}).impl }), null);
  assert.equal(await lookup({ kind: "money", codes: ["USD"] }, { fetchImpl: fakeFetch({}).impl }), null);
});

test("bom dia: spoken time and the daily briefing, leaving out what could not be looked up", async () => {
  const { spokenTime, buildBriefing } = await import("../../contrib/alfred/weblite.mjs");
  const at = (h: number, m: number) => new Date(2026, 9, 10, h, m);
  assert.equal(spokenTime(at(7, 15)), "7 horas e 15 minutos");
  assert.equal(spokenTime(at(1, 0)), "1 hora em ponto");
  assert.equal(spokenTime(at(12, 0)), "meio-dia");
  assert.equal(spokenTime(at(0, 30)), "meia-noite e meia");
  assert.equal(spokenTime(at(13, 1)), "13 horas e 1 minuto");
  const weather = {
    source: "Open-Meteo",
    text: "",
    data: { place: "Cabixi", current: { temp: 23, words: "poucas nuvens" }, day: { words: "trovoadas", min: 22, max: 33, rain: 97 } },
  };
  const news = { source: "Agência Brasil", text: "", titles: ["Senado vota PEC.", "Chuva no Sul", "Copa começa", "Quarta manchete"] };
  assert.equal(
    buildBriefing(at(7, 15), { weather, news, curiosity: { year: 1911, text: "Começa a Revolta de Wuchang." } }),
    "Bom dia, mestre. Hoje é sábado, 10 de outubro, e são 7 horas e 15 minutos. " +
      "Em Cabixi, agora faz 23 graus, com poucas nuvens. Para hoje, trovoadas, mínima de 22 e máxima de 33 graus, com 97 por cento de chance de chuva. " +
      "Vai fazer calor, mestre: não se esqueça de beber bastante água. " +
      "Nas notícias, segundo a Agência Brasil: Senado vota PEC. Chuva no Sul. Copa começa. " +
      "Uma curiosidade: neste mesmo dia, em 1911: Começa a Revolta de Wuchang. " +
      "Tenha um excelente dia, mestre."
  );
  assert.equal(
    buildBriefing(at(12, 0)),
    "Boa tarde, mestre. Hoje é sábado, 10 de outubro, e é meio-dia. Tenha uma excelente tarde, mestre.",
    "no weather, no news: just the greeting"
  );
  const dry = { ...weather, data: { ...weather.data, current: null, day: { ...weather.data.day, max: 30, rain: 10 } } };
  assert.match(buildBriefing(at(20, 5), { weather: dry }), /^Boa noite.*Em Cabixi, para hoje, trovoadas, mínima de 22 e máxima de 30 graus\. Tenha uma excelente noite, mestre\.$/);
  assert.match(buildBriefing(at(23, 40)), /^Boa noite, mestre\..* Já é tarde, mestre\. Não deixe de descansar\.$/, "late at night: rest");
});

test("curiosidade do dia: Wikipedia's 'Neste dia', cleaned for speech; null when it fails", async () => {
  const { onThisDay } = await import("../../contrib/alfred/weblite.mjs");
  const feed = fakeFetch({
    "https://api.wikimedia.org/feed/v1/wikipedia/pt/onthisday/selected/10/10": {
      selected: [
        { year: 1911, text: "Começa a Revolta de Wuchang, que leva à fundação da República da China (bandeiras) no ano seguinte" },
        { year: 2003, text: "x".repeat(300) },
      ],
    },
  });
  assert.deepEqual(await onThisDay(new Date(2026, 9, 10, 7), feed.impl), {
    year: 1911,
    text: "Começa a Revolta de Wuchang, que leva à fundação da República da China no ano seguinte.",
  });
  assert.equal(await onThisDay(new Date(2026, 9, 10, 7), fakeFetch({}).impl), null);
  const { buildBriefing } = await import("../../contrib/alfred/weblite.mjs");
  assert.match(buildBriefing(new Date(2026, 2, 15, 9), { curiosity: { year: -44, text: "Júlio César é assassinado." } }), /em 44 antes de Cristo: Júlio César/);
});

test("newsFeed: Agência Brasil first, g1 when it fails, without weather posts", async () => {
  const { newsFeed } = await import("../../contrib/alfred/weblite.mjs");
  const rss = (...titles: string[]) => `<rss><channel>${titles.map((t) => `<item><title>${t}</title><category>Geral</category></item>`).join("")}</channel></rss>`;
  const ab = fakeFetch({ "https://agenciabrasil.ebc.com.br/": rss("Um", "Dois", "Três", "Quatro", "Cinco") });
  const feed = await newsFeed(ab.impl);
  assert.equal(feed?.source, "Agência Brasil");
  assert.deepEqual(feed?.items.map((i) => i.title), ["Um", "Dois", "Três", "Quatro"]);
  const g1 = fakeFetch({ "https://g1.globo.com/": rss("Previsão do tempo para amanhã", "Notícia do g1") });
  assert.deepEqual(await newsFeed(g1.impl), { source: "g1", items: [{ title: "Notícia do g1", category: "Geral", summary: "" }] });
  assert.equal(await newsFeed(fakeFetch({}).impl), null);
});

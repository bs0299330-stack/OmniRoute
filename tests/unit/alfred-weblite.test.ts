import test from "node:test";
import assert from "node:assert/strict";

import { detectLookup, lookup, lookupLabel, rssTitles, weatherWords } from "../../contrib/alfred/weblite.mjs";

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

test("rssTitles reads item titles (CDATA and entities), never the channel title", () => {
  const xml = `<rss><channel><title>Feed</title>
    <item><title><![CDATA[Câmara aprova <b>projeto</b>]]></title></item>
    <item><title>Chuva &amp; frio no Sul</title></item>
    <item><title>Chuva &amp; frio no Sul</title></item></channel></rss>`;
  assert.deepEqual(rssTitles(xml), ["Câmara aprova projeto", "Chuva & frio no Sul"]);
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
    buildBriefing(at(7, 15), { weather, news }),
    "Bom dia, senhor. Hoje é sábado, 10 de outubro, e são 7 horas e 15 minutos. " +
      "Em Cabixi, agora faz 23 graus, com poucas nuvens. Para hoje, trovoadas, mínima de 22 e máxima de 33 graus, com 97 por cento de chance de chuva. " +
      "Nas notícias, segundo a Agência Brasil: Senado vota PEC. Chuva no Sul. Copa começa. " +
      "Tenha um excelente dia, senhor."
  );
  assert.equal(
    buildBriefing(at(12, 0)),
    "Boa tarde, senhor. Hoje é sábado, 10 de outubro, e é meio-dia. Tenha uma excelente tarde, senhor.",
    "no weather, no news: just the greeting"
  );
  const dry = { ...weather, data: { ...weather.data, current: null, day: { ...weather.data.day, rain: 10 } } };
  assert.match(buildBriefing(at(20, 5), { weather: dry }), /^Boa noite.*Em Cabixi, para hoje, trovoadas, mínima de 22 e máxima de 33 graus\. Tenha uma excelente noite, senhor\.$/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHUNKING,
  VOICE_DEFAULTS,
  cleanForSpeech,
  createChunker,
  matchWakeWord,
  rankVoices,
  scoreVoice,
} from "../../contrib/alfred/public/voice.mjs";

function stream(chunker: ReturnType<typeof createChunker>, text: string, size = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...chunker.push(text.slice(i, i + size)));
  out.push(...chunker.flush());
  return out;
}

test("cleanForSpeech drops markdown, links, emoji and code", () => {
  assert.equal(cleanForSpeech("**Olá**, _senhor_! 🎩"), "Olá, senhor!");
  assert.equal(cleanForSpeech("Veja [o site](https://x.y) agora"), "Veja o site agora");
  assert.equal(cleanForSpeech("Acesse https://exemplo.com hoje"), "Acesse o link hoje");
  assert.equal(cleanForSpeech("# Título\n- item um\n2. item dois"), "Título item um item dois");
  assert.equal(cleanForSpeech("Rode `npm test`:\n```js\nx()\n```\npronto"), "Rode npm test: pronto");
  assert.equal(cleanForSpeech("```js\nmeio de bloco"), "");
});

test("createChunker emits whole sentences while streaming", () => {
  const text = "Boa noite, senhor. O jantar está servido! Deseja mais alguma coisa?";
  const out = stream(createChunker({ firstMin: 100 }), text);
  assert.deepEqual(out, ["Boa noite, senhor.", "O jantar está servido!", "Deseja mais alguma coisa?"]);
});

test("createChunker starts early at a comma for the first chunk only", () => {
  const text =
    "Certamente, senhor, verifiquei a sua agenda inteira, e amanhã o dia está livre, salvo o almoço.";
  const out = stream(createChunker({ firstMin: 20 }), text);
  assert.equal(out[0], "Certamente, senhor, verifiquei a sua agenda inteira,");
  assert.equal(out.join(" "), text);
  assert.equal(out.length, 2);
});

test("createChunker does not split on abbreviations or decimals", () => {
  const text = "O Sr. Wayne chega às 3.5 horas, aprox. às dez. Tudo certo.";
  const out = stream(createChunker({ firstMin: 999 }), text);
  assert.deepEqual(out, ["O Sr. Wayne chega às 3.5 horas, aprox. às dez.", "Tudo certo."]);
});

test("createChunker splits very long sentences at a pause", () => {
  const long = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(" ");
  const out = stream(createChunker({ firstMin: 999, max: 80 }), long + ".");
  assert.ok(out.length > 1);
  for (const piece of out) assert.ok(piece.length <= 80, piece);
  assert.equal(out.join(" "), long + ".");
});

test("after the first chunk, sentences are grouped into longer runs", () => {
  const text =
    "Pois não. O chá está pronto. A biblioteca foi arrumada. As cortinas foram trocadas. " +
    "O carro está na garagem. Mais alguma coisa, senhor?";
  const out = stream(createChunker(CHUNKING.neural), text);
  assert.equal(out[0], "Pois não.");
  assert.equal(out.length, 2);
  assert.equal(out.join(" "), text);
});

test("grouping never exceeds the max run length", () => {
  const sentence = "Esta é uma frase de tamanho médio para o teste. ";
  const out = stream(createChunker({ ...CHUNKING.browser, firstAtComma: false }), sentence.repeat(12));
  assert.ok(out.length >= 3);
  for (const piece of out) assert.ok(piece.length <= CHUNKING.browser.max, piece);
});

test("the default voice keeps natural rate and pitch", () => {
  assert.equal(VOICE_DEFAULTS.rate, 1);
  assert.equal(VOICE_DEFAULTS.pitch, 1);
});

test("rankVoices prefers natural male pt-BR voices and drops other languages", () => {
  const voices = [
    { name: "Microsoft Maria - Portuguese (Brazil)", lang: "pt-BR", localService: true },
    { name: "Google US English", lang: "en-US", localService: false },
    { name: "Microsoft Francisca Online (Natural) - Portuguese (Brazil)", lang: "pt-BR", localService: false },
    { name: "Microsoft Antonio Online (Natural) - Portuguese (Brazil)", lang: "pt-BR", localService: false },
    { name: "Google português do Brasil", lang: "pt-BR", localService: false },
    { name: "Joana", lang: "pt_PT", localService: true },
  ];
  const ranked = rankVoices(voices).map((v) => v.name);
  assert.equal(ranked.length, 5);
  assert.match(ranked[0], /Antonio/);
  assert.match(ranked[1], /Francisca/);
  assert.match(ranked[2], /Google português/);
  assert.equal(ranked.at(-1), "Joana");
  assert.equal(scoreVoice({ name: "Google US English", lang: "en-US" }), -1);
});

test("matchWakeWord finds Alfred and the command after it", () => {
  assert.deepEqual(matchWakeWord("Alfred, que horas são?"), { command: "que horas são?" });
  assert.deepEqual(matchWakeWord("ei Alfredo me conta uma piada"), { command: "me conta uma piada" });
  assert.deepEqual(matchWakeWord("Álfred"), { command: "" });
  assert.equal(matchWakeWord("o alfredinho chegou"), null);
  assert.equal(matchWakeWord("bom dia"), null);
});

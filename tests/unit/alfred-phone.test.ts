import test from "node:test";
import assert from "node:assert/strict";

import {
  contactName,
  formatPhone,
  normalizePhone,
  openContacts,
  spokenPhone,
} from "../../contrib/alfred/contacts.mjs";
import { isLocalRequest, isOwnRequest, loadConfig } from "../../contrib/alfred/lib.mjs";
import { createPcControl } from "../../contrib/alfred/pc.mjs";

test("phone numbers: Brazilian formats, the area code, how they are said and shown", () => {
  assert.equal(normalizePhone("69 99912-3456"), "+5569999123456");
  assert.equal(normalizePhone("(69) 3341-2233"), "+556933412233");
  assert.equal(normalizePhone("+55 69 99912 3456"), "+5569999123456");
  assert.equal(normalizePhone("0 69 99912-3456"), "+5569999123456");
  assert.deepEqual(normalizePhone("99912-3456"), { needsDdd: true, digits: "999123456" });
  assert.equal(normalizePhone("99912-3456", "69"), "+5569999123456");
  assert.equal(normalizePhone("123"), null);
  assert.equal(spokenPhone("+5569999123456"), "69, 9 9 9 1 2, 3 4 5 6");
  assert.equal(formatPhone("+5569999123456"), "(69) 99912-3456");
  assert.deepEqual(contactName("minha mãe"), { key: "mae", name: "sua mãe" });
  assert.deepEqual(contactName("meu irmão"), { key: "irmao", name: "seu irmão" });
  assert.deepEqual(contactName("o João"), { key: "joao", name: "João" });
  assert.equal(contactName("série do notebook"), null);
});

test("contacts: save, ask, call, WhatsApp and forget — always as a button, never by himself", () => {
  const c = openContacts(null);
  assert.equal(
    c.handle("O número da minha mãe é 69 99912-3456"),
    "Anotado, mestre: o número de sua mãe é 69, 9 9 9 1 2, 3 4 5 6."
  );
  assert.equal(
    c.handle("o telefone do João é (69) 3341-2233"),
    "Anotado, mestre: o número de João é 69, 3 3 4 1, 2 2 3 3."
  );
  assert.equal(
    c.handle("Alfred, o número do meu irmão é 99912-3456"),
    "Qual é o DDD do número de seu irmão, mestre?"
  );
  assert.equal(c.handle("69"), "Anotado, mestre: o número de seu irmão é 69, 9 9 9 1 2, 3 4 5 6.");
  assert.equal(
    c.handle("qual é o número da minha mãe?"),
    "O número de sua mãe é 69, 9 9 9 1 2, 3 4 5 6, mestre."
  );
  assert.deepEqual(c.handle("liga pra minha mãe"), {
    text: "É só tocar em Ligar, mestre, e eu chamo sua mãe.",
    action: { kind: "call", label: "Ligar para sua mãe", url: "tel:+5569999123456" },
  });
  assert.deepEqual(c.handle("manda no WhatsApp pro João que eu chego às 8"), {
    text: "Escrevi para João: Eu chego às 8. É só tocar em Enviar no WhatsApp, mestre.",
    action: {
      kind: "whatsapp",
      label: "Enviar no WhatsApp para João",
      url: "https://wa.me/556933412233?text=Eu%20chego%20%C3%A0s%208",
    },
  });
  assert.equal(
    (c.handle("Envia pra minha mãe pelo WhatsApp: bom dia, tudo bem?") as { text: string }).text,
    "Escrevi para sua mãe: Bom dia, tudo bem? É só tocar em Enviar no WhatsApp, mestre."
  );
  assert.equal(
    (c.handle("abre o WhatsApp da minha mãe") as { action: { url: string } }).action.url,
    "https://wa.me/5569999123456"
  );
  assert.equal((c.handle("liga pro SAMU") as { action: { url: string } }).action.url, "tel:192");
  assert.equal(
    c.handle("liga pro Pedro"),
    "Não tenho o número de Pedro, mestre. Diga, por exemplo: o número de Pedro é 69 99999-9999."
  );
  assert.equal(
    c.handle("quais são meus contatos?"),
    "Tenho os números de sua mãe, João e seu irmão, mestre."
  );
  assert.equal(c.handle("esquece o número do João"), "Pronto, mestre: apaguei o número de João.");
  for (const other of [
    "liga a luz",
    "liga o computador",
    "manda um beijo",
    "o número de série do notebook é 123456789",
    "que horas são?",
  ]) {
    assert.equal(c.handle(other), null, other);
  }
});

test("the phone reaches Alfred by its Tailscale name; only the notebook's own page skips the token", () => {
  assert.equal(isOwnRequest({ host: "notebook.tail1234.ts.net" }), true);
  assert.equal(
    isOwnRequest({ host: "notebook.tail1234.ts.net", origin: "https://notebook.tail1234.ts.net" }),
    true
  );
  assert.equal(
    isOwnRequest({ host: "notebook.tail1234.ts.net", origin: "https://evil.example" }),
    false
  );
  assert.equal(isOwnRequest({ host: "alfred.example.com" }), false);
  assert.equal(
    isOwnRequest({ host: "alfred.example.com" }, { hosts: ["alfred.example.com"] }),
    true
  );
  assert.deepEqual(loadConfig({ ALFRED_HOSTS: " A.ts.net , b.local " }).hosts, [
    "a.ts.net",
    "b.local",
  ]);
  assert.equal(isLocalRequest({ host: "localhost:20140" }, "127.0.0.1"), true);
  assert.equal(isLocalRequest({ host: "127.0.0.1:20140" }, "::ffff:127.0.0.1"), true);
  assert.equal(
    isLocalRequest({ host: "notebook.tail1234.ts.net" }, "127.0.0.1"),
    false,
    "Tailscale's proxy runs on this PC, but the phone asked"
  );
  assert.equal(isLocalRequest({ host: "localhost:20140" }, "192.168.0.7"), false);
  assert.equal(isLocalRequest({ host: "192.168.0.10:20140" }, "192.168.0.7"), false);
  assert.equal(
    loadConfig({ ALFRED_NTFY: "alfred-abcd-efgh-jkmn" }).ntfyTopic,
    "alfred-abcd-efgh-jkmn"
  );
  assert.equal(
    loadConfig({ ALFRED_NTFY: "curto" }).ntfyTopic,
    "",
    "a short topic is too easy to guess"
  );
});

test("PC commands asked from the phone: sites and maps open there; the PC-only ones are not done", async () => {
  const spawned: string[] = [];
  const spawnImpl = ((cmd: string) => {
    spawned.push(cmd);
    return { on() {}, unref() {} };
  }) as never;
  const pc = createPcControl({
    platform: "win32",
    spawnImpl,
    systemInfo: async () => ({ cpu: 10, usedMem: 4, totalMem: 8, battery: null }),
  });
  assert.deepEqual(pc.handle("abre o YouTube", { remote: true }), {
    text: "Aqui está YouTube, mestre.",
    action: { kind: "open", label: "Abrir YouTube", url: "https://www.youtube.com/" },
  });
  assert.equal(
    (pc.handle("como chegar em Vilhena", { remote: true }) as { action: { url: string } }).action
      .url,
    "https://www.google.com/maps/dir/?api=1&destination=vilhena"
  );
  assert.match(String(pc.handle("desliga o computador", { remote: true })), /só faço no notebook/);
  assert.match(String(pc.handle("aumenta o volume", { remote: true })), /só faço no notebook/);
  assert.match(
    String(await pc.handle("como está o computador?", { remote: true })),
    /^No notebook: O processador está em 10 por cento/
  );
  assert.deepEqual(spawned, [], "nothing ran on the notebook");
  assert.equal(pc.handle("que horas são", { remote: true }), null);
});

test("streamReply: Alfred's own answers carry their button; from the phone, sites open there", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { streamReply } = await import("../../contrib/alfred/brain.mjs");
  const dir = mkdtempSync(join(tmpdir(), "alfred-phone-"));
  try {
    const config = loadConfig({
      ALFRED_CONTATOS: join(dir, "c.json"),
      ALFRED_LEMBRETES: join(dir, "l.json"),
      ALFRED_MEMORY: "off",
      ALFRED_LOCAL_URL: "http://127.0.0.1:9/v1",
    });
    const run = async (said: string, remote = false) => {
      const pieces: unknown[] = [];
      for await (const p of streamReply(config, "local", [{ role: "user", content: said }], {
        remote,
      }))
        pieces.push(p);
      return pieces;
    };
    await run("o número da minha mãe é 69 99912-3456");
    assert.deepEqual(await run("liga pra minha mãe"), [
      "É só tocar em Ligar, mestre, e eu chamo sua mãe.",
      { action: { kind: "call", label: "Ligar para sua mãe", url: "tel:+5569999123456" } },
    ]);
    assert.deepEqual(await run("abre o YouTube", true), [
      "Aqui está YouTube, mestre.",
      { action: { kind: "open", label: "Abrir YouTube", url: "https://www.youtube.com/" } },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server: the app files, the token for the phone only, avisos to ntfy", async () => {
  const { spawn } = await import("node:child_process");
  const { createServer, request } = await import("node:http");
  // a fake ntfy that records what Alfred sends
  const got: { url?: string; headers: Record<string, unknown>; body: string }[] = [];
  const ntfy = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      got.push({ url: req.url, headers: req.headers, body });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => ntfy.listen(0, "127.0.0.1", () => resolve()));
  const ntfyPort = (ntfy.address() as { port: number }).port;
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "alfred-phone-srv-"));
  // a port the system says is free right now (fixed numbers collide with the other server tests)
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const port = (probe.address() as { port: number }).port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["contrib/alfred/server.mjs"], {
    env: {
      ...process.env,
      ALFRED_PORT: String(port),
      ALFRED_BRAIN: "local",
      ALFRED_LOCAL_URL: "http://127.0.0.1:9/v1",
      ALFRED_TOKEN: "abcd-efgh-jkmn-pqrs",
      ALFRED_HOSTS: "notebook.tail1234.ts.net",
      ALFRED_NTFY: "alfred-test-topic-1234",
      ALFRED_NTFY_URL: `http://127.0.0.1:${ntfyPort}`,
      ALFRED_MEMORY: "off",
      ALFRED_LEMBRETES: join(dir, "l.json"),
      ALFRED_CONTATOS: join(dir, "c.json"),
      ALFRED_CITY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const call = (
    path: string,
    { host = `127.0.0.1:${port}`, method = "GET", body = "", token = "" } = {}
  ) =>
    new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            host,
            ...(body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (d) => (text += d));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              type: String(res.headers["content-type"]),
              text,
            })
          );
        }
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not start")), 10_000);
      child.stdout.on("data", (d) => {
        if (String(d).includes(`:${port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error("server exited " + code)));
    });
    const manifest = await call("/manifest.webmanifest");
    assert.equal(manifest.status, 200);
    assert.match(manifest.type, /application\/manifest\+json/);
    assert.equal(JSON.parse(manifest.text).display, "standalone");
    assert.equal((await call("/sw.js")).status, 200);
    const icon = await call("/icons/icon-192.png");
    assert.equal(icon.status, 200);
    assert.equal(icon.type, "image/png");
    assert.equal((await call("/icons/../server.mjs")).status, 404);

    const phone = "notebook.tail1234.ts.net";
    const chat = (host: string, token = "") =>
      call("/api/chat", {
        host,
        method: "POST",
        token,
        body: JSON.stringify({ messages: [{ role: "user", content: "timer de 2 segundos" }] }),
      });
    assert.equal(
      (await chat(`127.0.0.1:${port}`)).status,
      200,
      "the notebook's own page needs no token"
    );
    assert.equal((await chat(phone)).status, 401, "the phone needs the token");
    const ok = await chat(phone, "abcd-efgh-jkmn-pqrs");
    assert.equal(ok.status, 200);
    assert.match(ok.text, /Timer de 2 segundos/);
    const health = JSON.parse(
      (await call("/api/health", { host: phone, token: "abcd-efgh-jkmn-pqrs" })).text
    );
    assert.deepEqual(health.ntfy, {
      topic: "alfred-test-topic-1234",
      server: `http://127.0.0.1:${ntfyPort}`,
    });
    assert.deepEqual(
      JSON.parse((await call("/api/health", { host: phone })).text),
      { ok: true, auth: true },
      "nothing without the token"
    );

    // the two timers end: each goes to the phone as a notification
    const deadline = Date.now() + 15_000;
    while (got.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    assert.equal(got.length, 2);
    assert.equal(got[0].url, "/alfred-test-topic-1234");
    assert.equal(got[0].body, "Mestre, o timer de 2 segundos terminou.");
    assert.equal(got[0].headers.title, "Alfred");
    assert.equal(got[0].headers.tags, "hourglass");
    assert.equal(got[0].headers.click, `https://${phone}/`);
  } finally {
    child.kill();
    ntfy.closeAllConnections();
    ntfy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

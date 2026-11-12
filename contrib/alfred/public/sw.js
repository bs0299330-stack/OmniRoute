// Alfred — the service worker that lets the phone install the page as an app. It keeps nothing
// in a cache (every file always comes fresh from Alfred), except a small page shown when Alfred
// cannot be reached: the notebook is off, or the phone is not connected to Tailscale.
const OFFLINE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alfred</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060b;color:#d6d3e0;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}h1{color:#f5c400;font-weight:500;font-size:22px}button{margin-top:16px;padding:12px 22px;border-radius:999px;border:1px solid #f5c400;background:none;color:#f5c400;font-size:16px}</style></head>
<body><main><h1>O Alfred não respondeu</h1><p>Confira se o notebook está ligado com o Alfred aberto<br>e se o Tailscale está ligado neste celular.</p><button onclick="location.reload()">Tentar de novo</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // everything else goes straight to the network
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE, { headers: { "content-type": "text/html; charset=utf-8" } })
    )
  );
});

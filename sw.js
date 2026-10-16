// Service worker do app GSJ Marcenaria.
// Guarda o "esqueleto" do app (as páginas + manifest + ícones) pra abrir
// mesmo offline. CDNs externos (fontes, Supabase, html2canvas/jsPDF) e
// chamadas de rede pra nuvem NÃO passam por aqui — seguem direto, porque
// precisam de internet de verdade (salvar/abrir da nuvem exige conexão).
//
// Pra publicar uma atualização: troque o número da versão abaixo
// (CACHE_VERSION) sempre que mudar algum arquivo. Sem isso, quem já
// instalou o app pode continuar vendo a versão antiga por um tempo.
const CACHE_VERSION = "v10";
const CACHE_NAME = "gsj-app-" + CACHE_VERSION;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./orcamento.html",
  "./contrato.html",
  "./recibo.html",
  "./termo-entrega.html",
  "./plano-de-cortes.html",
  "./admin.html",
  "./obras.html",
  "./cliente.html",
  "./licitacoes.html",
  "./manifest.webmanifest",
  "./shell.css",
  "./auth.js",
  "./wpp.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  const url = new URL(req.url);

  // bibliotecas de CDN (Supabase e as de PDF do WhatsApp): guarda em cache pra a página não esperar a internet
  // a cada troca de tela. Só ela — o resto dos CDNs e a nuvem seguem direto.
  const ehLibPdf = url.hostname === "cdnjs.cloudflare.com" &&
    (url.pathname.indexOf("/html2canvas/") !== -1 || url.pathname.indexOf("/jspdf/") !== -1);
  if (req.method === "GET" && ((url.hostname === "cdn.jsdelivr.net" && url.pathname.indexOf("/npm/@supabase/supabase-js") === 0) || ehLibPdf)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        const network = fetch(req).then(function (response) {
          if (response && (response.ok || response.type === "opaque")) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  // o resto: só GET e só do mesmo site (nunca intercepta Supabase/nuvem)
  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      const network = fetch(req).then(function (response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return response;
      }).catch(function () { return cached; });

      // stale-while-revalidate: mostra o que já tem em cache na hora
      // (rápido, funciona offline) e atualiza o cache em segundo plano
      return cached || network;
    })
  );
});

// ---- avisos (web push): licitações novas ----
self.addEventListener("push", function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "GSJ", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "GSJ Marcenaria";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: data.tag || "gsj",
    renotify: true,
    data: { url: data.url || "./licitacoes.html" }
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const alvo = new URL((event.notification.data && event.notification.data.url) || "./licitacoes.html", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      for (const c of lista) {
        if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
          if ("navigate" in c) { c.navigate(alvo); }
          return c.focus();
        }
      }
      return self.clients.openWindow(alvo);
    })
  );
});

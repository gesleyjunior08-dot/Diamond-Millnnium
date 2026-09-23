// Service Worker do app Diamond Millennium.
// Só cuida da "casca" do app (o arquivo app.html, o manifest e os ícones)
// pra abrir rápido e instalar como app de verdade. NÃO mexe em nada que
// venha do Supabase — cada aba continua sempre buscando dado novo na
// hora, isso aqui só deixa a abertura do app mais rápida/instalável.

const CACHE_NOME = 'diamond-app-shell-v1';
const ARQUIVOS_DA_CASCA = [
  './app.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NOME).then((cache) => cache.addAll(ARQUIVOS_DA_CASCA))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes.filter((n) => n !== CACHE_NOME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Só intercepta pedidos da casca do app (mesmo domínio, arquivos
  // listados acima). Tudo mais (Supabase, as telas de dentro de cada
  // aba, etc.) passa direto pra rede, sem cache nenhum — evita mostrar
  // dado velho de presença/equipe por engano.
  const ehArquivoDaCasca = ARQUIVOS_DA_CASCA.some((a) =>
    url.pathname.endsWith(a.replace('./', '/'))
  );
  if (!ehArquivoDaCasca) return;

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          caches.open(CACHE_NOME).then((cache) => cache.put(event.request, respostaRede.clone()));
          return respostaRede;
        })
        .catch(() => respostaCache);
      // Mostra o que já tem em cache na hora (abertura rápida/offline),
      // e atualiza o cache em segundo plano pra próxima vez.
      return respostaCache || buscaRede;
    })
  );
});

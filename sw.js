// Lưu sẵn khung app để mở nhanh khi mạng yếu. Không bao giờ đụng vào yêu cầu gửi tới máy chủ.
const VERSION = 'a-v38';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'mock.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'bg-welcome.webp', 'logo-mark.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ---------- thông báo đẩy ----------
// Tín hiệu từ máy chủ không kèm nội dung: hỏi máy chủ hộp tin của máy này (mã bí mật do app lưu trong IndexedDB) rồi hiện.
const idbGet = k => new Promise(res => {
  try {
    const r = indexedDB.open('a-drafts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('d');
    r.onsuccess = () => {
      try {
        const q = r.result.transaction('d', 'readonly').objectStore('d').get(k);
        q.onsuccess = () => res(q.result); q.onerror = () => res(null);
      } catch (e) { res(null); }
    };
    r.onerror = () => res(null);
  } catch (e) { res(null); }
});
async function showPush() {
  let list = [];
  try {
    const cfg = await idbGet('push');
    if (cfg && cfg.api && cfg.secret) {
      const r = await fetch(cfg.api, { method: 'POST', body: JSON.stringify({ action: 'pushInbox', dev: cfg.secret }) });
      const j = await r.json();
      if (j && j.ok && Array.isArray(j.data)) list = j.data;
    }
  } catch (e) { /* mất mạng: hiện tin chung */ }
  if (!list.length) list = [{ t: '(á) đội hình', b: 'Có tin mới. Chạm để mở app.' }];
  await Promise.all(list.slice(-4).map(m => self.registration.showNotification(m.t, {
    body: m.b || '', tag: m.k || undefined, renotify: !!m.k, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { at: m.at || Date.now() }
  })));
}
self.addEventListener('push', e => { e.waitUntil(showPush()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});

// Mạng trước, mất mạng thì dùng bản đã lưu (để bản mới luôn được nhận ngay khi có mạng).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // cache: 'no-cache' = luôn hỏi lại GitHub (file chưa đổi thì chỉ nhận trả lời ngắn), không dùng bản cũ trình duyệt giữ 10 phút
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});

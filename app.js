/* (á) đội hình — giao diện nhập liệu. Không lưu PIN trên máy; nháp báo cáo lưu trong IndexedDB. */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const MOCK = !CFG.API_URL;
  const IDLE_MS = 10 * 60 * 1000;
  const NO_ZALO = []; // ảnh chỉ lưu Drive, không gửi vào nhóm Zalo

  const S = { name: null, pin: null, info: null, offset: 0 };
  const $app = document.getElementById('app');

  // ---------- tiện ích ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const pad = n => String(n).padStart(2, '0');
  const now = () => new Date(Date.now() + S.offset);
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const money = n => (n < 0 ? '−' : '') + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
  const firstName = n => String(n).trim().split(/\s+/).pop();

  let toastTimer;
  function toast(msg, bad) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', text: msg });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), bad ? 5000 : 2500);
  }

  async function api(action, payload = {}, auth = true) {
    const body = Object.assign({ action }, payload);
    if (auth) { body.name = S.name; body.pin = S.pin; }
    let res;
    try {
      if (MOCK) res = await window.MOCK_API(body);
      else {
        const r = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) });
        res = await r.json();
      }
    } catch (e) {
      throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Có lỗi, thử lại');
    return res.data;
  }

  // ---------- logic dùng chung (bản sao của server/Logic.js, chỉ để xem trước) ----------
  function parseMoney(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).toLowerCase().replace(/vnđ|vnd|đ|đồng|dong/g, '').replace(/\s+/g, '');
    if (!s) return null;
    let m = s.match(/^(\d+)(?:[.,](\d+))?(tr|triệu|trieu|m)(\d{0,3})$/);
    if (m) {
      if (m[2] && m[4]) return null;
      let v = parseInt(m[1], 10) * 1e6;
      if (m[2]) v += Math.round(parseFloat('0.' + m[2]) * 1e6);
      if (m[4]) v += parseInt(m[4], 10) * Math.pow(10, 6 - m[4].length);
      return v;
    }
    m = s.match(/^(\d+)(?:[.,](\d+))?(k|n|ng|nghìn|nghin|ngàn|ngan)$/);
    if (m) return Math.round(parseFloat(m[1] + '.' + (m[2] || '0')) * 1000);
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return parseInt(s.replace(/[.,]/g, ''), 10);
    if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 0 && n < 1000 ? n * 1000 : n; }
    return null;
  }
  // lệch có chiều: âm = thiếu, dương = thừa
  // nhấn số liệu trong câu: giờ, tiền, thời lượng, số lần → đậm; thiếu / thừa / chưa giải trình → đỏ cam; khớp → xanh
  const EM_RE = /((?:thiếu|thừa) \d{1,3}(?:\.\d{3})*đ|\(?(?:còn [^()]*?)?chưa giải trình\)?|khớp|\d{1,2}:\d{2}(?:\s?[–-]\s?\d{1,2}:\d{2})?|\d{1,3}(?:\.\d{3})+đ|\d+đ|\d+ giờ(?: \d+ phút)?|\d+ phút|\d+h(?:\d{2})?(?:–\d+h(?:\d{2})?)?|\d+ (?:lần|buổi|ngày))/g;
  function em(text) {
    const out = []; let last = 0; text = String(text == null ? '' : text);
    text.replace(EM_RE, (m, _g, i) => {
      if (i > last) out.push(text.slice(last, i));
      const tone = /chưa giải trình/.test(m) || (/^(thiếu|thừa)/.test(m) && !/^ \(đã giải trình\)/.test(text.slice(i + m.length))) ? ' warn' : m === 'khớp' ? ' ok' : '';
      out.push(h('b', { class: 'num' + tone, text: m }));
      last = i + m.length; return m;
    });
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  const diffText = n => (!n ? 'khớp' : (n < 0 ? 'thiếu ' : 'thừa ') + money(Math.abs(n)));
  const hmToMin = s => { const p = String(s).split(':'); return +p[0] * 60 + +(p[1] || 0); };
  function shiftNameNow() {
    const c = S.info.cfg, m = now().getHours() * 60 + now().getMinutes();
    return m < hmToMin(c.aft) ? 'sáng' : m < hmToMin(c.eve) ? 'chiều' : 'tối';
  }

  // ---------- nháp (IndexedDB) ----------
  const DB = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('a-drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('d');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      try {
        const db = await open();
        return await new Promise((res, rej) => {
          const t = db.transaction('d', mode);
          const req = fn(t.objectStore('d'));
          t.oncomplete = () => res(req && req.result);
          t.onerror = () => rej(t.error);
        });
      } catch (e) { return undefined; }
    };
    return {
      get: k => tx('readonly', s => s.get(k)),
      set: (k, v) => tx('readwrite', s => s.put(v, k)),
      del: k => tx('readwrite', s => s.delete(k)),
    };
  })();
  const draftKey = form => S.name + '|' + form + '|' + new Date().toDateString();

  // ---------- ảnh ----------
  function loadImg(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); res(img); };
      img.onerror = () => rej(new Error('Không đọc được ảnh'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function compress(file, label, max) {
    const img = await loadImg(file);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), ht = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = ht;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, ht);
    const d = now();
    const text = `(á) · ${label} · ${S.name} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm(d)}`;
    const fs = Math.max(13, Math.round(w / 36));
    ctx.font = `${fs}px -apple-system, Helvetica, Arial, sans-serif`;
    const p = Math.round(fs * 0.55);
    const tw = Math.min(w, ctx.measureText(text).width + p * 2);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, ht - fs - p * 2, tw, fs + p * 2);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p, ht - p - fs / 2, w - p * 2);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
    if (!blob) throw new Error('Không nén được ảnh');
    return new File([blob], `${label.replace(/[^\p{L}\p{N}]+/gu, '-')}.jpg`, { type: 'image/jpeg' });
  }

  const toB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  async function upload(file, label) {
    return (await api('uploadPhoto', { label, data: await toB64(file) })).id;
  }

  /** Ô chụp ảnh. store[key] = {id, file}. onChange gọi sau mỗi lần đổi trạng thái. */
  function photoSlot(store, key, label, opts = {}) {
    const input = h('input', { type: 'file', accept: 'image/*', capture: opts.selfie ? 'user' : 'environment', 'aria-label': 'Chụp ảnh ' + label });
    const lbl = h('span', { class: 'lbl', text: label });
    const st = h('span', { class: 'st', hidden: true });
    const el = h('label', { class: 'slot' + (opts.required ? ' req' : '') + (opts.wide ? ' wide' : '') }, lbl, st, input);
    const show = (file) => {
      el.querySelectorAll('img').forEach(i => i.remove());
      if (file) { el.prepend(h('img', { src: URL.createObjectURL(file), alt: '' })); el.classList.add('has'); }
    };
    const setSt = (txt, cls) => { st.hidden = !txt; st.textContent = txt || ''; st.className = 'st' + (cls ? ' ' + cls : ''); };
    async function doUpload(file) {
      setSt('Đang tải…');
      store[key] = { file, id: null, label };
      opts.onChange && opts.onChange();
      try {
        const id = await upload(file, label);
        if (store[key] && store[key].file === file) {
          store[key].id = id;
          setSt('Đã tải', 'ok');
        }
      } catch (e) {
        setSt('Lỗi · chạm ảnh để chụp lại', 'bad');
        toast(e.message, true);
      }
      opts.onChange && opts.onChange();
    }
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      try {
        const small = await compress(f, label, opts.selfie ? 640 : 1080);
        show(small);
        await doUpload(small);
      } catch (e) { toast(e.message, true); }
    });
    if (store[key] && store[key].file) {
      show(store[key].file);
      setSt(store[key].id ? 'đã tải' : 'chưa tải · chạm để chụp lại', store[key].id ? 'ok' : 'bad');
    }
    el.trigger = () => input.click();
    return el;
  }

  // ---------- khung ----------
  let idleTimer;
  function bumpIdle() {
    clearTimeout(idleTimer);
    if (S.pin) idleTimer = setTimeout(() => { logout(); toast('Đã tự đăng xuất sau 10 phút không dùng'); }, IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

  // chuyển trang: vào màn con trượt từ phải, quay về trượt sang phải (cùng đường), cùng màn thì mờ chéo nhẹ
  let navDir = 'fwd';
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const titleOf = root => { if (!root.querySelector) return ''; const t = root.querySelector('h2.title'); return t ? t.textContent : root.querySelector('.brand:not(.small)') ? '(á)' : ''; };
  function render(...nodes) {
    const kids = nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false);
    const before = titleOf($app), had = $app.childElementCount > 0;
    const probe = document.createElement('div'); probe.append(...kids.map(k => typeof k === 'string' ? document.createTextNode(k) : k));
    const after = titleOf(probe);
    const dir = !had ? 'none' : before && before === after ? 'same' : navDir;
    navDir = 'fwd';
    const swap = () => { $app.replaceChildren(...probe.childNodes); window.scrollTo(0, 0); };
    if (dir === 'none') return swap();
    const reduced = reduceMotion && reduceMotion.matches;
    document.documentElement.dataset.nav = reduced ? 'same' : dir;
    if (document.visibilityState !== 'visible') return swap(); // tab ẩn: không chạy hoạt ảnh
    if (document.startViewTransition) {
      try { document.startViewTransition(swap); return; } catch (e) { /* trình duyệt cũ: làm bên dưới */ }
    }
    swap();
    if (!$app.animate) return;
    const x = reduced || dir === 'same' ? 0 : dir === 'back' ? -28 : 28;
    $app.animate([{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }],
      { duration: dir === 'same' ? 160 : 300, easing: 'cubic-bezier(.32,.72,0,1)' });
  }
  const brand = (small) => h('header', { class: 'brand' + (small ? ' small' : '') },
    h('div', { class: 'mark', text: '(á)' }), h('h1', { text: 'Đội hình bạn pha trà' }));
  // chỉ 5 biểu tượng nét mảnh: tiếp, quay lại, xong, xoá, thêm
  const ICO = { next: 'M9 5l7 7-7 7', back: 'M15 5l-7 7 7 7', check: 'M5 12.5l4.5 4.5L19 7.5', close: 'M6 6l12 12M18 6L6 18', add: 'M12 5v14M5 12h14' };
  const ico = n => {
    const NS = 'http://www.w3.org/2000/svg', v = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('class', 'ico'); v.setAttribute('aria-hidden', 'true');
    p.setAttribute('d', ICO[n]); v.append(p); return v;
  };
  const back = () => h('button', { class: 'back', onclick: () => viewHome() }, ico('back'), 'Trang chính');
  const spinner = txt => h('p', { class: 'sub' }, h('span', { class: 'spin' }), txt);

  function logout() {
    memo.clear();
    S.name = S.pin = S.info = null;
    clearTimeout(idleTimer);
    viewLogin();
  }

  async function refreshInfo() {
    const info = await api('login');
    S.info = info;
    S.offset = info.serverNow - Date.now();
    return info;
  }

  // ---------- đăng nhập ----------
  // Danh sách tên lưu sẵn trên máy (không có PIN) để mở app là chọn được ngay; vẫn tải bản mới ở nền.
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } }
  };
  // Dữ liệu tải lần trước (trong ngày, theo từng người): hiện ngay, tải bản mới ở nền rồi thay vào.
  const memo = {
    key: k => 'c:' + S.name + ':' + k,
    get(k, maxAgeMs) {
      const c = store.get(memo.key(k));
      return c && Date.now() - c.at < maxAgeMs && new Date(c.at).toDateString() === new Date().toDateString() ? c.v : null;
    },
    set(k, v) { store.set(memo.key(k), { at: Date.now(), v }); },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith('c:')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* bỏ qua */ } }
  };
  const inflight = {};
  // cùng một yêu cầu đang chạy thì dùng chung, không gọi máy chủ lần hai
  function fresh(action, payload, k) {
    if (!inflight[k]) inflight[k] = api(action, payload).then(v => { memo.set(k, v); return v; }).finally(() => { delete inflight[k]; });
    return inflight[k];
  }
  const prefetchWeek = () => { if (!memo.get('week0', 10 * 60e3) && !inflight.week0) fresh('week', { week: 0 }, 'week0').catch(() => {}); };
  let loginToken = 0;
  // màn chào: lời chào theo giờ + 1 câu động lực (tab CaiDat cột S:T) + nút Đăng nhập. Không hiện tên nhân viên.
  const QUOTE_FALLBACK = [{ text: 'Ichi-go ichi-e: mỗi lần gặp gỡ chỉ có một lần. Hãy pha từng ly như thể đó là ly duy nhất khách được uống.', by: 'Trà đạo Nhật Bản' }];
  const greeting = () => {
    const hr = now().getHours();
    return hr >= 4 && hr < 11 ? 'Chào buổi sáng' : hr < 13 ? 'Chào buổi trưa' : hr < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  };
  const deviceId = () => {
    let id = store.get('a-dev');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^\w-]/g, ''); store.set('a-dev', id); }
    return id;
  };
  function viewLogin() {
    navDir = 'back';
    const token = ++loginToken;
    // bản cũ lưu danh sách tên trên máy: xoá đi
    try { localStorage.removeItem('a-names'); localStorage.removeItem('a-last'); } catch (e) { /* bỏ qua */ }
    const cached = store.get('a-quotes');
    const pool = cached && cached.length ? cached : QUOTE_FALLBACK;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const quoteText = h('p', { class: 'q-text', text: pick.text });
    const quoteBy = h('p', { class: 'q-by', text: pick.by || '', hidden: !pick.by });
    const bgSaved = store.get('a-bg');
    const bgEl = h('div', { class: 'w-bg', 'aria-hidden': 'true' });
    const setBg = src => { bgEl.style.backgroundImage = 'url("' + String(src).replace(/"/g, '%22') + '")'; };
    setBg(bgSaved && bgSaved.data ? bgSaved.data : 'bg-welcome.webp');
    render(h('div', { class: 'welcome has-bg' }, bgEl, h('div', { class: 'w-shade', 'aria-hidden': 'true' }),
      h('div', { class: 'w-mark', role: 'img', 'aria-label': '(á)' }),
      h('div', { class: 'w-mid' },
        h('h2', { class: 'title', text: greeting() }),
        h('p', { class: 'w-sub', text: 'Đội hình bạn pha trà' }),
        h('blockquote', { class: 'quote' }, quoteText, quoteBy)),
      h('button', { class: 'btn', onclick: () => viewPin() }, 'Đăng nhập')));
    // cập nhật câu mới từ Sheet cho lần mở sau; chưa có câu nào trên máy thì thay luôn
    api('welcome', { have: bgSaved && bgSaved.ver || '' }, false).then(d => {
      // ảnh nền: null = ảnh mặc định; { ver } = máy đã có; { ver, data } = ảnh mới từ Sheet
      if (!(d && d.bg)) { if (bgSaved) { try { localStorage.removeItem('a-bg'); } catch (e) { /* bỏ qua */ } if (token === loginToken) setBg('bg-welcome.webp'); } }
      else if (d.bg.data) { store.set('a-bg', d.bg); if (token === loginToken) setBg(d.bg.data); }
      const qs = (d && d.quotes || []).filter(q => q && q.text);
      store.set('a-quotes', qs);
      if (token === loginToken && !(cached && cached.length) && qs.length) {
        const q = qs[Math.floor(Math.random() * qs.length)];
        quoteText.textContent = q.text; quoteBy.textContent = q.by || ''; quoteBy.hidden = !q.by;
      }
    }).catch(() => { /* mất mạng: giữ câu đang hiện */ });
  }

  // nhập mã định danh (PIN 6 số) → máy chủ tìm đúng người
  function viewPin() {
    loginToken++;
    let pin = '', busy = false;
    const dots = h('div', { class: 'dots', role: 'img', 'aria-label': 'Đã nhập 0 trên 6 số' }, [0, 1, 2, 3, 4, 5].map(() => h('span')));
    const HINT = 'Nhập mã định danh 6 số của bạn';
    const msg = h('p', { class: 'pin-msg', 'aria-live': 'polite' }, HINT);
    const del = h('button', { type: 'button', class: 'del', 'aria-label': 'Xoá số vừa nhập', hidden: true, onclick: () => press('del') }, 'Xoá');
    const paint = () => {
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
      dots.setAttribute('aria-label', `Đã nhập ${pin.length} trên 6 số`);
      del.hidden = !pin.length || busy;
    };
    const setMsg = (text, cls) => { msg.className = 'pin-msg' + (cls ? ' ' + cls : ''); msg.replaceChildren(...[].concat(text)); };
    const fail = (text) => {
      pin = ''; busy = false; paint();
      dots.classList.remove('shake', 'checking'); void dots.offsetWidth; dots.classList.add('shake', 'bad');
      setMsg(text, 'bad');
    };
    async function press(k) {
      if (busy) return;
      if (dots.classList.contains('bad')) { dots.classList.remove('bad', 'shake'); setMsg(HINT); }
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += k;
      paint();
      if (pin.length < 6) return;
      busy = true; paint();
      dots.classList.add('checking');
      setMsg([h('span', { class: 'spin' }), 'Đang kiểm tra…']);
      try {
        const who = await api('pinLogin', { pin, dev: deviceId() }, false);
        S.name = who.name; S.pin = pin;
        if (who.info) { S.info = who.info; S.offset = who.info.serverNow - Date.now(); } // máy chủ mới: có sẵn dữ liệu
        if (S.info && who.summary) { S.info.summary = who.summary; S.info.summaryAt = Date.now(); memo.set('summary', who.summary); }
        else await refreshInfo();
        document.removeEventListener('keydown', onKey);
        bumpIdle();
        viewHome('fwd');
      } catch (e) {
        S.name = S.pin = null;
        fail(e.message);
      }
    }
    // bàn phím rời / máy tính: gõ số, Backspace để xoá
    const onKey = (e) => {
      if (!dots.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    document.addEventListener('keydown', onKey);
    const key = d => h('button', { type: 'button', class: 'k', onclick: () => press(d) }, d);
    render(h('div', { class: 'pinscreen' },
      h('div', { class: 'pin-top' }, h('button', { class: 'back', onclick: () => { document.removeEventListener('keydown', onKey); viewLogin(); } }, ico('back'), 'Quay lại')),
      h('div', { class: 'pin-head' },
        h('h2', { class: 'title', text: 'Đăng nhập' }),
        dots, msg),
      h('div', { class: 'keypad' },
        ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
        h('span', { class: 'blank' }), key('0'), del)));
  }

  // ---------- trang chính ----------
  // ---------- bảng tóm tắt trang chủ ----------
  const WD = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
  const dur = min => { min = Math.max(0, Math.round(min)); const g = Math.floor(min / 60), p = min % 60; return g ? `${g} giờ${p ? ' ' + p + ' phút' : ''}` : `${p} phút`; };
  const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  function dayLabel(ts) {
    const diff = Math.round((day0(ts) - day0(now())) / 86400000);
    const d = new Date(ts);
    if (diff === 0) return 'hôm nay';
    if (diff === 1) return 'ngày mai';
    if (diff === -1) return 'hôm qua';
    return `${WD[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }
  function countdown(ts) {
    const min = Math.round((ts - now().getTime()) / 60000);
    if (min <= 0) return 'đang tới giờ';
    if (min < 60) return `còn ${min} phút`;
    if (min < 48 * 60) return `còn ${dur(min)}`;
    return `còn ${Math.round(min / 1440)} ngày`;
  }

  // bấm vào việc chưa làm → mở đúng trang để làm / báo
  function itemAction(x) {
    if (x.act === 'clock') return viewClock;
    if (x.act === 'opening') return viewOpening;
    if (x.act === 'closing') return viewClosing;
    if (x.act === 'task' && x.id) return () => viewTaskDone(x);
    return null;
  }

  const cap = s => s ? s[0].toLocaleUpperCase('vi') + s.slice(1) : s;
  const chev = () => h('span', { class: 'chev', 'aria-hidden': 'true' });

  // trang chủ 3 cấp: ca hôm nay (khối đen) → việc trong ca (thẻ trắng, việc kế tiếp nổi lên) → ca tới / tháng / cả quán (nhẹ)
  // ---------- thông báo chung (chủ quán viết trong tab CaiDat) ----------
  const noticeKey = n => n.title + '|' + (n.date || '') + '|' + (n.body || '').length;
  const ddmm = ts => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  function noticesBox(list) {
    if (!list || !list.length) return '';
    const seen = store.get('a-seen') || [];
    return [h('div', { class: 'sec sec-top' }, h('span', { text: 'Thông báo' })),
      h('div', { class: 'card' }, h('ul', { class: 'notices' }, list.map((n, k) => h('li', null,
        h('button', { type: 'button', class: 'row', onclick: () => viewNotice(n, k) },
          seen.includes(noticeKey(n)) ? h('span', { class: 'nd' }) : h('span', { class: 'nd on', 'aria-label': 'Chưa đọc' }),
          h('span', { class: 'txt' }, h('span', { class: 'nt', text: n.title }), n.date ? h('small', { text: ddmm(n.date) }) : ''),
          chev())))))];
  }
  async function viewNotice(n, k) {
    const key = noticeKey(n);
    store.set('a-seen', (store.get('a-seen') || []).filter(x => x !== key).concat(key).slice(-60));
    const img = h('div', { class: 'n-img' });
    render(back(), n.date ? h('p', { class: 'date', text: ddmm(n.date) }) : '', h('h2', { class: 'title', text: n.title }),
      n.body ? h('div', { class: 'n-body', text: n.body }) : '', img);
    if (!n.img) return;
    img.replaceChildren(spinner('Đang tải ảnh…'));
    try {
      const d = await api('noticeImg', { i: k, t: n.title });
      if (img.isConnected) img.replaceChildren(h('img', { src: d.data, alt: 'Ảnh kèm thông báo' }));
    } catch (e) {
      if (img.isConnected) img.replaceChildren(h('p', { class: 'alert bad', text: e.message }));
    }
  }

  function summaryPanel(sm) {
    if (!sm) return h('div', { class: 'summary' }, h('div', { class: 'hero' }, h('div', { class: 'lab' }, h('span', { class: 'spin' }), 'Đang tải ca hôm nay…')));
    const t = sm.today, b = t.block, mo = sm.month;
    const parts = [...[].concat(noticesBox(sm.notices))].filter(Boolean);
    const sec = (title, right) => h('div', { class: 'sec' }, h('span', { text: title }), right ? h('small', { text: right }) : '');

    // cấp 1 · ca hôm nay
    let stat = null;
    const st = (cls, text, right) => h('div', { class: 'stat' }, h('span', { class: 'dot ' + cls }), h('span', null, em(text)), right ? h('span', { class: 'r' }, em(right)) : '');
    if (t.clock.state === 'in') stat = st('ok', `Đang trong ca từ ${hm(new Date(t.clock.since))}`, dur(t.workedMin));
    else if (t.clock.state === 'late' && b) stat = st('warn', 'Chưa chấm vào', `Ca bắt đầu ${b.startHM}`);
    else if (b && b.start > now().getTime()) stat = st('idle', cap(countdown(b.start)) + ' tới giờ ca');
    else if (t.workedMin) stat = st('idle', `Đã làm hôm nay: ${dur(t.workedMin)}`);
    parts.push(h('div', { class: 'hero' },
      h('div', { class: 'lab' }, h('span', { text: 'Ca hôm nay' }), S.info && S.info.role ? h('span', { class: 'role', text: cap(S.info.role) }) : ''),
      h('div', { class: 'time', text: b ? `${b.startHM} – ${b.endHM}` : 'Bạn nghỉ' }),
      b && b.keeper ? h('div', { class: 'keeper', text: 'Bạn là người giữ ca hôm nay' }) : '',
      stat,
      t.mates.length ? h('div', { class: 'mates' }, 'Đang trong ca: ', h('b', { text: t.mates.map(firstName).join(', ') })) : ''));

    // cấp 2 · việc trong ca
    if (t.items.length) {
      const done = t.items.filter(x => x.done).length;
      const open = t.items.filter(x => !x.done), closed = t.items.filter(x => x.done);
      const nextIdx = open.findIndex(x => itemAction(x));
      const next = nextIdx >= 0 ? open[nextIdx] : null;
      const rest = open.filter((x, i) => i !== nextIdx);
      const li = x => {
        const go = !x.done && itemAction(x);
        const body = [h('span', { class: 'm' }, x.done ? ico('check') : h('span', { class: 'ring' })),
          h('span', { class: 'txt' }, h('span', { text: cap(x.text) }), x.note ? h('small', null, em(cap(x.note))) : '')];
        return h('li', { class: x.done ? 'done' : '' }, go ? h('button', { type: 'button', onclick: go }, ...body, chev()) : body);
      };
      parts.push(sec('Việc trong ca', `${done}/${t.items.length} xong`), h('div', { class: 'card tcard' },
        h('div', { class: 'prog' }, h('i', { style: `width:${Math.round(100 * done / t.items.length)}%` })),
        next ? h('button', { type: 'button', class: 'next', onclick: itemAction(next) },
          h('span', { class: 'txt' }, h('span', { class: 'eyebrow', text: 'Làm ngay' }), h('span', { class: 'main', text: cap(next.text) }),
            next.note ? h('small', null, em(cap(next.note))) : ''),
          h('span', { class: 'go', text: 'Làm' })) : '',
        rest.length || closed.length ? h('ul', { class: 'tasks' }, rest.map(li), closed.map(li)) : ''));
    }

    // cấp 3 · ca tiếp theo
    if (sm.next) {
      const n = sm.next;
      parts.push(sec('Ca tiếp theo'), h('div', { class: 'card' },
        h('button', { type: 'button', class: 'row', onclick: () => viewWeek(0) },
          h('span', { class: 'txt' }, h('span', null, `${cap(dayLabel(n.start))} `, h('b', { class: 'num', text: `${n.startHM}–${n.endHM}` })), h('small', null, em(cap(countdown(n.start)) + (n.keeper ? ' · bạn giữ ca' : '')))),
          chev())));
    }

    // cấp 3 · tháng: lưới số, chỉ số xấu mới đỏ cam
    const cell = (n, l, bad) => h('div', null, h('div', { class: 'l', text: l }), h('div', { class: 'n' + (bad ? ' warn' : ''), text: n }));
    parts.push(sec(cap(mo.recap ? `tổng kết ${mo.label}` : mo.label)), h('div', { class: 'card' }, h('div', { class: 'grid' },
      cell(`${mo.days} buổi`, 'Số buổi'),
      cell(dur(mo.minutes), 'Giờ công'),
      cell(mo.late ? `${mo.late} lần · ${mo.lateMin} phút` : 'Không', 'Đi muộn', mo.late),
      cell(mo.early ? `${mo.early} lần · ${mo.earlyMin} phút` : 'Không', 'Về sớm', mo.early),
      cell(mo.forgot ? `${mo.forgot} lần` : 'Không', 'Quên chấm ra', mo.forgot),
      mo.nightMinutes ? cell(dur(mo.nightMinutes), 'Làm sau 23:00') : '',
      mo.pending ? cell(String(mo.pending), 'Đang chờ duyệt', true) : '')));

    return h('div', { class: 'summary' }, ...parts);
  }

  function viewHome(dir) {
    navDir = typeof dir === 'string' ? dir : 'back';
    const i = S.info;
    const c = i.cfg;
    const m = now().getHours() * 60 + now().getMinutes();
    const openWindow = m >= hmToMin(c.openFrom) && m <= hmToMin(c.openTo);
    const item = (label, fn, extra) => h('li', null, h('button', { onclick: fn }, h('span', { class: 'ml' }, label), extra));
    const soon = h('span', { class: 'soon', text: 'Sắp có' });
    if (!i.summary) i.summary = memo.get('summary', 12 * 3600e3);
    const panel = h('div', null, summaryPanel(i.summary));
    const resend = h('div');
    const resendItem = h('li', { hidden: true });
    loadShare().then(rec => {
      if (!rec || !resend.isConnected) return;
      const open = () => viewShare(rec.r, rec.files || [], rec);
      const left = [!rec.sent.text ? 'tin' : '', !rec.sent.photos && (rec.files || []).length ? 'ảnh' : ''].filter(Boolean);
      if (left.length) {
        resend.replaceChildren(h('div', { class: 'alert', style: 'margin-bottom:22px' },
          h('div', { text: `${rec.title} lúc ${hm(new Date(rec.at))} chưa gửi ${left.join(' và ')} vào Zalo.` }),
          h('button', { class: 'btn', style: 'margin-top:10px', onclick: open }, 'Mở lại để gửi')));
      }
      resendItem.hidden = false;
      resendItem.replaceChildren(h('button', { onclick: open }, 'Gửi lại báo cáo gần nhất vào Zalo'));
    });
    // lấy số mới nhất mỗi lần về trang chủ (sau khi chấm công, gửi báo cáo…), không chặn màn hình
    if (i.summaryAt && Date.now() - i.summaryAt < 20000) setTimeout(prefetchWeek, 300);
    else fresh('summary', {}, 'summary').then(sm => {
      i.summary = sm; i.summaryAt = Date.now();
      if (panel.isConnected) panel.replaceChildren(summaryPanel(sm));
      prefetchWeek();
    }).catch(() => {});
    render(
      h('div', { class: 'greet' }, h('p', { class: 'date', text: `${WD[now().getDay()]}, ${pad(now().getDate())}/${pad(now().getMonth() + 1)}` }),
        h('h2', { class: 'title', text: 'Chào ' + firstName(i.name) })),
      resend,
      panel,
      h('ul', { class: 'menu' },
        item('Báo cáo đầu ca', viewOpening, openWindow ? null : h('span', { class: 'soon', text: `Ngoài giờ ${c.openFrom}–${c.openTo}` })),
        item('Chấm công', viewClock),
        item('Báo cáo chốt ca', viewClosing),
        item('Lịch tuần', () => viewWeek(0)),
        resendItem,
        item('Báo phát sinh', () => viewSoon('Báo phát sinh'), soon.cloneNode(true)),
        i.isHead ? item('Duyệt công', viewApprovals, i.pendingApprovals ? h('span', { class: 'count', text: i.pendingApprovals }) : null) : null,
      ),
      h('ul', { class: 'menu' },
        item('Công thức pha chế', () => viewSoon('Công thức pha chế'), soon.cloneNode(true)),
        item('Xử lý tình huống khách hàng', () => viewSoon('Xử lý tình huống khách hàng'), soon.cloneNode(true)),
        item('Tra cứu sự cố', () => viewSoon('Tra cứu sự cố'), soon.cloneNode(true)),
        item('Danh sách liên hệ', () => viewSoon('Danh sách liên hệ'), soon.cloneNode(true)),
      ),
      h('ul', { class: 'menu' },
        item('Đăng xuất', logout)));
  }

  // ---------- lịch tuần ----------
  async function viewWeek(week) {
    const seg = h('div', { class: 'seg', style: 'margin:4px 0 6px' }, ['tuần này', 'tuần sau'].map((t, k) =>
      h('button', { type: 'button', class: k === week ? 'on' : '', onclick: () => k !== week && viewWeek(k) }, t)));
    const body = h('div', null, spinner('Đang tải lịch…'));
    render(back(), h('h2', { class: 'title', text: 'Lịch tuần' }), seg, h('div', { style: 'height:14px' }), body);
    const k = 'week' + week, had = memo.get(k, 12 * 3600e3);
    let first = true;
    const draw = data => { if (body.isConnected) { drawWeek(data, first); first = false; } };
    if (had) draw(had);
    fresh('week', { week }, k).then(d => {
      if (!had || JSON.stringify(d) !== JSON.stringify(had)) draw(d);
      if (week === 0 && !memo.get('week1', 10 * 60e3)) fresh('week', { week: 1 }, 'week1').catch(() => {});
    }).catch(e => {
      if (had || !body.isConnected) return;
      body.replaceChildren(h('p', { class: 'alert bad', text: e.message }), h('button', { class: 'btn', onclick: () => viewWeek(week) }, 'Thử lại'));
    });
    function drawWeek(data, first) {
    const today = day0(now());
    // giờ dạng 8h, 16h30
    const hh = min => Math.floor(min / 60) + 'h' + (min % 60 ? pad(min % 60) : '');
    const periods = data.periods || [{ label: 'sáng', start: 480, end: 780 }, { label: 'chiều', start: 780, end: 1080 }, { label: 'tối', start: 1080, end: 1380 }];
    // Một buổi: ai có mặt, ghi chú "từ 13h" / "tới 16h" khi không làm trọn buổi.
    function periodLine(d, P, k) {
      const first = k === 0, last = k === periods.length - 1;
      const lo = first ? 0 : P.start, hi = last ? 1440 : P.end;
      const groups = new Map();
      d.people.forEach(p => {
        const mins = p.blocks.map(b => [(b.start - d.ts) / 60000, (b.end - d.ts) / 60000]).filter(([a, z]) => a < hi && z > lo);
        if (!mins.length) return;
        let a = Math.min(...mins.map(x => x[0])), z = Math.max(...mins.map(x => x[1]));
        if (!first) a = Math.max(a, P.start);
        if (!last) z = Math.min(z, P.end);
        const from = a !== P.start && (a > P.start || first), to = z !== P.end && (z < P.end || last);
        const note = from && to ? `${hh(a)}–${hh(z)}` : from ? 'từ ' + hh(a) : to ? 'tới ' + hh(z) : '';
        if (!groups.has(note)) groups.set(note, []);
        groups.get(note).push(p);
      });
      if (!groups.size) return null;
      const order = [...groups.keys()].sort((x, y) => (x === '' ? -1 : y === '' ? 1 : 0));
      const parts = [];
      order.forEach((note, i) => {
        if (i) parts.push(h('span', { class: 'sep', text: ' · ' }));
        groups.get(note).forEach((p, j) => {
          if (j) parts.push(', ');
          parts.push(p.me ? h('strong', { class: 'me', text: 'bạn' }) : firstName(p.name));
        });
        if (note) parts.push(h('span', { class: 'note', text: ' ' + note }));
      });
      return h('li', null, h('span', { class: 'p', text: P.label }), h('span', { class: 'who' }, parts));
    }
    let todayCard = null;
    const cards = data.days.map(d => {
      const mine = (d.people.find(p => p.me) || {}).blocks || [];
      const dt = new Date(d.ts);
      const isToday = day0(d.ts) === today, past = day0(d.ts) < today;
      const lines = periods.map((P, k) => periodLine(d, P, k)).filter(Boolean);
      const mineTxt = mine.map(b => `${hh((b.start - d.ts) / 60000)}–${hh((b.end - d.ts) / 60000)}`).join(' và ');
      const card = h('div', { class: 'sbox day' + (isToday ? ' today' : '') + (past ? ' past' : '') },
        h('div', { class: 'stitle' }, `${WD[dt.getDay()]} · ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}`, isToday ? h('span', { class: 'scount', text: 'Hôm nay' }) : ''),
        h('div', { class: 'mine' + (mine.length ? '' : ' off') }, mine.length ? ['Bạn làm ', h('b', { class: 'num', text: mineTxt })] : 'Bạn nghỉ'),
        lines.length ? h('ul', { class: 'shifts' }, lines) : h('p', { class: 'hint', text: 'Chưa xếp lịch' }));
      if (isToday) todayCard = card;
      return card;
    });
    body.replaceChildren(h('div', { class: 'summary days' }, cards));
    if (first && todayCard && todayCard !== cards[0]) todayCard.scrollIntoView({ block: 'start' });
    }
  }

  function viewSoon(title) {
    render(back(), h('h2', { class: 'title', text: title }), h('p', { class: 'sub', text: 'Mục này sẽ có ở bước sau.' }));
  }

  // ---------- chấm công ----------
  function getLocation() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      const t = setTimeout(() => res(null), 12000);
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
        () => { clearTimeout(t); res(null); },
        { enableHighAccuracy: true, timeout: 11000, maximumAge: 0 });
    });
  }

  function viewClock() {
    const type = S.info.openSince ? 'out' : 'in';
    const verb = type === 'in' ? 'Chấm vào' : 'Chấm ra';
    const locP = getLocation(); // xin vị trí ngay khi mở màn hình
    const store = {};
    const status = h('p', { class: 'sub' });
    let sending = false;
    const slot = photoSlot(store, 'selfie', 'selfie ' + verb.toLowerCase(), { selfie: true, wide: true, required: true, onChange: () => {
      const s = store.selfie;
      btn.disabled = !(s && s.id) || sending;
    } });
    const btn = h('button', { class: 'btn', disabled: true, onclick: async () => {
      sending = true; btn.disabled = true;
      btn.replaceChildren(h('span', { class: 'spin' }), 'đang lấy vị trí và gửi…');
      try {
        const loc = await locP;
        const r = await api('clock', { type, selfieId: store.selfie.id, loc });
        await refreshInfo().catch(() => {});
        viewClockDone(r);
      } catch (e) {
        toast(e.message, true);
        sending = false; btn.disabled = false; btn.textContent = verb;
      }
    } }, verb);
    status.textContent = type === 'in' ? 'Chụp selfie rồi bấm chấm vào. Giờ lấy từ máy chủ.'
      : `Đang trong ca từ ${hm(new Date(S.info.openSince))}. Chụp selfie rồi bấm chấm ra.`;
    render(back(), h('h2', { class: 'title', text: 'Chấm công' }), status,
      h('div', { class: 'photos' }, slot), btn,
      h('p', { class: 'hint', text: 'Nếu điện thoại hỏi quyền vị trí, chọn Cho phép. Không cho phép vẫn chấm được, head-barista sẽ xem lại.' }));
  }

  function viewClockDone(r) {
    const t = new Date(r.time);
    render(back(),
      h('div', { class: 'big-ok', text: 'Đã gửi' }),
      h('h2', { class: 'title', text: `${r.type === 'in' ? 'Vào ca' : 'Ra ca'} lúc ${hm(t)}` }),
      r.flags.length
        ? h('div', { class: 'alert' }, h('div', { text: 'Lượt này được ghi chú để head-barista xem lại:' }),
          h('ul', null, r.flags.map(f => h('li', { text: f }))))
        : h('p', { class: 'hint ok', text: 'Mọi thứ đều khớp.' }),
      h('button', { class: 'btn', onclick: viewHome }, 'Về trang chính'));
  }

  // ---------- bàn giao (dùng chung đầu ca / chốt ca) ----------
  // Việc được bàn giao: chụp ảnh kết quả = xong; hoặc bấm "không làm" + ghi lý do (giao sai / không làm được) = đóng việc kèm giải trình.
  function taskList(tasks, store, onChange) {
    if (!tasks.length) return h('p', { class: 'hint', text: 'Không có việc nào giao cho bạn.' });
    return h('div', null, tasks.map(t => {
      const sk = store['skip:' + t.id] || (store['skip:' + t.id] = { on: false, reason: '' });
      const body = h('div');
      const toggle = h('button', { class: 'linkbtn more', type: 'button' });
      const draw = () => {
        toggle.textContent = sk.on ? 'Quay lại, mình sẽ làm việc này' : 'Không làm việc này (giao sai / không làm được)';
        if (sk.on) {
          const ta = h('textarea', { placeholder: 'Ghi lý do, ví dụ: trân châu còn đủ, không cần nấu', value: sk.reason });
          ta.addEventListener('input', () => { sk.reason = ta.value; onChange(); });
          body.replaceChildren(h('label', { class: 'f', text: 'Lý do không làm (bắt buộc)' }), ta);
        } else {
          body.replaceChildren(h('div', { class: 'photos', style: 'margin-top:10px' },
            photoSlot(store, 'task:' + t.id, 'việc: ' + t.text.slice(0, 40), { onChange })));
        }
      };
      toggle.addEventListener('click', () => { sk.on = !sk.on; draw(); onChange(); });
      draw();
      const toTxt = t.to && t.to.length ? ' · cho ' + t.to.map(firstName).join(', ') : ' · cho cả ca sau';
      return h('div', { class: 'card' },
        h('div', { text: t.text }),
        h('div', { class: 'meta' }, em(`${firstName(t.from)} giao${t.at ? ' lúc ' + hm(new Date(t.at)) : ''}${toTxt}`)),
        body, toggle);
    }));
  }
  const toText = t => t.to && t.to.length ? 'cho ' + t.to.map(firstName).join(', ') : 'cho cả ca sau';
  const taskInfo = tasks => h('ul', { class: 'checks info' }, tasks.map(t => h('li', null,
    h('span', { class: 'mark' }),
    h('span', { class: 'txt' }, t.text, h('small', null, em(`${firstName(t.from)} giao${t.at ? ' lúc ' + hm(new Date(t.at)) : ''} · ${toText(t)}`))))));
  const skipOf = (store, t) => { const sk = store['skip:' + t.id]; return sk && sk.on ? sk : null; };
  const completedTasks = (tasks, store) => tasks.map(t => {
    const sk = skipOf(store, t);
    if (sk) return sk.reason.trim().length >= 5 ? { id: t.id, skip: sk.reason.trim() } : null;
    return store['task:' + t.id] && store['task:' + t.id].id ? { id: t.id, photoId: store['task:' + t.id].id } : null;
  }).filter(Boolean);
  const skipLacking = (tasks, store) => tasks.filter(t => { const sk = skipOf(store, t); return sk && sk.reason.trim().length < 5; })
    .map(t => 'lý do không làm: ' + t.text.slice(0, 30));

  // Việc đã báo xong giữa ca: nhớ trên máy (kèm ảnh) để chốt ca tự gộp vào tin + ảnh Zalo.
  const doneKey = () => 'taskdone:' + S.name;
  async function loadDone() {
    const l = (await DB.get(doneKey())) || [];
    return l.filter(x => Date.now() - x.at < 14 * 3600e3);
  }
  async function rememberDone(x) {
    const l = (await loadDone()).filter(y => y.id !== x.id);
    l.push(x);
    await DB.set(doneKey(), l);
  }

  function viewTaskDone(t) {
    const store = {};
    const missing = h('p', { class: 'missing' });
    const submit = h('button', { class: 'btn', onclick: async () => {
      const d = completedTasks([t], store)[0];
      if (!d) return;
      submit.disabled = true;
      submit.replaceChildren(h('span', { class: 'spin' }), 'đang gửi…');
      try {
        await api('completeTask', d);
        const ph = store['task:' + t.id];
        await rememberDone({ id: t.id, text: t.text, skip: d.skip || '', file: !d.skip && ph ? ph.file : null, at: Date.now() });
        S.info.pendingTasks = Math.max(0, (S.info.pendingTasks || 0) - 1);
        toast(d.skip ? 'Đã ghi: không làm việc này' : 'Đã báo xong. Ảnh sẽ tự vào báo cáo chốt ca.');
        viewHome();
      } catch (e) { toast(e.message, true); submit.textContent = 'Báo đã xong'; check(); }
    } }, 'Báo đã xong');
    const check = () => {
      const ok = completedTasks([t], store).length > 0;
      const up = Object.values(store).some(p => p && p.file && !p.id);
      submit.disabled = !ok || up;
      missing.textContent = up ? 'đang tải ảnh…' : ok ? '' : skipLacking([t], store).length
        ? 'ghi lý do không làm (ít nhất vài chữ)' : 'chụp ảnh kết quả, hoặc bấm "không làm việc này" và ghi lý do';
    };
    render(back(), h('h2', { class: 'title', text: 'Báo việc đã làm' }),
      h('p', { class: 'sub', text: 'Báo xong ở đây thì lúc chốt ca việc này và ảnh tự vào báo cáo, không cần báo lại.' }),
      taskList([t], store, check), missing, submit);
    check();
  }

  // ---------- báo cáo đầu ca ----------
  async function viewOpening() {
    render(back(), h('h2', { class: 'title', text: 'Báo cáo đầu ca' }), spinner('Đang tải…'));
    let tasks = [];
    try { tasks = await api('tasks'); } catch (e) { toast(e.message, true); }
    const areas = S.info.cfg.areas;
    const key = draftKey('dau-ca');
    const saved = (await DB.get(key)) || {};
    const store = saved.photos || {};
    const note = h('textarea', { placeholder: 'Ghi chú (không bắt buộc)', value: saved.note || '' });
    const missing = h('p', { class: 'missing' });
    const save = () => DB.set(key, { photos: store, note: note.value });
    const check = () => {
      const lack = areas.filter(a => !(store[a] && store[a].id)).map(a => 'ảnh ' + a);
      const uploading = Object.values(store).some(p => p.file && !p.id);
      missing.textContent = lack.length ? `còn thiếu ${lack.length} mục: ${lack.join(', ')}` : uploading ? 'đang tải ảnh…' : '';
      submit.disabled = lack.length > 0 || uploading;
      save();
    };
    note.addEventListener('input', save);
    const submit = h('button', { class: 'btn', onclick: async () => {
      submit.disabled = true;
      submit.replaceChildren(h('span', { class: 'spin' }), 'đang gửi…');
      try {
        const photos = Object.fromEntries(areas.map(a => [a, store[a].id]));
        const r = await api('submitOpening', { photos, completed: [], note: note.value });
        const files = areas.filter(a => store[a] && store[a].file).map(a => store[a].file);
        await DB.del(key);
        await saveShare(r, files, 'báo cáo đầu ca');
        viewShare(r, files);
      } catch (e) { toast(e.message, true); submit.textContent = 'Gửi báo cáo'; check(); }
    } }, 'Gửi báo cáo');
    render(back(), h('h2', { class: 'title', text: 'Báo cáo đầu ca' }),
      h('p', { class: 'sub', text: 'Chụp trực tiếp 7 khu vực sau khi mở quầy.' }),
      tasks.length ? [h('h3', { text: 'Ca trước bàn giao' }), taskInfo(tasks),
        h('p', { class: 'hint', text: 'Chỉ để biết, không cần làm ngay. Làm xong thì bấm vào việc đó ở trang chủ (việc trong ca) để báo.' })] : null,
      h('h3', { text: 'Ảnh khu vực' }),
      h('div', { class: 'photos' }, areas.map(a => photoSlot(store, a, a, { required: true, onChange: check }))),
      h('h3', { text: 'Ghi chú' }), note,
      missing, submit);
    check();
  }

  // ---------- báo cáo chốt ca ----------
  async function viewClosing() {
    render(back(), h('h2', { class: 'title', text: 'Báo cáo chốt ca' }), spinner('Đang tải…'));
    let tasks = [];
    try { tasks = await api('tasks'); } catch (e) { toast(e.message, true); }
    const earlier = await loadDone();
    const c = S.info.cfg;
    const shift = shiftNameNow();
    const evening = shift === 'tối';
    const items = c.stock.filter(s => s.scope === 'cả hai' || (evening ? s.scope === 'tối' : s.scope === 'ngày'));
    const key = draftKey('chot-ca');
    const saved = (await DB.get(key)) || {};
    const F = Object.assign({ money: {}, explains: [], reason: '', stock: {}, others: [], handover: [{ text: '', to: [] }], incident: '', note: '' }, saved.F || {});
    const store = saved.photos || {};
    delete store['két tiền']; delete store['lịch sử ngân hàng']; // bản nháp từ bản cũ
    const save = () => DB.set(key, { F, photos: store });

    // tiền
    const moneyField = (k, label, opt) => {
      const inp = h('input', { type: 'text', inputmode: 'numeric', class: 'money', autocomplete: 'off',
        placeholder: opt ? 'Không bắt buộc' : '0', value: F.money[k] !== undefined && F.money[k] !== '' ? money(F.money[k]).replace('đ', '') : '' });
      inp.addEventListener('input', () => {
        const digits = inp.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        F.money[k] = digits === '' ? '' : Number(digits);
        inp.value = digits === '' ? '' : money(Number(digits)).replace('đ', '');
        update();
      });
      return [h('label', { class: 'f', text: label }), inp];
    };

    const cashBox = h('div', { class: 'cash' });
    const reasonWrap = h('div');
    const reason = h('textarea', { placeholder: 'Ví dụ: chưa rõ, đang xem lại camera', value: F.reason });
    reason.addEventListener('input', () => { F.reason = reason.value; update(); });

    // giải trình: nằm ngay trong ô lệch của từng loại tiền (TM / CK)
    // chiều mặc định của dòng giải trình mới: theo chiều đang lệch của loại tiền đó
    const curDir = kind => {
      const m = F.money;
      const d = kind === 'CK' ? (m.bank || 0) - (m.ipBank || 0) : (m.cash || 0) - (m.opening || 0) - (m.ipCash || 0);
      return d > 0 ? 'thừa' : 'thiếu';
    };
    function exRow(e) {
      if (!e.dir) e.dir = curDir(e.kind);
      const segBtns = (list, get, set) => {
        const box = h('div', { class: 'seg' }, list.map(k => h('button', { type: 'button', class: get() === k ? 'on' : '',
          onclick: () => { set(k); [...box.children].forEach(b => b.classList.toggle('on', b.textContent === k)); paint(); update(); } }, k)));
        return box;
      };
      const dirSeg = segBtns(['thiếu', 'thừa'], () => e.dir, k => { e.dir = k; });
      const amt = h('input', { type: 'text', placeholder: '50k', value: e.raw, autocomplete: 'off' });
      const prev = h('div', { class: 'hint' });
      const rsn = h('input', { type: 'text', placeholder: 'Lý do, ví dụ: khách ship chưa chuyển khoản', value: e.reason, autocomplete: 'off' });
      const unk = h('button', { type: 'button', class: 'chip' + (e.unknown ? ' on' : ''), onclick: () => {
        e.unknown = !e.unknown; unk.classList.toggle('on', e.unknown); rsn.disabled = e.unknown;
        rsn.value = e.unknown ? 'chưa rõ nguyên nhân' : e.reason; update();
      } }, 'Chưa rõ nguyên nhân');
      if (e.unknown) { rsn.disabled = true; rsn.value = 'chưa rõ nguyên nhân'; }
      const paint = () => {
        const v = parseMoney(amt.value);
        amt.classList.toggle('invalid', !!amt.value.trim() && v === null);
        prev.textContent = !amt.value.trim() ? '' : v === null ? 'không hiểu số này'
          : `= ${e.kind === 'CK' ? 'chuyển khoản' : 'tiền mặt'} ${e.dir} ${money(v)}`;
        prev.className = 'hint' + (v === null && amt.value.trim() ? ' bad' : e.dir === 'thiếu' ? ' minus' : ' plus');
      };
      amt.addEventListener('input', () => { e.raw = amt.value; paint(); update(); });
      rsn.addEventListener('input', () => { e.reason = rsn.value; update(); });
      paint();
      const row = h('div', { class: 'exrow' },
        h('div', { class: 'row' }, dirSeg, h('div', { class: 'grow' }, amt),
          h('button', { class: 'x', type: 'button', 'aria-label': 'xoá dòng', onclick: () => { F.explains.splice(F.explains.indexOf(e), 1); drawEx(); update(); } }, ico('close'))),
        prev, h('div', { style: 'margin-top:6px' }, rsn), h('div', { class: 'chips', style: 'margin-top:6px' }, unk));
      row.focusAmount = () => amt.focus();
      row.focusReason = () => rsn.focus();
      return row;
    }

    // mỗi loại tiền một ô cố định; chỉ phần số được vẽ lại khi gõ, ô nhập giải trình giữ nguyên
    const mkBlock = (kind, label) => {
      const b = { kind, label, sum: h('div'), rows: h('div', { class: 'exrows' }), rest: h('div') };
      b.add = h('button', { class: 'add exadd', type: 'button', onclick: () => {
        const cc = cashCalc();
        const left = cc ? (kind === 'CK' ? cc.uB : cc.uC) : 0;
        const e = { kind, dir: left > 0 ? 'thừa' : 'thiếu', raw: left ? money(Math.abs(left)).replace('đ', '') : '', reason: '', unknown: false };
        F.explains.push(e); drawEx(); update();
        const el = b.rows.lastElementChild;
        if (el) (e.raw ? el.focusReason : el.focusAmount)();
      } });
      b.el = h('div', { class: 'cblock' }, b.sum, b.rows, b.add, b.rest);
      return b;
    };
    const blockC = mkBlock('TM', 'Tiền mặt trong két'), blockB = mkBlock('CK', 'Chuyển khoản');
    const cashHint = h('div', { class: 'hint' }), cashWarn = h('div');
    function drawEx() {
      [blockC, blockB].forEach(b => b.rows.replaceChildren(...F.explains.filter(e => (e.kind === 'CK') === (b.kind === 'CK')).map(exRow)));
    }
    cashBox.append(cashHint, blockC.el, blockB.el, cashWarn);

    function cashCalc() {
      const m = F.money;
      const filled = ['ipCash', 'ipBank', 'opening', 'cash', 'bank'].every(k => m[k] !== undefined && m[k] !== '');
      if (!filled) return null;
      let exC = 0, exB = 0, unkC = 0, unkB = 0, bad = false;
      F.explains.forEach(e => {
        if (!String(e.raw || '').trim()) return;
        const v = parseMoney(e.raw);
        if (v === null) { bad = true; return; }
        const sv = (e.dir === 'thừa' ? 1 : -1) * v;
        if (e.kind === 'CK') exB += sv; else exC += sv;
        if (e.unknown) { if (e.kind === 'CK') unkB += sv; else unkC += sv; }
      });
      // két phải có = đầu ca + tiền mặt iPOS
      const dC = m.cash - m.opening - m.ipCash, dB = m.bank - m.ipBank;
      const uC = dC - exC, uB = dB - exB;
      const note = c.th.note;
      // phần "chưa rõ nguyên nhân" (hoặc chưa khai) dùng cho cảnh báo
      const kC = uC + unkC, kB = uB + unkB;
      const misKey = Math.abs(kC) > note && Math.abs(kB) > note && (kC > 0) !== (kB > 0) && Math.abs(kC + kB) <= note;
      return { dC, dB, exC, exB, uC, uB, bad, misKey, needReason: false, over: kC < -c.th.alert };
    }

    // tồn
    // chọn đơn vị ml / g cho từng món
    const unitSeg = (get, set) => {
      const box = h('div', { class: 'seg useg' }, ['ml', 'g'].map(u => h('button', { type: 'button', class: get() === u ? 'on' : '', onclick: () => {
        set(u); box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === u)); save();
      } }, u)));
      return box;
    };
    const stockWrap = h('div', null, items.map(it => {
      const st = F.stock[it.name] = F.stock[it.name] || { left: '', refill: '', on: false };
      // gõ tay số ml, chỉ nhận chữ số
      const refUnit = h('span', { class: 'unit', text: st.unit || 'ml' });
      const ml = v => String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      const inp = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: st.left, 'aria-label': 'còn lại ' + it.name + ' (ml)' });
      inp.addEventListener('input', () => { st.left = ml(inp.value); inp.value = st.left; update(); });
      const row = h('div', { class: 'stock' },
        h('div', { class: 'name', text: it.name }),
        h('div', { class: 'mlbox' }, inp, unitSeg(() => st.unit || 'ml', u => { st.unit = u; refUnit.textContent = u; })));
      if (evening) {
        const rin = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Lượng đã bổ sung', autocomplete: 'off', value: st.refill, style: 'max-width:180px' });
        rin.addEventListener('input', () => { st.refill = ml(rin.value); rin.value = st.refill; save(); });
        const box = h('div', { class: 'refill', hidden: !st.on }, rin, refUnit);
        const chip = h('button', { type: 'button', class: 'chip' + (st.on ? ' on' : ''), onclick: () => {
          st.on = !st.on; chip.classList.toggle('on', st.on); box.hidden = !st.on; if (!st.on) { st.refill = ''; rin.value = ''; } save();
        } }, 'Đã làm mới');
        row.append(chip, box);
      }
      return row;
    }));

    // ca tối: kiểm nguyên liệu chi tiết, chia theo nhóm (chủ quán sửa danh sách ở CaiDat cột O:Q)
    const evItems = evening ? (c.evening || []) : [];
    F.evening = F.evening || {};
    F.evUnit = F.evUnit || {};
    const evWrap = h('div');
    if (evItems.length) {
      const groups = [...new Set(evItems.map(it => it.group))];
      groups.forEach(g => {
        evWrap.append(h('div', { class: 'evgroup', text: g }));
        evItems.filter(it => it.group === g).forEach(it => {
          if (F.evening[it.name] === undefined) F.evening[it.name] = '';
          const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: F.evening[it.name], 'aria-label': it.name });
          inp.addEventListener('input', () => {
            let v = inp.value.replace(',', '.').replace(/[^\d.]/g, '');
            const k = v.indexOf('.');
            if (k >= 0) v = v.slice(0, k + 1) + v.slice(k + 1).replace(/\./g, '');
            F.evening[it.name] = v; inp.value = v; update();
          });
          evWrap.append(h('div', { class: 'stock' }, h('div', { class: 'name', text: it.name }),
            h('div', { class: 'mlbox' }, inp, unitSeg(() => F.evUnit[it.name] || (it.unit === 'g' ? 'g' : 'ml'), u => { F.evUnit[it.name] = u; }))));
        });
      });
    }

    // việc khác (tự điền) và giao ca sau
    const othersWrap = h('div');
    function drawOthers() {
      othersWrap.replaceChildren(...F.others.map((o, idx) => {
        o.k = o.k || 'other:' + Date.now() + ':' + idx;
        const inp = h('input', { type: 'text', placeholder: 'Việc đã làm', value: o.text });
        inp.addEventListener('input', () => { o.text = inp.value; save(); });
        return h('div', { class: 'card' },
          h('div', { class: 'row' }, h('div', { class: 'grow' }, inp),
            h('button', { class: 'x', type: 'button', 'aria-label': 'xoá', onclick: () => { delete store[o.k]; F.others.splice(F.others.indexOf(o), 1); drawOthers(); update(); } }, ico('close'))),
          h('div', { class: 'photos', style: 'margin-top:10px' }, photoSlot(store, o.k, 'việc khác (ảnh không bắt buộc)', { onChange: update })));
      }));
    }
    const handWrap = h('div');
    const staffNames = S.info.staff || [];
    function drawHand() {
      handWrap.replaceChildren(...F.handover.map(t => {
        const inp = h('input', { type: 'text', placeholder: 'Ví dụ: nấu 2 nồi trân châu', value: t.text });
        inp.addEventListener('input', () => { t.text = inp.value; save(); });
        t.to = Array.isArray(t.to) ? t.to.filter(n => staffNames.includes(n)) : [];
        const who = h('div', { class: 'chips' });
        const drawWho = () => who.replaceChildren(
          h('span', { class: 'hint', text: 'Giao cho:' }),
          ...staffNames.filter(n => n !== S.name).map(n => h('button', { type: 'button', class: 'chip' + (t.to.includes(n) ? ' on' : ''),
            'aria-pressed': t.to.includes(n) ? 'true' : 'false',
            onclick: () => { t.to = t.to.includes(n) ? t.to.filter(x => x !== n) : t.to.concat(n); drawWho(); save(); } }, firstName(n))),
          h('span', { class: 'hint', text: t.to.length ? '' : '(chưa chọn ai = ai ca sau cũng làm)' }));
        drawWho();
        return h('div', { class: 'card', style: 'margin:8px 0' },
          h('div', { class: 'row' }, h('div', { class: 'grow' }, inp),
            h('button', { class: 'x', type: 'button', 'aria-label': 'xoá', onclick: () => { F.handover.splice(F.handover.indexOf(t), 1); drawHand(); save(); } }, ico('close'))),
          who);
      }));
    }

    const incident = h('textarea', { placeholder: 'Không có thì để trống', value: F.incident });
    incident.addEventListener('input', () => { F.incident = incident.value; save(); });
    const note = h('textarea', { placeholder: 'Không bắt buộc', value: F.note });
    note.addEventListener('input', () => { F.note = note.value; save(); });

    const moneyPhotos = ['phiếu chốt ca iPOS'];
    const missing = h('div', { class: 'missing' });
    const submit = h('button', { class: 'btn', onclick: send }, 'Gửi báo cáo');

    function lacking() {
      const out = [];
      const m = F.money;
      const ml = { ipRevenue: 'doanh thu iPOS', ipCash: 'tiền mặt iPOS', ipBank: 'chuyển khoản iPOS', opening: 'tiền mặt đầu ca', cash: 'tiền mặt đếm', bank: 'chuyển khoản ngân hàng' };
      Object.entries(ml).forEach(([k, l]) => { if (m[k] === undefined || m[k] === '') out.push(l); });
      const cc = cashCalc();
      if (cc && cc.bad) out.push('giải trình có số tiền không hiểu');
      if (F.explains.some(e => String(e.raw || '').trim() && !e.unknown && !String(e.reason || '').trim())) out.push('lý do của giải trình');
      if (cc && cc.uC) out.push('giải trình tiền mặt (còn ' + diffText(cc.uC) + ')');
      if (cc && cc.uB) out.push('giải trình chuyển khoản (còn ' + diffText(cc.uB) + ')');
      moneyPhotos.concat(c.areas).forEach(a => { if (!(store[a] && store[a].id)) out.push('ảnh ' + a); });
      items.forEach(it => { if (F.stock[it.name].left === '') out.push('tồn ' + it.name); });
      evItems.forEach(it => { if (!String(F.evening[it.name] || '').length || F.evening[it.name] === '.') out.push(it.name); });
      return out.concat(skipLacking(tasks, store));
    }

    function update() {
      const cc = cashCalc();
      cashHint.textContent = cc ? '' : 'Điền đủ các ô tiền mặt (kể cả đầu ca) và chuyển khoản để xem chênh lệch.';
      blockC.el.hidden = blockB.el.hidden = !cc;
      if (cc) {
        const m = F.money;
        const paintBlock = (b, d, ex, u, detail) => {
          const has = b.rows.children.length > 0;
          b.sum.replaceChildren(
            h('div', { class: 'cline' }, h('span', { text: b.label }),
              h('strong', { class: !d ? 'ok' : d < 0 ? 'minus' : 'plus', text: !d ? 'khớp' : diffText(d) })),
            h('div', { class: 'hint' }, em(detail)));
          // chỉ hiện chỗ giải trình khi đang lệch (hoặc đã có dòng giải trình)
          b.rows.hidden = !d && !has;
          b.add.hidden = !u;
          b.add.replaceChildren(ico('add'), has ? 'Thêm lý do khác' : `Giải trình khoản ${d < 0 ? 'thiếu' : 'thừa'} này`);
          b.rest.replaceChildren(...(d || has ? [
            ex ? h('div', { class: 'hint' }, 'Đã giải trình ', h('b', { class: 'num', text: money(Math.abs(ex)) })) : '',
            h('div', { class: u ? 'warn' : 'ok' }, u ? ['Còn ', h('b', { text: diffText(u) }), ' chưa giải trình · phải khớp mới gửi được'] : 'Đã khớp')] : []));
        };
        paintBlock(blockC, cc.dC, cc.exC, cc.uC,
          `đầu ca ${money(m.opening)} + iPOS ${money(m.ipCash)} = phải có ${money(m.opening + m.ipCash)} · đếm được ${money(m.cash)}`);
        paintBlock(blockB, cc.dB, cc.exB, cc.uB, `Ngân hàng ${money(m.bank)} · iPOS ${money(m.ipBank)}`);
      }
      cashWarn.replaceChildren(
        cc && cc.misKey ? h('div', { class: 'warn', text: 'Có thể bấm nhầm tiền mặt / chuyển khoản trên iPOS.' }) : '',
        cc && cc.over ? h('div', { class: 'bad', text: 'Lệch quá ' + money(c.th.alert) + ': nhắn riêng head-barista hoặc chủ quán ngay.' }) : '');
      const need = cc && cc.needReason;
      reasonWrap.replaceChildren(...(need ? [h('label', { class: 'f', text: 'Lý do lệch (bắt buộc vì vẫn lệch quá ' + money(c.th.note) + ')' }), reason] : []));
      const lack = lacking();
      const uploading = Object.values(store).some(p => p.file && !p.id);
      missing.replaceChildren(...(lack.length ? [h('div', { text: `Còn thiếu ${lack.length} mục:` }), h('div', { text: lack.join(' · ') })] : uploading ? ['đang tải ảnh…'] : []));
      submit.disabled = lack.length > 0 || uploading;
      save();
    }

    async function send() {
      submit.disabled = true;
      submit.replaceChildren(h('span', { class: 'spin' }), 'đang gửi…');
      try {
        const photos = {};
        moneyPhotos.concat(['phiếu chi'], c.areas).forEach(a => { if (store[a] && store[a].id) photos[a] = store[a].id; });
        const payload = {
          money: F.money,
          explains: F.explains.filter(e => String(e.raw || '').trim()).map(e => ({ kind: e.kind, dir: e.dir, raw: e.raw, reason: e.reason, unknown: !!e.unknown })),
          reason: F.reason,
          photos,
          eveningUnits: Object.fromEntries(evItems.map(it => [it.name, F.evUnit[it.name] || (it.unit === 'g' ? 'g' : 'ml')])),
          stock: Object.fromEntries(items.map(it => [it.name, { unit: F.stock[it.name].unit || 'ml', left: F.stock[it.name].left, refill: evening && F.stock[it.name].on ? F.stock[it.name].refill : '' }])),
          evening: Object.fromEntries(evItems.map(it => [it.name, F.evening[it.name]])),
          completed: completedTasks(tasks, store),
          others: F.others.filter(o => o.text.trim()).map(o => ({ text: o.text, photoId: store[o.k] && store[o.k].id })),
          handover: F.handover.filter(t => t.text.trim()).map(t => ({ text: t.text, to: t.to || [] })),
          incident: F.incident, note: F.note,
        };
        const r = await api('submitClosing', payload);
        const files = Object.entries(store).filter(([k, v]) => v.id && v.file && !NO_ZALO.includes(k)).map(([, v]) => v.file)
          .concat(earlier.filter(x => x.file).map(x => x.file));
        await DB.del(key);
        await DB.del(doneKey());
        S.info.pendingTasks = Math.max(0, S.info.pendingTasks - payload.completed.length);
        await saveShare(r, files, 'báo cáo chốt ca');
        viewShare(r, files);
      } catch (e) {
        toast(e.message, true);
        submit.textContent = 'Gửi báo cáo';
        update();
      }
    }

    render(back(), h('h2', { class: 'title', text: 'Báo cáo chốt ca' }),
      h('p', { class: 'sub', text: `Ca ${shift} · ${hm(now())}${saved.F ? ' · đã khôi phục bản nháp' : ''}` }),
      h('h3', { text: 'Tiền theo iPOS' }),
      moneyField('ipRevenue', 'Tổng doanh thu'), moneyField('ipCash', 'Tiền mặt'), moneyField('ipBank', 'Chuyển khoản'),
      h('h3', { text: 'Tiền thực tế' }),
      moneyField('opening', 'Tiền mặt đầu ca (tiền lẻ có sẵn trong két lúc nhận ca)'),
      moneyField('cash', 'Tiền mặt đếm trong két lúc chốt (tổng)'),
      moneyField('bank', 'Chuyển khoản đã về (xem app ngân hàng)'),
      cashBox,
      reasonWrap,
      moneyField('tip', 'Tip tiền mặt (để riêng)', true),
      h('h3', { text: 'Ảnh phiếu' }),
      h('div', { class: 'photos' },
        photoSlot(store, 'phiếu chốt ca iPOS', 'phiếu chốt ca iPOS', { required: true, onChange: update }),
        photoSlot(store, 'phiếu chi', 'phiếu chi (nếu có)', { onChange: update })),
      h('h3', { text: 'Ảnh khu vực' }),
      h('div', { class: 'photos' }, c.areas.map(a => photoSlot(store, a, a, { required: true, onChange: update }))),
      h('h3', { text: 'Tồn nhanh' + (evening ? ' · ca tối' : '') }),
      h('p', { class: 'hint', text: 'Gõ lượng còn lại của từng món, chọn đơn vị ml hoặc g bên cạnh. Cách đo: nhìn vạch thể tích trên bình / chai đang đựng nguyên liệu (ví dụ chai 1 lít còn khoảng nửa thì ghi 500 ml).' }),
      stockWrap,
      evItems.length ? [h('h3', { text: 'Kiểm nguyên liệu ca tối' }),
        h('p', { class: 'hint', text: 'Chỉ ca tối. Cân hoặc nhìn vạch rồi gõ lượng còn lại của từng loại, chọn ml hoặc g bên cạnh (số lẻ dùng dấu chấm, ví dụ 12.5).' }),
        evWrap] : null,
      h('h3', { text: 'Việc được bàn giao' }),
      earlier.map(x => h('div', { class: 'card donecard' },
        x.file ? h('img', { src: URL.createObjectURL(x.file), alt: '' }) : null,
        h('div', null, h('div', { text: x.text }),
          h('div', { class: 'meta' }, em(`Đã báo lúc ${hm(new Date(x.at))}${x.skip ? ' · không làm: ' + x.skip : ' · ảnh tự gửi kèm'}`))))),
      tasks.length || !earlier.length ? taskList(tasks, store, update) : null,
      h('h3', { text: 'Việc khác đã làm' }), othersWrap,
      h('button', { class: 'add', type: 'button', onclick: () => { F.others.push({ text: '' }); drawOthers(); save(); } }, ico('add'), 'Thêm việc khác'),
      h('h3', { text: 'Giao việc cho ca sau' }), handWrap,
      h('button', { class: 'add', type: 'button', onclick: () => { F.handover.push({ text: '', to: [] }); drawHand(); save(); } }, ico('add'), 'Thêm việc'),
      h('h3', { text: 'Sự cố' }), incident,
      h('h3', { text: 'Ghi chú' }), note,
      missing, submit);
    drawEx(); drawOthers(); drawHand(); update();
  }

  // ---------- gửi Zalo (2 bước, đã thử trên iPhone) ----------
  // Bản gửi Zalo gần nhất: thoát app giữa chừng vẫn mở lại được để gửi nốt tin / ảnh.
  const shareKey = () => 'share:' + S.name;
  async function saveShare(r, files, title) {
    await DB.set(shareKey(), { r: { zaloText: r.zaloText, alert: !!r.alert }, files, title, at: Date.now(), sent: { text: false, photos: false } });
  }
  async function loadShare() {
    const rec = await DB.get(shareKey());
    if (!rec || Date.now() - rec.at > 24 * 3600e3) return null;
    return rec;
  }
  async function markShare(part) {
    const rec = await DB.get(shareKey());
    if (rec) { rec.sent[part] = true; await DB.set(shareKey(), rec); }
  }

  // Gửi vào Zalo 2 bước. Trên iPhone chọn Zalo thường chuyển hẳn sang app Zalo nên không biết được "đã gửi xong":
  // vì vậy nút ảnh luôn bấm được, không chờ bước 1.
  function viewShare(r, files, again) {
    const canShare = !!navigator.share;
    const shareFiles = async (list, btn, doneText) => {
      if (!canShare) { toast('Máy này không chia sẻ ảnh được. Mở app bằng Safari trên iPhone.', true); return false; }
      const data = { files: list };
      if (navigator.canShare && !navigator.canShare(data)) throw new Error('máy không hỗ trợ chia sẻ nhóm ảnh này');
      const p = navigator.share(data);
      btn.classList.add('done'); btn.textContent = doneText; // bảng chia sẻ đã mở
      if (list === files) markShare('photos');
      try { await p; } catch (e) { if (e.name === 'AbortError') { btn.classList.remove('done'); btn.textContent = btn.dataset.label; } throw e; }
      return true;
    };
    // gửi cả loạt bị lỗi → chia thành từng đợt 5 ảnh
    const batches = h('div');
    function showBatches() {
      const size = 5, groups = [];
      for (let i = 0; i < files.length; i += size) groups.push(files.slice(i, i + size));
      batches.replaceChildren(h('p', { class: 'hint', text: 'Gửi lần lượt từng đợt ảnh:' }),
        ...groups.map((g, k) => {
          const label = `ảnh ${k * size + 1}–${k * size + g.length}`;
          const b = h('button', { class: 'btn ghost', 'data-label': label }, label);
          b.addEventListener('click', () => {
            const p = shareFiles(g, b, label + ' · đã mở');
            if ([...batches.querySelectorAll('button')].every(x => x.classList.contains('done'))) markShare('photos');
            p.catch(e => { if (e.name !== 'AbortError') toast('Không gửi được: ' + e.message, true); });
          });
          return b;
        }));
    }
    const b2Label = `2. Gửi ${files.length} ảnh vào Zalo`;
    const b2 = h('button', { class: 'btn', disabled: !files.length, 'data-label': b2Label }, b2Label);
    b2.addEventListener('click', async () => {
      try { await shareFiles(files, b2, '2. Đã mở chia sẻ ảnh'); }
      catch (e) {
        if (e.name === 'AbortError') return;
        toast('Gửi cả loạt không được, thử gửi từng đợt bên dưới.', true);
        showBatches();
      }
    });
    const b1Label = '1. Gửi tin vào Zalo';
    const b1 = h('button', { class: 'btn', 'data-label': b1Label }, b1Label);
    b1.addEventListener('click', async () => {
      if (!canShare) {
        try { await navigator.clipboard.writeText(r.zaloText); toast('Đã chép tin. Dán vào Zalo.'); } catch (e) { toast('Hãy chép tin ở trên', true); }
        b1.classList.add('done');
        return;
      }
      const p = navigator.share({ text: r.zaloText });
      b1.classList.add('done'); b1.textContent = '1. Đã mở chia sẻ tin';
      markShare('text');
      try { await p; } catch (e) {
        if (e.name === 'AbortError') { b1.classList.remove('done'); b1.textContent = b1Label; }
        else toast('Không mở được chia sẻ: ' + e.message, true);
      }
    });
    render(
      again ? h('h2', { class: 'title', text: 'Gửi lại vào Zalo' }) : h('div', { class: 'big-ok', text: 'Đã gửi' }),
      h('p', { class: 'sub', text: again
        ? `${again.title} lúc ${hm(new Date(again.at))} đã lưu trên Sheet. Gửi nốt phần còn thiếu vào nhóm á daily report.`
        : 'Báo cáo đã lưu. Giờ gửi vào nhóm á daily report.' }),
      r.alert ? h('div', { class: 'alert bad', text: 'Két lệch lớn: nhắn riêng head-barista hoặc chủ quán ngay.' }) : null,
      h('pre', { class: 'msg', text: r.zaloText }),
      b1, b2, batches,
      h('p', { class: 'hint', text: 'Gửi tin trước, quay lại app này rồi bấm gửi ảnh. Chọn đúng nhóm ở cả hai bước.' }),
      h('button', { class: 'btn ghost', onclick: viewHome }, 'Xong, về trang chính'));
  }

  // ---------- duyệt công ----------
  // Ô chọn giờ: 2 danh sách giờ / phút (iPhone không tự điền giờ hiện tại như ô time).
  function timePick(init) {
    const opt = (n, lab) => h('option', { value: n }, lab);
    const hs = h('select', { 'aria-label': 'giờ' }, opt('', '--'), [...Array(24)].map((_, i) => opt(pad(i), pad(i))));
    const ms = h('select', { 'aria-label': 'phút' }, opt('', '--'), [...Array(60)].map((_, i) => opt(pad(i), pad(i))));
    const el = h('div', { class: 'tsel' }, hs, h('span', { text: ':' }), ms);
    el.set = v => { const [a, b] = (v || ':').split(':'); hs.value = a || ''; ms.value = b || (a ? '00' : ''); el.dispatchEvent(new Event('change', { bubbles: true })); };
    el.get = () => hs.value ? hs.value + ':' + (ms.value || '00') : '';
    hs.addEventListener('change', () => { if (hs.value && !ms.value) ms.value = '00'; });
    el.set(init);
    return el;
  }

  async function viewApprovals() {
    render(back(), h('h2', { class: 'title', text: 'Duyệt công' }), spinner('Đang tải…'));
    let list;
    try { list = await api('approvals'); } catch (e) { render(back(), h('p', { class: 'alert bad', text: e.message })); return; }
    S.info.pendingApprovals = list.length;
    const mins = v => v ? hmToMin(v) : null;
    const card = it => {
      const tIn = it.inTime ? hm(new Date(it.inTime)) : '', tOut = it.outTime ? hm(new Date(it.outTime)) : '';
      const plan = it.plan || [];
      const el = h('div', { class: 'card' });
      const img = (b64, alt) => b64 ? h('img', { src: 'data:image/jpeg;base64,' + b64, alt }) : h('img', { alt: 'không có ảnh' });

      // gợi ý: khối ca chứa giờ vào → giờ ra = hết ca đó (chỉ khi sau giờ vào)
      const inM = mins(tIn), outM = mins(tOut);
      const blk = plan.map(b => ({ ...b, s: hmToMin(b.startHM), e: hmToMin(b.endHM) }));
      const mine = inM !== null ? blk.find(b => inM >= b.s - 120 && inM < b.e)
        : outM !== null ? blk.reduce((x, b) => !x || Math.abs(b.e - outM) < Math.abs(x.e - outM) ? b : x, null) : blk[0];
      const pIn = timePick(tIn || (mine ? mine.startHM : ''));
      const pOut = timePick(tOut || (mine && (inM === null || mine.e > inM) ? mine.endHM : ''));
      const preview = h('div', { class: 'hint' });
      const reason = h('input', { type: 'text', placeholder: 'Ví dụ: quên chấm ra, xác nhận qua camera', autocomplete: 'off' });
      const save = h('button', { class: 'btn' }, 'Lưu giờ đã sửa');
      const calc = () => {
        const a = mins(pIn.get()), b = mins(pOut.get());
        if (a === null || b === null) { preview.className = 'warn'; preview.textContent = 'Chọn đủ giờ vào và giờ ra'; save.disabled = true; return; }
        const next = b <= a, w = (next ? b + 1440 : b) - a;
        const long = w > 12 * 60;
        preview.className = long ? 'warn' : 'ok';
        preview.textContent = `Làm ${dur(w)}${next ? ' (ra hôm sau)' : ''}${long ? ' · quá 12 giờ, xem lại giờ ra' : ''}`;
        save.disabled = false;
      };
      [pIn, pOut].forEach(p => p.addEventListener('change', calc));
      const chips = plan.length ? h('div', { class: 'chips' },
        h('span', { class: 'hint', text: 'Theo lịch:' }),
        blk.map(b => h('button', { type: 'button', class: 'chip', onclick: () => {
          if (!pIn.get() || !tIn) pIn.set(b.startHM);
          pOut.set(b.endHM); calc();
        } }, `${b.startHM}–${b.endHM}`))) : h('div', { class: 'hint', text: 'Không có lịch ca ngày này' });
      save.addEventListener('click', async () => {
        save.disabled = true;
        try { await api('approve', { id: it.id, op: 'edit', inTime: pIn.get(), outTime: pOut.get(), reason: reason.value }); done('đã sửa'); }
        catch (e) { toast(e.message, true); save.disabled = false; }
      });
      const missingTime = !it.inTime || !it.outTime;
      const form = h('div', { class: 'aform', hidden: !missingTime },
        h('div', { class: 'trow' }, h('span', { class: 'tl', text: 'Giờ vào' }), pIn),
        h('div', { class: 'trow' }, h('span', { class: 'tl', text: 'Giờ ra' }), pOut),
        chips, preview,
        h('label', { class: 'f', text: 'Lý do sửa (bắt buộc)' }), reason,
        save);
      calc();
      const done = st => { el.replaceChildren(h('div', { class: 'hint ok', text: `${it.name} · ${it.date}: ${st}` })); S.info.pendingApprovals--; };
      el.append(
        h('div', null, h('strong', { text: it.name }), ` · ${it.date} · ca ${it.shift || '—'}`),
        h('div', { class: 'meta' }, em(`Chấm vào ${tIn || '—'} · chấm ra ${tOut || '—'}${plan.length ? ' · lịch ' + plan.map(b => b.startHM + '–' + b.endHM).join(', ') : ''}`)),
        h('div', { class: 'todo', text: it.flags }),
        h('div', { class: 'selfies' }, img(it.selfieIn, 'selfie vào'), img(it.selfieOut, 'selfie ra')),
        missingTime ? h('p', { class: 'hint', text: 'Thiếu giờ chấm, chọn giờ thực tế rồi lưu.' }) : h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'margin:4px 0', onclick: async (ev) => {
            ev.target.disabled = true;
            try { await api('approve', { id: it.id, op: 'approve' }); done('đã duyệt'); }
            catch (e) { toast(e.message, true); ev.target.disabled = false; }
          } }, 'Duyệt'),
          h('button', { class: 'btn ghost', style: 'margin:4px 0', onclick: () => { form.hidden = !form.hidden; } }, 'Sửa giờ')),
        form);
      return el;
    };
    render(back(), h('h2', { class: 'title', text: 'Duyệt công' }),
      h('p', { class: 'sub', text: list.length ? `${list.length} lượt cần xem. Lượt bình thường đã tự duyệt.` : 'Không có lượt nào cần duyệt.' }),
      list.map(card));
  }

  // ---------- khởi động ----------
  if (MOCK) document.body.append(h('div', { class: 'demo', text: 'Bản xem thử · dữ liệu giả' }));
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  viewLogin();
})();

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
      setSt('đang tải…');
      store[key] = { file, id: null, label };
      opts.onChange && opts.onChange();
      try {
        const id = await upload(file, label);
        if (store[key] && store[key].file === file) {
          store[key].id = id;
          setSt('✓', 'ok');
        }
      } catch (e) {
        setSt('lỗi · chạm ảnh để chụp lại', 'bad');
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
      setSt(store[key].id ? '✓' : 'chưa tải · chạm để chụp lại', store[key].id ? 'ok' : 'bad');
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

  function render(...nodes) {
    $app.replaceChildren(...nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false));
    window.scrollTo(0, 0);
  }
  const brand = (small) => h('header', { class: 'brand' + (small ? ' small' : '') },
    h('h1', { text: 'đội hình\nbạn pha trà' }), h('div', { class: 'at', text: 'ở  ( á )' }));
  const back = () => h('button', { class: 'back', onclick: () => viewHome() }, '‹ về trang chính');
  const spinner = txt => h('p', { class: 'sub' }, h('span', { class: 'spin' }), txt);

  function logout() {
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
  let loginToken = 0;
  async function viewLogin() {
    const token = ++loginToken;
    const last = store.get('a-last');
    const draw = (names, loading) => {
      if (token !== loginToken) return;
      const sorted = last && names.includes(last) ? [last, ...names.filter(n => n !== last)] : names;
      render(brand(), h('h3', { text: 'bạn là ai?' }),
        h('div', { class: 'names' }, sorted.map(n => h('button', { class: n === last ? 'last' : '', onclick: () => viewPin(n) }, n))),
        loading ? h('p', { class: 'hint', style: 'margin-top:14px' }, h('span', { class: 'spin' }), 'đang cập nhật danh sách…') : '');
    };
    const cached = store.get('a-names');
    if (cached && cached.length) draw(cached, true);
    else render(brand(), spinner('đang tải danh sách…'));
    let names;
    try { names = await api('staffList', {}, false); } catch (e) {
      if (token !== loginToken) return;
      if (cached && cached.length) { draw(cached, false); return; } // mất mạng: vẫn dùng danh sách cũ
      render(brand(), h('p', { class: 'alert bad', text: e.message }), h('button', { class: 'btn', onclick: viewLogin }, 'Thử lại'));
      return;
    }
    if (token !== loginToken) return;
    store.set('a-names', names);
    if (!names.length) {
      render(brand(), h('p', { class: 'alert', text: 'Chưa có nhân viên nào được đặt PIN. Chủ quán vào Sheet → menu (á) → Đặt PIN.' }));
      return;
    }
    draw(names, false);
  }

  function viewPin(name) {
    loginToken++; // bỏ lượt vẽ lại danh sách tên đang chờ
    let pin = '';
    const dots = h('div', { class: 'dots', 'aria-label': 'PIN' }, [0, 1, 2, 3, 4, 5].map(() => h('span')));
    const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const press = async (k) => {
      if (busy) return;
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += k;
      paint();
      if (pin.length === 6) {
        busy = true;
        S.name = name; S.pin = pin;
        msg.replaceChildren(h('span', { class: 'spin' }), 'đang kiểm tra…');
        try {
          await refreshInfo();
          store.set('a-last', name);
          bumpIdle();
          viewHome();
        } catch (e) {
          S.name = S.pin = null;
          pin = ''; paint();
          msg.textContent = e.message;
          msg.className = 'hint bad';
          busy = false;
        }
      }
    };
    let busy = false;
    const msg = h('p', { class: 'hint', style: 'text-align:center' });
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    render(brand(true),
      h('button', { class: 'back', onclick: viewLogin }, '‹ chọn lại tên'),
      h('h2', { class: 'title', text: firstName(name) }),
      h('p', { class: 'sub', text: 'nhập PIN 6 số' }),
      dots, msg,
      h('div', { class: 'keypad' }, keys.map(k => h('button', {
        class: k ? '' : 'blank', 'aria-label': k === '⌫' ? 'xoá' : k, onclick: () => k && press(k)
      }, k))));
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

  function summaryPanel(sm) {
    if (!sm) return h('div');
    const t = sm.today, b = t.block, mo = sm.month;
    const row = (k, v, cls) => h('div', { class: 'srow' }, h('span', { class: 'k', text: k }), h('span', { class: 'v' + (cls ? ' ' + cls : ''), text: v }));
    const parts = [];

    // ca hôm nay
    const todayBox = [h('div', { class: 'stitle', text: 'ca hôm nay' })];
    if (b) {
      todayBox.push(h('div', { class: 'sbig', text: `${b.codes} · ${b.startHM}–${b.endHM}` }));
      if (t.clock.state === 'in') todayBox.push(h('div', { class: 'ok', text: `● đang trong ca từ ${hm(new Date(t.clock.since))} · ${dur(t.workedMin)}` }));
      else if (t.clock.state === 'late') todayBox.push(h('div', { class: 'warn', text: `⚠ đã tới giờ ca (${b.startHM}) nhưng chưa chấm vào` }));
      else if (b.start > now().getTime()) todayBox.push(h('div', { class: 'hint', text: `bắt đầu ${b.startHM} · ${countdown(b.start)}` }));
      else if (t.workedMin) todayBox.push(h('div', { class: 'hint', text: `đã làm hôm nay: ${dur(t.workedMin)}` }));
    } else {
      todayBox.push(h('div', { class: 'sbig', text: 'hôm nay bạn nghỉ' }));
      if (t.clock.state === 'in') todayBox.push(h('div', { class: 'ok', text: `● đang trong ca từ ${hm(new Date(t.clock.since))} · ${dur(t.workedMin)}` }));
    }
    if (t.mates.length) todayBox.push(h('div', { class: 'hint', text: 'đang trong ca: ' + t.mates.map(firstName).join(', ') }));
    parts.push(h('div', { class: 'sbox' }, ...todayBox));

    // việc trong ca
    if (t.items.length) {
      const done = t.items.filter(x => x.done).length;
      parts.push(h('div', { class: 'sbox' },
        h('div', { class: 'stitle' }, 'việc trong ca', h('span', { class: 'scount', text: `${done}/${t.items.length}` })),
        h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(100 * done / t.items.length)}%` })),
        h('ul', { class: 'checks' }, t.items.map(x => h('li', { class: x.done ? 'done' : '' },
          h('span', { class: 'mark', text: x.done ? '✓' : '○' }),
          h('span', null, x.text, x.note ? h('small', { text: ' · ' + x.note }) : ''))))));
    }

    // ca tiếp theo
    if (sm.next) {
      const n = sm.next;
      parts.push(h('div', { class: 'sbox' },
        h('div', { class: 'stitle', text: 'ca tiếp theo' }),
        h('div', { class: 'sbig', text: `${dayLabel(n.start)} · ${n.codes} ${n.startHM}–${n.endHM}` }),
        h('div', { class: 'hint', text: countdown(n.start) }),
        h('button', { class: 'linkbtn more', onclick: () => viewWeek(0) }, 'xem lịch cả tuần ›')));
    }

    // tháng này / tổng kết tháng trước
    parts.push(h('div', { class: 'sbox' },
      h('div', { class: 'stitle', text: mo.recap ? `tổng kết ${mo.label}` : mo.label }),
      row('số buổi · giờ công', `${mo.days} buổi · ${dur(mo.minutes)}`),
      mo.nightMinutes ? row('sau 23h', dur(mo.nightMinutes)) : '',
      row('đi muộn', mo.late ? `${mo.late} lần · ${mo.lateMin} phút` : 'không', mo.late ? 'warn' : 'ok'),
      row('về sớm', mo.early ? `${mo.early} lần · ${mo.earlyMin} phút` : 'không', mo.early ? 'warn' : 'ok'),
      row('quên chấm ra', mo.forgot ? `${mo.forgot} lần` : 'không', mo.forgot ? 'warn' : 'ok'),
      mo.pending ? row('lượt đang chờ duyệt', String(mo.pending), 'warn') : ''));

    // cả quán hôm nay (head-barista / chủ quán)
    if (sm.team) {
      const tm = sm.team, lc = tm.lastClosing;
      const lech = (label, d, u) => `${label} ${diffText(d)}` +
        (!d ? '' : !u ? ' (đã giải trình)' : u === d ? ' (chưa giải trình)' : ` (còn ${diffText(u)} chưa giải trình)`);
      const lcText = !lc ? 'chưa có' : `ca ${lc.shift} ${dayLabel(lc.at)} ${hm(new Date(lc.at))} · ${firstName(lc.by)} · ` +
        lech('két', lc.diffCash, lc.uCash) + ' · ' + lech('CK', lc.diffBank, lc.uBank);
      parts.push(h('div', { class: 'sbox' },
        h('div', { class: 'stitle', text: 'cả quán hôm nay' }),
        row('báo cáo đầu ca', tm.openingDone ? 'đã có ✓' : 'chưa có', tm.openingDone ? 'ok' : 'warn'),
        row('tới giờ chưa chấm vào', tm.notIn.length ? tm.notIn.map(x => `${firstName(x.name)} (${x.start})`).join(', ') : 'không', tm.notIn.length ? 'warn' : 'ok'),
        h('div', { class: 'hint', style: 'margin-top:6px', text: 'chốt ca gần nhất: ' + lcText })));
    }
    return h('div', { class: 'summary' }, ...parts);
  }

  function viewHome() {
    const i = S.info;
    const c = i.cfg;
    const m = now().getHours() * 60 + now().getMinutes();
    const openWindow = m >= hmToMin(c.openFrom) && m <= hmToMin(c.openTo);
    const item = (label, fn, extra) => h('li', null, h('button', { onclick: fn }, label), extra);
    const soon = h('span', { class: 'soon', text: 'sắp có' });
    const panel = h('div', null, summaryPanel(i.summary));
    // lấy số mới nhất mỗi lần về trang chủ (sau khi chấm công, gửi báo cáo…), không chặn màn hình
    api('summary').then(sm => {
      i.summary = sm;
      if (panel.isConnected) panel.replaceChildren(summaryPanel(sm));
    }).catch(() => {});
    render(brand(),
      h('div', { class: 'greet' }, h('p', null, `chào ${firstName(i.name)} · ${WD[now().getDay()]} ${pad(now().getDate())}/${pad(now().getMonth() + 1)}`)),
      panel,
      h('ul', { class: 'menu' },
        item('chấm công', viewClock),
        openWindow ? item('báo cáo đầu ca', viewOpening) : null,
        item('báo cáo chốt ca', viewClosing),
        item('lịch tuần', () => viewWeek(0)),
        item('báo phát sinh', () => viewSoon('báo phát sinh'), soon.cloneNode(true)),
        i.isHead ? item('duyệt công', viewApprovals, i.pendingApprovals ? h('span', { class: 'count', text: i.pendingApprovals }) : null) : null,
        h('hr'),
        item('công thức pha chế', () => viewSoon('công thức pha chế'), soon.cloneNode(true)),
        item('xử lý tình huống khách hàng', () => viewSoon('xử lý tình huống khách hàng'), soon.cloneNode(true)),
        item('tra cứu sự cố', () => viewSoon('tra cứu sự cố'), soon.cloneNode(true)),
        item('danh sách liên hệ', () => viewSoon('danh sách liên hệ'), soon.cloneNode(true)),
        h('hr'),
        !openWindow ? item('báo cáo đầu ca (ngoài giờ)', viewOpening) : null,
        item('đăng xuất', logout)));
  }

  // ---------- lịch tuần ----------
  async function viewWeek(week) {
    const seg = h('div', { class: 'seg', style: 'margin:4px 0 6px' }, ['tuần này', 'tuần sau'].map((t, k) =>
      h('button', { type: 'button', class: k === week ? 'on' : '', onclick: () => k !== week && viewWeek(k) }, t)));
    const body = h('div', null, spinner('đang tải lịch…'));
    render(back(), h('h2', { class: 'title', text: 'lịch tuần' }), seg,
      h('p', { class: 'hint', style: 'margin:6px 0 18px' }, h('span', { class: 'withdot' }), ' làm cùng giờ với bạn'), body);
    let data;
    try { data = await api('week', { week }); } catch (e) {
      body.replaceChildren(h('p', { class: 'alert bad', text: e.message }), h('button', { class: 'btn', onclick: () => viewWeek(week) }, 'Thử lại'));
      return;
    }
    if (!body.isConnected) return;
    const today = day0(now());
    const span = b => `${b.startHM}–${b.endHM}`;
    let todayCard = null;
    const cards = data.days.map(d => {
      const mine = (d.people.find(p => p.me) || {}).blocks || [];
      const overlaps = p => !p.me && p.blocks.some(b => mine.some(m => b.start < m.end && m.start < b.end));
      const dt = new Date(d.ts);
      const isToday = day0(d.ts) === today, past = day0(d.ts) < today;
      const card = h('div', { class: 'sbox day' + (isToday ? ' today' : '') + (past ? ' past' : '') },
        h('div', { class: 'stitle' }, `${WD[dt.getDay()]} ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}`, isToday ? h('span', { class: 'scount', text: 'hôm nay' }) : ''),
        h('div', { class: 'sbig' + (mine.length ? '' : ' off'), text: mine.length ? 'bạn: ' + mine.map(b => `${b.codes} ${span(b)}`).join(' và ') : 'bạn nghỉ' }),
        d.people.length
          ? h('ul', { class: 'roster' }, d.people.map(p => h('li', { class: (p.me ? 'me' : '') + (overlaps(p) ? ' with' : '') },
              h('span', { class: 't', text: p.blocks.map(span).join(' · ') }),
              h('span', { class: 'n', text: p.me ? 'bạn' : firstName(p.name) }),
              h('span', { class: 'c', text: p.blocks.map(b => b.codes).join(' · ') }))))
          : h('p', { class: 'hint', text: 'chưa xếp lịch' }));
      if (isToday) todayCard = card;
      return card;
    });
    body.replaceChildren(h('div', { class: 'summary' }, cards));
    if (todayCard && todayCard !== cards[0]) todayCard.scrollIntoView({ block: 'start' });
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
    const verb = type === 'in' ? 'chấm vào' : 'chấm ra';
    const locP = getLocation(); // xin vị trí ngay khi mở màn hình
    const store = {};
    const status = h('p', { class: 'sub' });
    let sending = false;
    const slot = photoSlot(store, 'selfie', 'selfie ' + verb, { selfie: true, wide: true, required: true, onChange: () => {
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
    render(back(), h('h2', { class: 'title', text: 'chấm công' }), status,
      h('div', { class: 'photos' }, slot), btn,
      h('p', { class: 'hint', text: 'Nếu điện thoại hỏi quyền vị trí, chọn Cho phép. Không cho phép vẫn chấm được, head-barista sẽ xem lại.' }));
  }

  function viewClockDone(r) {
    const t = new Date(r.time);
    render(back(),
      h('div', { class: 'big-ok', text: 'đã gửi ✓' }),
      h('h2', { class: 'title', text: `${r.type === 'in' ? 'vào ca' : 'ra ca'} lúc ${hm(t)}` }),
      r.flags.length
        ? h('div', { class: 'alert' }, h('div', { text: 'Lượt này được ghi chú để head-barista xem lại:' }),
          h('ul', null, r.flags.map(f => h('li', { text: f }))))
        : h('p', { class: 'hint ok', text: 'Mọi thứ đều khớp.' }),
      h('button', { class: 'btn', onclick: viewHome }, 'về trang chính'));
  }

  // ---------- bàn giao (dùng chung đầu ca / chốt ca) ----------
  function taskList(tasks, store, onChange) {
    if (!tasks.length) return h('p', { class: 'hint', text: 'Không có việc nào được giao.' });
    return h('div', null, tasks.map(t => h('div', { class: 'card' },
      h('div', { text: t.text }),
      h('div', { class: 'meta', text: `${t.from} giao${t.at ? ' lúc ' + hm(new Date(t.at)) : ''} · chụp ảnh kết quả là hoàn thành` }),
      h('div', { class: 'photos', style: 'margin-top:10px' },
        photoSlot(store, 'task:' + t.id, 'việc: ' + t.text.slice(0, 40), { onChange })))));
  }
  const completedTasks = (tasks, store) => tasks
    .filter(t => store['task:' + t.id] && store['task:' + t.id].id)
    .map(t => ({ id: t.id, photoId: store['task:' + t.id].id }));

  // ---------- báo cáo đầu ca ----------
  async function viewOpening() {
    render(back(), h('h2', { class: 'title', text: 'báo cáo đầu ca' }), spinner('đang tải…'));
    let tasks = [];
    try { tasks = await api('tasks'); } catch (e) { toast(e.message, true); }
    const areas = S.info.cfg.areas;
    const key = draftKey('dau-ca');
    const saved = (await DB.get(key)) || {};
    const store = saved.photos || {};
    const note = h('textarea', { placeholder: 'ghi chú (không bắt buộc)', value: saved.note || '' });
    const missing = h('p', { class: 'missing' });
    const save = () => DB.set(key, { photos: store, note: note.value });
    const check = () => {
      const lack = areas.filter(a => !(store[a] && store[a].id));
      const uploading = Object.values(store).some(p => p.file && !p.id);
      missing.textContent = lack.length ? `còn thiếu ${lack.length} ảnh: ${lack.join(', ')}` : uploading ? 'đang tải ảnh…' : '';
      submit.disabled = lack.length > 0 || uploading;
      save();
    };
    note.addEventListener('input', save);
    const submit = h('button', { class: 'btn', onclick: async () => {
      submit.disabled = true;
      submit.replaceChildren(h('span', { class: 'spin' }), 'đang gửi…');
      try {
        const photos = Object.fromEntries(areas.map(a => [a, store[a].id]));
        const r = await api('submitOpening', { photos, completed: completedTasks(tasks, store), note: note.value });
        const files = Object.entries(store).filter(([k, v]) => v.id && (areas.includes(k) || k.startsWith('task:'))).map(([, v]) => v.file);
        await DB.del(key);
        S.info.pendingTasks = Math.max(0, S.info.pendingTasks - completedTasks(tasks, store).length);
        viewShare(r, files);
      } catch (e) { toast(e.message, true); submit.textContent = 'gửi báo cáo'; check(); }
    } }, 'gửi báo cáo');
    render(back(), h('h2', { class: 'title', text: 'báo cáo đầu ca' }),
      h('p', { class: 'sub', text: 'Chụp trực tiếp 7 khu vực sau khi mở quầy.' }),
      h('h3', { text: 'ảnh khu vực' }),
      h('div', { class: 'photos' }, areas.map(a => photoSlot(store, a, a, { required: true, onChange: check }))),
      h('h3', { text: 'việc được bàn giao' }), taskList(tasks, store, check),
      h('h3', { text: 'ghi chú' }), note,
      missing, submit);
    check();
  }

  // ---------- báo cáo chốt ca ----------
  async function viewClosing() {
    render(back(), h('h2', { class: 'title', text: 'báo cáo chốt ca' }), spinner('đang tải…'));
    let tasks = [];
    try { tasks = await api('tasks'); } catch (e) { toast(e.message, true); }
    const c = S.info.cfg;
    const shift = shiftNameNow();
    const evening = shift === 'tối';
    const items = c.stock.filter(s => s.scope === 'cả hai' || (evening ? s.scope === 'tối' : s.scope === 'ngày'));
    const key = draftKey('chot-ca');
    const saved = (await DB.get(key)) || {};
    const F = Object.assign({ money: {}, explains: [], reason: '', stock: {}, others: [], handover: [{ text: '' }], incident: '', note: '' }, saved.F || {});
    const store = saved.photos || {};
    delete store['két tiền']; delete store['lịch sử ngân hàng']; // bản nháp từ bản cũ
    const save = () => DB.set(key, { F, photos: store });

    // tiền
    const moneyField = (k, label, opt) => {
      const inp = h('input', { type: 'text', inputmode: 'numeric', class: 'money', autocomplete: 'off',
        placeholder: opt ? 'không bắt buộc' : '0', value: F.money[k] !== undefined && F.money[k] !== '' ? money(F.money[k]).replace('đ', '') : '' });
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
    const reason = h('textarea', { placeholder: 'ví dụ: chưa rõ, đang xem lại camera', value: F.reason });
    reason.addEventListener('input', () => { F.reason = reason.value; update(); });

    // giải trình
    const exWrap = h('div');
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
      const kindSeg = segBtns(['TM', 'CK'], () => e.kind, k => { e.kind = k; });
      const dirSeg = segBtns(['thiếu', 'thừa'], () => e.dir, k => { e.dir = k; });
      const amt = h('input', { type: 'text', placeholder: '50k', value: e.raw, autocomplete: 'off' });
      const prev = h('div', { class: 'hint' });
      const rsn = h('input', { type: 'text', placeholder: 'lý do, ví dụ: khách ship chưa chuyển khoản', value: e.reason, autocomplete: 'off' });
      const paint = () => {
        const v = parseMoney(amt.value);
        amt.classList.toggle('invalid', !!amt.value.trim() && v === null);
        prev.textContent = !amt.value.trim() ? '' : v === null ? 'không hiểu số này'
          : `= ${e.kind === 'CK' ? 'chuyển khoản' : 'tiền mặt'} ${e.dir} ${money(v)}`;
        prev.className = 'hint' + (v === null && amt.value.trim() ? ' bad' : e.dir === 'thiếu' ? ' minus' : ' plus');
      };
      amt.addEventListener('input', () => { e.raw = amt.value; paint(); update(); });
      rsn.addEventListener('input', () => { e.reason = rsn.value; save(); });
      paint();
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, kindSeg, dirSeg, h('div', { class: 'grow' }),
          h('button', { class: 'x', type: 'button', 'aria-label': 'xoá dòng', onclick: () => { F.explains.splice(F.explains.indexOf(e), 1); drawEx(); update(); } }, '×')),
        h('div', { style: 'margin-top:8px' }, amt), prev, h('div', { style: 'margin-top:8px' }, rsn));
    }
    function drawEx() { exWrap.replaceChildren(...F.explains.map(exRow)); }

    function cashCalc() {
      const m = F.money;
      const filled = ['ipCash', 'ipBank', 'opening', 'cash', 'bank'].every(k => m[k] !== undefined && m[k] !== '');
      if (!filled) return null;
      let exC = 0, exB = 0, bad = false;
      F.explains.forEach(e => {
        if (!String(e.raw || '').trim()) return;
        const v = parseMoney(e.raw);
        if (v === null) { bad = true; return; }
        const sv = (e.dir === 'thừa' ? 1 : -1) * v;
        if (e.kind === 'CK') exB += sv; else exC += sv;
      });
      // két phải có = đầu ca + tiền mặt iPOS
      const dC = m.cash - m.opening - m.ipCash, dB = m.bank - m.ipBank;
      const uC = dC - exC, uB = dB - exB;
      const note = c.th.note;
      const misKey = Math.abs(uC) > note && Math.abs(uB) > note && (uC > 0) !== (uB > 0) && Math.abs(uC + uB) <= note;
      return { dC, dB, exC, exB, uC, uB, bad, misKey, needReason: Math.abs(uC) > note || Math.abs(uB) > note, over: uC < -c.th.alert };
    }

    // tồn
    const stockWrap = h('div', null, items.map(it => {
      const st = F.stock[it.name] = F.stock[it.name] || { left: '', refill: '', on: false };
      const inp = h('input', { type: 'text', inputmode: 'decimal', value: st.left, 'aria-label': 'còn lại ' + it.name });
      const set = v => { st.left = v; inp.value = v; update(); };
      inp.addEventListener('input', () => { st.left = inp.value.replace(',', '.').replace(/[^\d.]/g, ''); inp.value = st.left; update(); });
      const step = d => set(String(Math.max(0, (parseFloat(st.left) || 0) + d)));
      const row = h('div', { class: 'stock' },
        h('div', { class: 'name' }, it.name, it.unit ? h('div', { class: 'unit', text: it.unit }) : null),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': 'bớt', onclick: () => step(-1) }, '−'), inp,
          h('button', { type: 'button', 'aria-label': 'thêm', onclick: () => step(1) }, '+')));
      if (evening) {
        const rin = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'lượng đã bổ sung', value: st.refill, style: 'max-width:180px' });
        rin.addEventListener('input', () => { st.refill = rin.value.replace(',', '.').replace(/[^\d.]/g, ''); rin.value = st.refill; save(); });
        const box = h('div', { class: 'refill', hidden: !st.on }, rin, it.unit ? h('span', { class: 'unit', text: it.unit }) : null);
        const chip = h('button', { type: 'button', class: 'chip' + (st.on ? ' on' : ''), onclick: () => {
          st.on = !st.on; chip.classList.toggle('on', st.on); box.hidden = !st.on; if (!st.on) { st.refill = ''; rin.value = ''; } save();
        } }, 'đã làm mới');
        row.append(chip, box);
      }
      return row;
    }));

    // việc khác (tự điền) và giao ca sau
    const othersWrap = h('div');
    function drawOthers() {
      othersWrap.replaceChildren(...F.others.map((o, idx) => {
        o.k = o.k || 'other:' + Date.now() + ':' + idx;
        const inp = h('input', { type: 'text', placeholder: 'việc đã làm', value: o.text });
        inp.addEventListener('input', () => { o.text = inp.value; save(); });
        return h('div', { class: 'card' },
          h('div', { class: 'row' }, h('div', { class: 'grow' }, inp),
            h('button', { class: 'x', type: 'button', 'aria-label': 'xoá', onclick: () => { delete store[o.k]; F.others.splice(F.others.indexOf(o), 1); drawOthers(); update(); } }, '×')),
          h('div', { class: 'photos', style: 'margin-top:10px' }, photoSlot(store, o.k, 'việc khác (ảnh không bắt buộc)', { onChange: update })));
      }));
    }
    const handWrap = h('div');
    function drawHand() {
      handWrap.replaceChildren(...F.handover.map(t => {
        const inp = h('input', { type: 'text', placeholder: 'ví dụ: nấu 2 nồi trân châu', value: t.text });
        inp.addEventListener('input', () => { t.text = inp.value; save(); });
        return h('div', { class: 'row', style: 'margin:8px 0' }, h('div', { class: 'grow' }, inp),
          h('button', { class: 'x', type: 'button', 'aria-label': 'xoá', onclick: () => { F.handover.splice(F.handover.indexOf(t), 1); drawHand(); save(); } }, '×'));
      }));
    }

    const incident = h('textarea', { placeholder: 'không có thì để trống', value: F.incident });
    incident.addEventListener('input', () => { F.incident = incident.value; save(); });
    const note = h('textarea', { placeholder: 'không bắt buộc', value: F.note });
    note.addEventListener('input', () => { F.note = note.value; save(); });

    const moneyPhotos = ['phiếu chốt ca iPOS'];
    const missing = h('div', { class: 'missing' });
    const submit = h('button', { class: 'btn', onclick: send }, 'gửi báo cáo');

    function lacking() {
      const out = [];
      const m = F.money;
      const ml = { ipRevenue: 'doanh thu iPOS', ipCash: 'tiền mặt iPOS', ipBank: 'chuyển khoản iPOS', opening: 'tiền mặt đầu ca', cash: 'tiền mặt đếm', bank: 'chuyển khoản ngân hàng' };
      Object.entries(ml).forEach(([k, l]) => { if (m[k] === undefined || m[k] === '') out.push(l); });
      const cc = cashCalc();
      if (cc && cc.bad) out.push('giải trình có số tiền không hiểu');
      if (F.explains.some(e => String(e.raw || '').trim() && !String(e.reason || '').trim())) out.push('lý do của giải trình');
      if (cc && cc.needReason && !F.reason.trim()) out.push('lý do lệch');
      moneyPhotos.concat(c.areas).forEach(a => { if (!(store[a] && store[a].id)) out.push('ảnh ' + a); });
      items.forEach(it => { if (F.stock[it.name].left === '') out.push('tồn ' + it.name); });
      return out;
    }

    function update() {
      const cc = cashCalc();
      if (!cc) {
        cashBox.replaceChildren(h('div', { class: 'hint', text: 'Điền đủ các ô tiền mặt (kể cả đầu ca) và chuyển khoản để xem chênh lệch.' }));
      } else {
        const m = F.money;
        const line = (label, d, ex, u, detail) => {
          const warn = Math.abs(u) > c.th.note;
          const head = h('div', { class: 'cline' },
            h('span', { text: label }),
            h('strong', { class: !d ? 'ok' : d < 0 ? 'minus' : 'plus', text: diffText(d) + (!d ? ' ✓' : '') }));
          const sub = [h('div', { class: 'hint', text: detail })];
          if (d && ex) sub.push(h('div', { class: 'hint', text: `đã giải trình ${diffText(ex)}` }));
          if (d) sub.push(h('div', { class: warn ? 'warn' : 'ok', text: `→ ${u ? "còn " + diffText(u) : "đã khớp"}${warn ? ' ⚠' : ' ✓'}` }));
          return h('div', { class: 'cblock' }, head, ...sub);
        };
        cashBox.replaceChildren(
          line('Tiền mặt trong két', cc.dC, cc.exC, cc.uC,
            `đầu ca ${money(m.opening)} + iPOS ${money(m.ipCash)} = phải có ${money(m.opening + m.ipCash)} · đếm được ${money(m.cash)}`),
          line('Chuyển khoản', cc.dB, cc.exB, cc.uB, `iPOS ${money(m.ipBank)} · ngân hàng ${money(m.bank)}`),
          cc.misKey ? h('div', { class: 'warn', text: 'Có thể bấm nhầm tiền mặt / chuyển khoản trên iPOS.' }) : '',
          cc.over ? h('div', { class: 'bad', text: 'Lệch quá ' + money(c.th.alert) + ': nhắn riêng head-barista hoặc chủ quán ngay.' }) : '');
      }
      const need = cc && cc.needReason;
      reasonWrap.replaceChildren(...(need ? [h('label', { class: 'f', text: 'lý do lệch (bắt buộc vì vẫn lệch quá ' + money(c.th.note) + ')' }), reason] : []));
      const lack = lacking();
      const uploading = Object.values(store).some(p => p.file && !p.id);
      missing.replaceChildren(...(lack.length ? [h('div', { text: `còn thiếu ${lack.length} mục:` }), h('div', { text: lack.join(' · ') })] : uploading ? ['đang tải ảnh…'] : []));
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
          explains: F.explains.filter(e => String(e.raw || '').trim()).map(e => ({ kind: e.kind, dir: e.dir, raw: e.raw, reason: e.reason })),
          reason: F.reason,
          photos,
          stock: Object.fromEntries(items.map(it => [it.name, { left: F.stock[it.name].left, refill: evening && F.stock[it.name].on ? F.stock[it.name].refill : '' }])),
          completed: completedTasks(tasks, store),
          others: F.others.filter(o => o.text.trim()).map(o => ({ text: o.text, photoId: store[o.k] && store[o.k].id })),
          handover: F.handover.filter(t => t.text.trim()).map(t => ({ text: t.text })),
          incident: F.incident, note: F.note,
        };
        const r = await api('submitClosing', payload);
        const files = Object.entries(store).filter(([k, v]) => v.id && v.file && !NO_ZALO.includes(k)).map(([, v]) => v.file);
        await DB.del(key);
        S.info.pendingTasks = Math.max(0, S.info.pendingTasks - payload.completed.length);
        viewShare(r, files);
      } catch (e) {
        toast(e.message, true);
        submit.textContent = 'gửi báo cáo';
        update();
      }
    }

    render(back(), h('h2', { class: 'title', text: 'báo cáo chốt ca' }),
      h('p', { class: 'sub', text: `Ca ${shift} · ${hm(now())}${saved.F ? ' · đã khôi phục bản nháp' : ''}` }),
      h('h3', { text: 'tiền theo iPOS' }),
      moneyField('ipRevenue', 'Tổng doanh thu'), moneyField('ipCash', 'Tiền mặt'), moneyField('ipBank', 'Chuyển khoản'),
      h('h3', { text: 'tiền thực tế' }),
      moneyField('opening', 'Tiền mặt đầu ca (tiền lẻ có sẵn trong két lúc nhận ca)'),
      moneyField('cash', 'Tiền mặt đếm trong két lúc chốt (tổng)'),
      moneyField('bank', 'Chuyển khoản đã về (xem app ngân hàng)'),
      cashBox,
      h('h3', { text: 'giải trình' }),
      h('p', { class: 'hint', text: 'Chọn tiền mặt (TM) hay chuyển khoản (CK), thiếu hay thừa, rồi gõ số tiền kiểu 50k, 100.000, 1tr2 kèm lý do. Số trần như "50" hiểu là 50.000đ.' }),
      exWrap,
      h('button', { class: 'add', type: 'button', onclick: () => { F.explains.push({ kind: 'TM', raw: '', reason: '' }); drawEx(); update(); } }, '+ thêm dòng giải trình'),
      reasonWrap,
      moneyField('tip', 'Tip tiền mặt (để riêng)', true),
      h('h3', { text: 'ảnh phiếu' }),
      h('div', { class: 'photos' },
        photoSlot(store, 'phiếu chốt ca iPOS', 'phiếu chốt ca iPOS', { required: true, onChange: update }),
        photoSlot(store, 'phiếu chi', 'phiếu chi (nếu có)', { onChange: update })),
      h('h3', { text: 'ảnh khu vực' }),
      h('div', { class: 'photos' }, c.areas.map(a => photoSlot(store, a, a, { required: true, onChange: update }))),
      h('h3', { text: 'tồn nhanh' + (evening ? ' · ca tối' : '') }), stockWrap,
      h('h3', { text: 'việc được bàn giao' }), taskList(tasks, store, update),
      h('h3', { text: 'việc khác đã làm' }), othersWrap,
      h('button', { class: 'add', type: 'button', onclick: () => { F.others.push({ text: '' }); drawOthers(); save(); } }, '+ thêm việc khác'),
      h('h3', { text: 'giao việc cho ca sau' }), handWrap,
      h('button', { class: 'add', type: 'button', onclick: () => { F.handover.push({ text: '' }); drawHand(); save(); } }, '+ thêm việc'),
      h('h3', { text: 'sự cố' }), incident,
      h('h3', { text: 'ghi chú' }), note,
      missing, submit);
    drawEx(); drawOthers(); drawHand(); update();
  }

  // ---------- gửi Zalo (2 bước, đã thử trên iPhone) ----------
  function viewShare(r, files) {
    const canShare = !!navigator.share;
    const b2 = h('button', { class: 'btn', disabled: true }, `2. gửi ${files.length} ảnh vào Zalo`);
    const b1 = h('button', { class: 'btn', onclick: async () => {
      if (!canShare) {
        try { await navigator.clipboard.writeText(r.zaloText); toast('Đã chép tin. Dán vào Zalo.'); } catch (e) { toast('Hãy chép tin ở trên', true); }
        b1.classList.add('done'); b2.disabled = !files.length;
        return;
      }
      try {
        await navigator.share({ text: r.zaloText });
        b1.classList.add('done'); b1.textContent = '1. đã gửi tin ✓';
        b2.disabled = !files.length;
      } catch (e) { if (e.name !== 'AbortError') toast('Không mở được chia sẻ: ' + e.message, true); }
    } }, '1. gửi tin vào Zalo');
    b2.addEventListener('click', async () => {
      if (!canShare) { toast('Máy này không chia sẻ ảnh được', true); return; }
      try {
        const data = { files };
        if (navigator.canShare && !navigator.canShare(data)) throw new Error('máy không hỗ trợ chia sẻ ảnh');
        await navigator.share(data);
        b2.classList.add('done'); b2.textContent = '2. đã gửi ảnh ✓';
      } catch (e) { if (e.name !== 'AbortError') toast('Không gửi được ảnh: ' + e.message, true); }
    });
    render(
      h('div', { class: 'big-ok', text: 'đã gửi ✓' }),
      h('p', { class: 'sub', text: 'Báo cáo đã lưu. Giờ gửi vào nhóm á daily report.' }),
      r.alert ? h('div', { class: 'alert bad', text: 'Két lệch lớn: nhắn riêng head-barista hoặc chủ quán ngay.' }) : null,
      h('pre', { class: 'msg', text: r.zaloText }),
      b1, b2,
      h('p', { class: 'hint', text: 'Gửi tin trước, quay lại đây gửi ảnh sau. Chọn đúng nhóm ở cả hai bước.' }),
      h('button', { class: 'btn ghost', onclick: viewHome }, 'xong, về trang chính'));
  }

  // ---------- duyệt công ----------
  async function viewApprovals() {
    render(back(), h('h2', { class: 'title', text: 'duyệt công' }), spinner('đang tải…'));
    let list;
    try { list = await api('approvals'); } catch (e) { render(back(), h('p', { class: 'alert bad', text: e.message })); return; }
    S.info.pendingApprovals = list.length;
    const card = it => {
      const tIn = it.inTime ? hm(new Date(it.inTime)) : '—', tOut = it.outTime ? hm(new Date(it.outTime)) : '—';
      const el = h('div', { class: 'card' });
      const img = (b64, alt) => b64 ? h('img', { src: 'data:image/jpeg;base64,' + b64, alt }) : h('img', { alt: 'không có ảnh' });
      const form = h('div', { hidden: true },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('label', { class: 'f', text: 'giờ vào' }), h('input', { type: 'time', value: it.inTime ? tIn : '', name: 'in' })),
          h('div', { class: 'grow' }, h('label', { class: 'f', text: 'giờ ra' }), h('input', { type: 'time', value: it.outTime ? tOut : '', name: 'out' }))),
        h('label', { class: 'f', text: 'lý do sửa (bắt buộc)' }), h('input', { type: 'text', name: 'reason', placeholder: 'ví dụ: xác nhận qua camera' }),
        h('button', { class: 'btn', onclick: async (ev) => {
          const q = n => form.querySelector(`[name=${n}]`).value;
          ev.target.disabled = true;
          try { await api('approve', { id: it.id, op: 'edit', inTime: q('in'), outTime: q('out'), reason: q('reason') }); done('đã sửa'); }
          catch (e) { toast(e.message, true); ev.target.disabled = false; }
        } }, 'lưu giờ đã sửa'));
      const done = st => { el.replaceChildren(h('div', { class: 'hint ok', text: `${it.name} · ${it.date}: ${st} ✓` })); S.info.pendingApprovals--; };
      el.append(
        h('div', null, h('strong', { text: it.name }), ` · ${it.date} · ca ${it.shift || '—'}`),
        h('div', { class: 'meta', text: `vào ${tIn} · ra ${tOut}` }),
        h('div', { class: 'todo', text: it.flags }),
        h('div', { class: 'selfies' }, img(it.selfieIn, 'selfie vào'), img(it.selfieOut, 'selfie ra')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'margin:4px 0', onclick: async (ev) => {
            ev.target.disabled = true;
            try { await api('approve', { id: it.id, op: 'approve' }); done('đã duyệt'); }
            catch (e) { toast(e.message, true); ev.target.disabled = false; }
          } }, 'duyệt'),
          h('button', { class: 'btn ghost', style: 'margin:4px 0', onclick: () => { form.hidden = !form.hidden; } }, 'sửa giờ')),
        form);
      return el;
    };
    render(back(), h('h2', { class: 'title', text: 'duyệt công' }),
      h('p', { class: 'sub', text: list.length ? `${list.length} lượt cần xem. Lượt bình thường đã tự duyệt.` : 'Không có lượt nào cần duyệt.' }),
      list.map(card));
  }

  // ---------- khởi động ----------
  if (MOCK) document.body.append(h('div', { class: 'demo', text: 'bản xem thử · dữ liệu giả' }));
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  viewLogin();
})();

// Máy chủ giả lập để xem thử giao diện khi chưa có API_URL. PIN nào 6 số cũng đúng, trừ 000000.
(() => {
  if (window.APP_CONFIG && window.APP_CONFIG.API_URL) return;
  const staff = { 'Đoàn Hạnh Nguyên': 'head-barista', 'Nguyễn Trâm Anh': 'barista', 'Hoàng Ngọc Tú': 'barista' };
  const cfg = {
    areas: ['Mặt quầy pha chế', 'Quầy thu ngân', 'Back bar', 'Gầm cầu thang', 'Sàn nhà vệ sinh', 'Đồ dùng cho khách trong nhà vệ sinh', 'Sân trước'],
    stock: ['Kem matcha', 'Kem mè đen', 'Sữa hạt dẻ cười', 'Sốt đào xay', 'Nước ép dưa lưới'].map(n => ({ name: n, unit: '', scope: 'cả hai' })),
    th: { note: 20000, comp: 100000, alert: 200000 }, aft: '15:00', eve: '20:00', openFrom: '07:00', openTo: '10:30'
  };
  let open = {};
  let tasks = [{ id: 't1', text: 'nấu 2 nồi trân châu', from: 'Hoàng Ngọc Tú', at: Date.now() - 3 * 3600e3, to: ['Nguyễn Trâm Anh', 'Đoàn Hạnh Nguyên'] },
    { id: 't2', text: 'lau tủ mát', from: 'Hoàng Ngọc Tú', at: Date.now() - 3 * 3600e3, to: [] }];
  let approvals = [{ id: 'c1', date: '2026-11-17', name: 'Hoàng Ngọc Tú', shift: 'C', inTime: Date.now() - 26 * 3600e3,
    outTime: null, flags: 'không có vị trí; quên chấm ra', selfieIn: null, selfieOut: null }];
  let n = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ok = data => ({ ok: true, data });
  const err = e => ({ ok: false, error: e });
  const fmt = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';

  const summary = (name, isHead) => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const at = (dayOff, h, m) => d0.getTime() + dayOff * 864e5 + (h * 60 + (m || 0)) * 6e4;
    const hh = x => String(x).padStart(2, '0') + ':00';
    const blk = (dayOff, s, e, codes) => ({ date: '', start: at(dayOff, s), end: at(dayOff, e), startHM: hh(s), endHM: hh(e), codes });
    const since = open[name] || null;
    const inNow = !!since;
    const out = {
      now: Date.now(),
      today: { block: blk(0, 8, 16, 'FT1'), clock: inNow ? { state: 'in', since } : { state: 'out' },
        workedMin: inNow ? Math.round((Date.now() - since) / 6e4) : 0, mates: ['Nguyễn Trâm Anh'],
        items: [{ text: 'chấm vào', done: inNow }, { text: 'báo cáo đầu ca', note: cfg.openFrom + '–' + cfg.openTo, done: true },
          ...tasks.map(t => ({ text: t.text, note: 'bàn giao', done: false })),
          { text: 'báo cáo chốt ca', note: 'người giữ két · khoảng 15:30', done: false }, { text: 'chấm ra', done: false }] },
      next: blk(1, 15, 23, 'C+T'),
      month: { label: 'tháng ' + (new Date().getMonth() + 1), recap: new Date().getDate() === 1, days: 14, minutes: 6420, nightMinutes: 95,
        late: 2, lateMin: 17, early: 0, earlyMin: 0, forgot: 1, pending: 0 }
    };
    if (isHead) out.team = { openingDone: true, notIn: [{ name: 'Hoàng Ngọc Tú', start: '08:00' }],
      lastClosing: { at: at(-1, 22, 40), by: 'Nguyễn Trâm Anh', shift: 'T', diffCash: -50000, uCash: 0, diffBank: -100000, uBank: -100000 } };
    return out;
  };

  window.MOCK_API = async (b) => {
    await wait(b.action === 'uploadPhoto' ? 500 : 300);
    if (b.action === 'staffList') return ok(Object.keys(staff));
    if (!staff[b.name] || !/^\d{6}$/.test(b.pin || '') || b.pin === '000000') return err('Sai tên hoặc PIN');
    const isHead = staff[b.name] === 'head-barista';
    switch (b.action) {
      case 'login':
        return ok({ name: b.name, role: staff[b.name], isHead, serverNow: Date.now(),
          shifts: [{ code: 'FT1', start: '08:00', end: '16:00' }], openSince: open[b.name] || null,
          pendingTasks: tasks.length, pendingApprovals: isHead ? approvals.length : 0, cfg, staff: Object.keys(staff), summary: summary(b.name, isHead) });
      case 'summary': return ok(summary(b.name, isHead));
      case 'week': {
        const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + 7 * (b.week || 0));
        const plan = { 'Đoàn Hạnh Nguyên': ['FT1', 'FT1', '', 'FT2', 'FT1+16-18', 'S+T', ''],
          'Nguyễn Trâm Anh': ['S', 'C', 'S+C', '', 'T', 'FT2', 'S'], 'Hoàng Ngọc Tú': ['FT2', '', 'FT1', 'S', '', '10-14', 'FT2'] };
        const def = { S: [8, 13], C: [13, 18], T: [18, 23], FT1: [8, 16], FT2: [15, 23] };
        const hm2 = x => String(Math.floor(x)).padStart(2, '0') + ':' + String(Math.round((x % 1) * 60)).padStart(2, '0');
        const days = [...Array(7)].map((_, i) => {
          const d = new Date(mon); d.setDate(d.getDate() + i);
          const people = Object.entries(plan).map(([name, row]) => {
            const parts = row[(i + (b.week || 0) * 2) % 7].split('+').filter(Boolean).map(t => def[t] || t.split('-').map(Number)).sort((x, y) => x[0] - y[0]);
            const blocks = [];
            parts.forEach(([s0, e0], k) => { const last = blocks[blocks.length - 1];
              if (last && s0 <= last.e) { last.e = Math.max(last.e, e0); last.codes += '+' + row[(i + (b.week || 0) * 2) % 7].split('+')[k]; }
              else blocks.push({ s: s0, e: e0, codes: row[(i + (b.week || 0) * 2) % 7].split('+')[k] }); });
            return { name, me: name === b.name, blocks: blocks.map(x => ({ start: d.getTime() + x.s * 36e5, end: d.getTime() + x.e * 36e5, startHM: hm2(x.s), endHM: hm2(x.e), codes: x.codes })) };
          }).filter(p => p.blocks.length).sort((x, y) => x.blocks[0].start - y.blocks[0].start);
          return { date: '', ts: d.getTime(), people };
        });
        return ok({ week: b.week || 0, days });
      }
      case 'uploadPhoto': return ok({ id: 'mock' + (++n) + 'xxxxxxxx' });
      case 'tasks': return ok(tasks.filter(t => !t.to.length || t.to.includes(b.name)));
      case 'clock': {
        const t = Date.now();
        if (b.type === 'in') open[b.name] = t; else delete open[b.name];
        const flags = b.loc ? [] : ['không có vị trí'];
        return ok({ type: b.type, time: t, flags, distance: b.loc ? 12 : '' });
      }
      case 'submitOpening':
        tasks = tasks.filter(t => !(b.completed || []).some(c => c.id === t.id));
        return ok({ id: 'r' + n, zaloText: `(á) · Đầu ca sáng · (thử)\nMở quầy: ${b.name}\n[${Object.keys(b.photos).length} ảnh]` });
      case 'submitClosing': {
        const m = b.money;
        const dC = m.cash - (m.opening || 0) - m.ipCash;
        return ok({ id: 'r' + n, alert: dC < -200000, compEach: 0, flags: [], people: [b.name],
          zaloText: `(á) · Chốt ca (thử)\nGiữ ca: ${b.name}\nDoanh thu iPOS: ${fmt(m.ipRevenue)}\nKét: lệch ${fmt(dC)}\nGiao ca sau: ${(b.handover || []).map(h => h.text).join(' · ') || '—'}` });
      }
      case 'approvals': return isHead ? ok(approvals) : err('Chỉ head-barista hoặc chủ quán được làm việc này');
      case 'approve':
        approvals = approvals.filter(a => a.id !== b.id);
        return ok({ status: b.op === 'edit' ? 'đã sửa' : 'đã duyệt' });
    }
    return err('Yêu cầu không hợp lệ');
  };
})();

// Máy chủ giả lập để xem thử giao diện khi chưa có API_URL. Mã đăng nhập: 111111 (Nguyên, head), 222222 (Anh), 333333 (Tú); 6 số khác cũng đúng khi đã có tên, trừ 000000.
(() => {
  if (window.APP_CONFIG && window.APP_CONFIG.API_URL) return;
  const staff = { 'Đoàn Hạnh Nguyên': 'head-barista', 'Nguyễn Trâm Anh': 'barista', 'Hoàng Ngọc Tú': 'barista' };
  const cfg = {
    areas: ['Mặt quầy pha chế', 'Quầy thu ngân', 'Back bar', 'Gầm cầu thang', 'Sàn nhà vệ sinh', 'Đồ dùng cho khách trong nhà vệ sinh', 'Sân trước'],
    stock: ['Kem matcha', 'Kem mè đen', 'Sữa hạt dẻ cười', 'Sốt đào xay', 'Nước ép dưa lưới'].map(n => ({ name: n, unit: '', scope: 'cả hai' })),
    evening: [{ name: 'Bột matcha', group: 'trà', unit: 'g' }, { name: 'Bột hojicha', group: 'trà', unit: 'g' },
      { name: 'Trà ủ lạnh', group: 'nguyên liệu pha chế', unit: 'ml' }, { name: 'Sữa tươi', group: 'nguyên liệu pha chế', unit: 'ml' }],
    th: { note: 20000, comp: 100000, alert: 200000 }, aft: '15:00', eve: '20:00', openFrom: '07:00', openTo: '10:30'
  };
  let open = {};
  let tasks = [{ id: 't1', text: 'nấu 2 nồi trân châu', from: 'Hoàng Ngọc Tú', at: Date.now() - 3 * 3600e3, to: ['Nguyễn Trâm Anh', 'Đoàn Hạnh Nguyên'] },
    { id: 't2', text: 'lau tủ mát', from: 'Hoàng Ngọc Tú', at: Date.now() - 3 * 3600e3, to: [] }];
  const at0 = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  let approvals = [{ id: 'c0', date: new Date().toISOString().slice(0,10), name: 'Nguyễn Trâm Anh', shift: 'FT1', inTime: at0(8, 22), outTime: null, flags: 'đi trễ 22 phút', stage: 'in', selfieIn: null, selfieOut: null, plan: [{ startHM: '08:00', endHM: '16:00', codes: 'FT1' }] },
    { id: 'c2', date: '2026-11-18', name: 'Đoàn Hạnh Nguyên', shift: 'C', inTime: at0(16, 25) - 864e5, outTime: at0(18, 2) - 864e5, flags: 'đi trễ 205 phút; không có vị trí', stage: 'full', selfieIn: null, selfieOut: null, plan: [{ startHM: '13:00', endHM: '18:00', codes: 'C' }] },
    { id: 'c1', date: '2026-11-17', name: 'Hoàng Ngọc Tú', shift: 'C', inTime: Date.now() - 26 * 3600e3,
    outTime: null, flags: 'không có vị trí; quên chấm ra', selfieIn: null, selfieOut: null,
    plan: [{ startHM: '13:00', endHM: '18:00', codes: 'C' }] }];
  let approvedDone = [{ id: 'c9', date: '2026-11-18', name: 'Hoàng Ngọc Tú', shift: 'T', inTime: Date.now() - 864e5 - 5 * 3600e3, outTime: Date.now() - 864e5,
    flags: 'về sớm 12 phút', status: 'đã duyệt', by: 'Đoàn Hạnh Nguyên', reason: '' }];
  let doneTasks = [];
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
      today: { block: { ...blk(0, 8, 16, 'FT1'), keeper: isHead }, clock: inNow ? { state: 'in', since } : { state: 'out' },
        workedMin: inNow ? Math.round((Date.now() - since) / 6e4) : 0, mates: ['Nguyễn Trâm Anh'],
        items: [{ text: 'chấm vào', act: 'clock', done: inNow }, { text: 'báo cáo đầu ca', act: 'opening', note: cfg.openFrom + '–' + cfg.openTo, done: true },
          ...tasks.filter(t => !t.to.length || t.to.includes(name)).map(t => ({ ...t, note: 'bàn giao từ ' + t.from.split(' ').pop(), done: false, act: 'task' })),
          ...doneTasks.map(t => ({ text: t.text, note: 'bàn giao từ ' + t.from.split(' ').pop(), done: true })),
          { text: 'báo cáo chốt ca', act: 'closing', note: 'người giữ két · khoảng 15:30', done: false }, { text: 'chấm ra', act: 'clock', done: false }],
        closing: [{ at: '16:00', names: ['Đoàn Hạnh Nguyên'], keeperSet: true, by: '' }, { at: '23:00', names: ['Hoàng Ngọc Tú'], keeperSet: false, by: '' }] },
      next: { ...blk(1, 15, 23, 'C+T'), keeper: !isHead },
      month: { label: 'tháng ' + (new Date().getMonth() + 1), recap: new Date().getDate() === 1, days: 14, minutes: 6420, nightMinutes: 95,
        late: 2, lateMin: 17, early: 0, earlyMin: 0, forgot: 1, pending: 0 },
      noticeTags: [['Chung', 'xám'], ['Lịch ca', 'xanh dương'], ['Công thức', 'xanh lá'], ['Quy định', 'vàng cam'], ['Sự kiện', 'tím'], ['Khẩn', 'đỏ'], ['Đào tạo', 'hồng']].map(([name, color]) => ({ name, color })),
      notices: NOTICES || (NOTICES = [
        { title: 'Từ thứ Hai, mở cửa sớm 30 phút', body: 'Từ thứ Hai tuần sau quán mở cửa lúc 7:00.\nCa sáng chấm vào trước 6:50 để kịp setup quầy.\n\nAi vướng lịch báo head-barista trước Chủ nhật nhé.', date: at(0, 9, 0), img: false, tag: 'Lịch ca', by: 'Nguyễn Trâm Anh' },
        { title: 'Menu trà mùa đông', body: 'Ba món mới lên menu từ 1/12. Xem ảnh công thức bên dưới, tuần này mỗi bạn pha thử ít nhất một lần.', date: at(-2, 10, 0), img: true, tag: 'Công thức', by: 'Nguyễn Trâm Anh' }])
    };
    if (isHead) out.team = { openingDone: true, notIn: [{ name: 'Hoàng Ngọc Tú', start: '08:00' }],
      lastClosing: { at: at(-1, 22, 40), by: 'Nguyễn Trâm Anh', shift: 'T', diffCash: -50000, uCash: 0, diffBank: -100000, uBank: -100000 } };
    return out;
  };

  let NOTICES = null;
  window.MOCK_API = async (b) => {
    await wait(b.action === 'uploadPhoto' ? 500 : 300);
    if (b.action === 'staffList') return ok(Object.keys(staff));
    if (b.action === 'welcome') return ok({ quotes: [
      { text: 'Ichi-go ichi-e: mỗi lần gặp gỡ chỉ có một lần. Hãy pha từng ly như thể đó là ly duy nhất khách được uống.', by: 'Trà đạo Nhật Bản' },
      { text: 'Kaizen: hôm nay làm tốt hơn hôm qua một chút là đủ.', by: 'Triết lý Nhật Bản' }], bg: null });
    if (b.action === 'pinLogin') {
      const name = { 111111: 'Đoàn Hạnh Nguyên', 222222: 'Nguyễn Trâm Anh', 333333: 'Hoàng Ngọc Tú' }[b.pin];
      return name ? ok({ name }) : err('Mã không đúng (lần 1/5). Nếu chắc chắn đúng, báo chủ quán kiểm tra.');
    }
    if (!staff[b.name] || !/^\d{6}$/.test(b.pin || '') || b.pin === '000000') return err('Sai tên hoặc PIN');
    const isHead = staff[b.name] === 'head-barista';
    switch (b.action) {
      case 'login':
        return ok({ name: b.name, role: staff[b.name], isHead, serverNow: Date.now(),
          shifts: [{ code: 'FT1', start: '08:00', end: '16:00' }], openSince: open[b.name] || null,
          pendingTasks: tasks.length, pendingApprovals: isHead ? approvals.length : 0, cfg, staff: Object.keys(staff), summary: summary(b.name, isHead) });
      case 'summary': return ok(summary(b.name, isHead));
      case 'noticeImg': return ok({ ver: 'demo', data: 'bg-welcome.webp' });
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
      case 'completeTask': {
        const t = tasks.find(x => x.id === b.id);
        if (!t) return err('Việc này đã được xử lý');
        tasks = tasks.filter(x => x !== t); doneTasks.push(t);
        return ok({ text: t.text });
      }
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
        return ok({ id: b.editOf || 'r' + n, edited: !!b.editOf, alert: dC < -200000, compEach: 0, flags: [], people: [b.name],
          zaloText: `(á) · Chốt ca (thử)\nGiữ ca: ${b.name}\nDoanh thu iPOS: ${fmt(m.ipRevenue)}\nKét: lệch ${fmt(dC)}\nGiao ca sau: ${(b.handover || []).map(h => h.text).join(' · ') || '—'}` });
      }
      case 'approvals':
        if (!isHead) return err('Chỉ head-barista hoặc chủ quán được làm việc này');
        if (b.id) { const x = approvals.find(a => a.id === b.id) || approvedDone.find(a => a.id === b.id); return x ? ok([{ plan: [], stage: 'full', ...x, selfieIn: x.selfieIn || null, selfieOut: x.selfieOut || null }]) : err('Không tìm thấy lượt này'); }
        // lite: không kèm ảnh, app tải ảnh sau
        return ok(b.lite ? approvals.map(({ selfieIn, selfieOut, ...x }) => x) : approvals);
      case 'postNotice':
        if (!isHead) return err('Chỉ head-barista hoặc chủ quán được làm việc này');
        NOTICES.unshift({ title: b.title.trim(), body: b.body.trim(), date: Date.now(), img: !!b.photo, tag: b.tag, by: b.name || 'Bạn' });
        return ok({ notices: NOTICES });
      case 'deleteNotice':
        NOTICES.splice(b.i, 1);
        return ok({ notices: NOTICES });
      case 'approvalsDone': return isHead ? ok(approvedDone.map(x => ({ plan: [], stage: 'full', ...x, selfieIn: undefined, selfieOut: undefined }))) : err('Chỉ head-barista hoặc chủ quán được làm việc này');
      case 'approve':
        if (b.op === 'reopen') { const x = approvedDone.find(a => a.id === b.id); approvedDone = approvedDone.filter(a => a.id !== b.id);
          if (x) approvals.push({ id: x.id, date: x.date, name: x.name, shift: x.shift, inTime: x.inTime, outTime: x.outTime, flags: x.flags, stage: 'full', selfieIn: null, selfieOut: null, plan: [] });
          return ok({ status: 'chờ duyệt' }); }
        { const y = approvedDone.find(a => a.id === b.id);
          if (y) { // vòng 2
            if (b.op === 'edit') { y.status = 'đã sửa'; y.reason = (y.reason ? y.reason + ' → ' : '') + b.reason; y.inTime = new Date(new Date(y.inTime).toDateString() + ' ' + b.inTime).getTime(); if (b.outTime) y.outTime = new Date(new Date(y.outTime).toDateString() + ' ' + b.outTime).getTime(); y.flags = ''; }
            y.by = b.name; return ok({ status: y.status }); } }
        { const x = approvals.find(a => a.id === b.id); if (x) approvedDone.unshift({ ...x, status: b.op === 'edit' ? 'đã sửa' : 'đã duyệt', by: b.name, reason: b.reason || '', flags: b.op === 'edit' ? String(x.flags || '').split('; ').filter(f => !/^(đi trễ|về sớm)/.test(f)).join('; ') : x.flags, plan: x.plan && x.plan.length ? x.plan : [{ startHM: '13:00', endHM: '18:00', codes: 'C' }] }); }
        approvals = approvals.filter(a => a.id !== b.id);
        if (b.op === 'edit' && !b.outTime) return ok({ status: 'đã duyệt vào' });
        return ok({ status: b.op === 'edit' ? 'đã sửa' : 'đã duyệt' });
    }
    return err('Yêu cầu không hợp lệ');
  };
})();

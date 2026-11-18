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
  let tasks = [{ id: 't1', text: 'nấu 2 nồi trân châu', from: 'Hoàng Ngọc Tú', at: Date.now() - 3 * 3600e3 }];
  let approvals = [{ id: 'c1', date: '2026-11-17', name: 'Hoàng Ngọc Tú', shift: 'C', inTime: Date.now() - 26 * 3600e3,
    outTime: null, flags: 'không có vị trí; quên chấm ra', selfieIn: null, selfieOut: null }];
  let n = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ok = data => ({ ok: true, data });
  const err = e => ({ ok: false, error: e });
  const fmt = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';

  window.MOCK_API = async (b) => {
    await wait(b.action === 'uploadPhoto' ? 500 : 300);
    if (b.action === 'staffList') return ok(Object.keys(staff));
    if (!staff[b.name] || !/^\d{6}$/.test(b.pin || '') || b.pin === '000000') return err('Sai tên hoặc PIN');
    const isHead = staff[b.name] === 'head-barista';
    switch (b.action) {
      case 'login':
        return ok({ name: b.name, role: staff[b.name], isHead, serverNow: Date.now(),
          shifts: [{ code: 'FT1', start: '08:00', end: '16:00' }], openSince: open[b.name] || null,
          pendingTasks: tasks.length, pendingApprovals: isHead ? approvals.length : 0, cfg });
      case 'uploadPhoto': return ok({ id: 'mock' + (++n) + 'xxxxxxxx' });
      case 'tasks': return ok(tasks);
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
        const dC = m.cash - m.ipCash;
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

document.getElementById('resv-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('resv-name').value.trim();
  const gender = document.getElementById('resv-gender').value;
  const checkIn = document.getElementById('resv-in').value;
  if (!name || !gender || !checkIn) { alert('请填写姓名、性别和预计入住日期'); return; }
  const checkOut = document.getElementById('resv-out').value || null;
  if (checkOut && checkOut < checkIn) { alert('预计离院日期不能早于预计入住日期'); return; }
  const phone = document.getElementById('resv-phone').value.trim() || null;
  const idCard = document.getElementById('resv-idcard').value.trim() || null;
  if (phone && !RULES.phone.test(phone)) { alert(RULES.phone.msg); document.getElementById('resv-phone').focus(); return; }
  if (idCard && !RULES.idCard.test(idCard)) { alert(RULES.idCard.msg); document.getElementById('resv-idcard').focus(); return; }
  const person = parsePersonNameInput(name);
  const eventId = document.getElementById('resv-event').value || null;
  if (eventId) {
    const evt = query("SELECT id FROM events WHERE id=? AND status != '已取消'", [eventId])[0];
    if (!evt) { alert('所选营期不存在或已取消，请重新选择'); return; }
  }
  const guestId = findOrCreateGuest(person.name, gender, phone, idCard);
  const meal = readMealNeedPicker('resv-meal-need');
  if (!validateMealNeedPicker('resv-meal-need')) return;

  const resvId = document.getElementById('resv-id').value;
  try {
    await withTransaction(async () => {
      if (resvId) {
        // 编辑模式 | Edit mode
        const existing = query("SELECT * FROM reservations WHERE id=?", [resvId])[0];
        if (!existing) { throw new Error('预约记录不存在'); }
        if (existing.status === '已入住' || existing.status === '已取消') {
          throw new Error('已入住或已取消的预约不可编辑');
        }
        run(`UPDATE reservations SET
          guest_id=?, event_id=?, name=?, dharma_name=?, gender=?, phone=?, id_card=?,
          role=?, class_name=?, expected_check_in=?, expected_check_out=?,
          room_preference=?, source=?, notes=?, meal_breakfast=?, meal_lunch=?, meal_dinner=?
          WHERE id=?`, [
          guestId, eventId, person.name, person.dharma_name, gender || null, phone, idCard,
          readLodgerRoleInput('resv-role'),
          document.getElementById('resv-class').value.trim() || null,
          checkIn, checkOut,
          document.getElementById('resv-room').value.trim() || null,
          document.getElementById('resv-source').value || null,
          document.getElementById('resv-notes').value.trim() || null,
          meal.breakfast, meal.lunch, meal.dinner,
          resvId
        ]);
        logAudit('更新预约', 'reservation', resvId, { guest_id: guestId, name: name });
      } else {
        // 新增模式 | Add mode
        run(`INSERT INTO reservations
          (guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, expected_check_in, expected_check_out, room_preference, source, status, notes, meal_breakfast, meal_lunch, meal_dinner)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '预约', ?, ?, ?, ?)`, [
          guestId, eventId,
          person.name, person.dharma_name, gender || null, phone, idCard,
          readLodgerRoleInput('resv-role'),
          document.getElementById('resv-class').value.trim() || null,
          checkIn, checkOut,
          document.getElementById('resv-room').value.trim() || null,
          document.getElementById('resv-source').value || null,
          document.getElementById('resv-notes').value.trim() || null,
          meal.breakfast, meal.lunch, meal.dinner
        ]);
        const newId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
        logAudit('添加预约', 'reservation', newId, { guest_id: guestId, name: name });
      }
    });
  } catch (e) {
    console.error(e);
    alert('保存预约失败：' + e.message);
    return;
  }
  await saveDB();
  showToast(resvId ? '预约更新成功' : '预约添加成功');
  resetResvForm();
  renderReservations('全部');
  renderAll();
});

function resetResvForm() {
  document.getElementById('resv-form').reset();
  document.getElementById('resv-id').value = '';
  document.getElementById('resv-in').valueAsDate = new Date();
  setMealNeedPicker('resv-meal-need', 1, 1, 1);
  const btn = document.getElementById('resv-submit-btn');
  if (btn) btn.textContent = '添加预约';
}

function editResv(id) {
  const r = query("SELECT * FROM reservations WHERE id=?", [id])[0];
  if (!r) return;
  if (r.status === '已入住' || r.status === '已取消') {
    alert('已入住或已取消的预约不可编辑');
    return;
  }
  showView('reservations');
  document.getElementById('resv-id').value = r.id;
  document.getElementById('resv-name').value = personNameInputValue(r);
  document.getElementById('resv-gender').value = r.gender || '';
  document.getElementById('resv-phone').value = r.phone || '';
  document.getElementById('resv-idcard').value = r.id_card || '';
  const resvRoleSel = document.getElementById('resv-role');
  if (resvRoleSel) {
    resvRoleSel.innerHTML = roleSelectOptionsHtml(r.role || '');
    if (typeof rebuildSelectPicker === 'function') rebuildSelectPicker(resvRoleSel);
  } else {
    document.getElementById('resv-role').value = r.role || '';
  }
  document.getElementById('resv-in').value = r.expected_check_in || '';
  document.getElementById('resv-out').value = r.expected_check_out || '';
  document.getElementById('resv-room').value = r.room_preference || '';
  populateEventSelect('resv-event', r.event_id || null);
  document.getElementById('resv-class').value = r.class_name || '';
  document.getElementById('resv-source').value = r.source || '';
  document.getElementById('resv-notes').value = r.notes || '';
  const mf = reservationMealFlags(r);
  setMealNeedPicker('resv-meal-need', mf.breakfast, mf.lunch, mf.dinner);
  ['resv-gender', 'resv-role', 'resv-source', 'resv-event'].forEach(function (selId) {
    if (typeof refreshSelectPicker === 'function') refreshSelectPicker(document.getElementById(selId));
  });
  const btn = document.getElementById('resv-submit-btn');
  if (btn) btn.textContent = '保存预约';
  document.getElementById('resv-name').focus();
}


function renderReservations(filterStatus) {
  populateEventSelect('resv-event', null);
  const tbody = document.getElementById('resv-table');
  tbody.innerHTML = '';
  let sql = "SELECT * FROM reservations WHERE 1=1";
  const params = [];
  if (filterStatus && filterStatus !== '全部') { sql += " AND status = ?"; params.push(filterStatus); }
  sql += " ORDER BY expected_check_in DESC, id DESC";
  const rows = query(sql, params);
  rows.forEach(r => {
    const mf = reservationMealFlags(r);
    const mealLabel = formatMealNeedLabel(mf.breakfast, mf.lunch, mf.dinner);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(personDisplayName(r))}</td>
      <td>${escapeHtml(r.gender) || '-'}</td>
      <td>${escapeHtml(r.phone) || '-'}</td>
      <td>${escapeHtml(r.expected_check_in) || '-'}</td>
      <td>${escapeHtml(r.expected_check_out) || '-'}</td>
      <td>${escapeHtml(mealLabel)}</td>
      <td>${escapeHtml(r.role) || '-'}</td>
      <td>${escapeHtml(r.room_preference) || '-'}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.source) || '-'}</td>
      <td>
        ${r.status === '预约' ? `<button class="btn btn-success btn-sm" onclick="updateResvStatus(${r.id}, '已确认')">确认</button>` : ''}
        ${r.status === '预约' || r.status === '已确认' ? `<button class="btn btn-primary btn-sm" onclick="checkInFromResv(${r.id})">转入住</button>` : ''}
        ${r.status !== '已入住' && r.status !== '已取消' ? `<button class="btn btn-danger btn-sm" onclick="updateResvStatus(${r.id}, '已取消')">取消</button>` : ''}
        ${r.status === '预约' || r.status === '已确认' ? `<button class="btn btn-warning btn-sm" onclick="updateResvStatus(${r.id}, 'No-show')">No-show</button>` : ''}
        ${r.status === '预约' || r.status === '已确认' ? `<button class="btn btn-default btn-sm" onclick="editResv(${r.id})">编辑</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-tip">无预约记录</td></tr>';
  }
}


async function updateResvStatus(id, status) {
  const r = query("SELECT * FROM reservations WHERE id=?", [id])[0];
  if (!r) return;
  const oldStatus = r.status;
  try {
    await withTransaction(async () => {
      run("UPDATE reservations SET status=? WHERE id=?", [status, id]);
      logAudit('更新预约状态', 'reservation', id, { name: r.name, from: oldStatus, to: status });
    });
    await saveDB();
    showToast(`预约已标记为「${status}」`);
    renderReservations('全部');
    renderAll();
  } catch (e) {
    console.error(e);
    alert('更新预约状态失败：' + e.message);
  }
}


function checkInFromResv(id) {
  const r = query("SELECT * FROM reservations WHERE id=?", [id])[0];
  if (!r) return;
  if (r.status === '已取消' || r.status === 'No-show') {
    alert('该预约已取消或 No-show，无法转入住');
    return;
  }
  const mf = reservationMealFlags(r);
  showView('checkin');
  document.getElementById('ci-name').value = personNameInputValue(r);
  document.getElementById('ci-gender').value = r.gender || '';
  document.getElementById('ci-phone').value = r.phone || '';
  document.getElementById('ci-idcard').value = r.id_card || '';
  const ciRoleSel = document.getElementById('ci-role');
  if (ciRoleSel) {
    ciRoleSel.innerHTML = roleSelectOptionsHtml(r.role || '');
    if (typeof rebuildSelectPicker === 'function') rebuildSelectPicker(ciRoleSel);
  } else {
    document.getElementById('ci-role').value = r.role || '';
  }
  document.getElementById('ci-in').value = r.expected_check_in || todayStr();
  document.getElementById('ci-out').value = r.expected_check_out || '';
  document.getElementById('ci-source').value = r.source || '法会预约';
  populateEventSelect('ci-event', r.event_id || null);
  ['ci-gender', 'ci-role', 'ci-source'].forEach(function (id) {
    if (typeof refreshSelectPicker === 'function') refreshSelectPicker(document.getElementById(id));
  });
  document.getElementById('ci-class').value = r.class_name || '';
  document.getElementById('ci-notes').value = r.notes || '';
  setMealNeedPicker('ci-meal-need', mf.breakfast, mf.lunch, mf.dinner);
  document.getElementById('ci-resv-id').value = id;
  renderBedOptions();
}

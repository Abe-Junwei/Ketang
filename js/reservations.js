var RESERVATION_STATUS_PENDING = {};

document.getElementById("resv-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("resv-name").value.trim();
  const gender = document.getElementById("resv-gender").value;
  const checkIn = document.getElementById("resv-in").value;
  if (!name || !gender || !checkIn) {
    alert("请填写姓名、性别和预计入住日期");
    return;
  }
  const checkOut = document.getElementById("resv-out").value || null;
  if (checkOut && checkOut < checkIn) {
    alert("预计离院日期不能早于预计入住日期");
    return;
  }
  if (!validateFields(["resv-phone", "resv-idcard", "resv-emergency-phone"])) {
    scrollToFirstError(["resv-phone", "resv-idcard", "resv-emergency-phone"]);
    return;
  }
  const phoneRaw = document.getElementById("resv-phone").value.trim();
  const phone = phoneRaw ? phoneRaw.replace(/\s/g, "") : null;
  const idCard = document.getElementById("resv-idcard").value.trim();
  const contact = validateGuestContact({
    phone: phone,
    idCard: idCard,
    emergencyName: document.getElementById("resv-emergency-name").value.trim(),
    emergencyPhone: document
      .getElementById("resv-emergency-phone")
      .value.trim(),
  });
  if (!contact.ok) {
    alertGuestContactError(contact);
    return;
  }
  const person = parsePersonNameInput(name);
  const eventId = document.getElementById("resv-event").value || null;
  if (eventId) {
    const evt = query(
      "SELECT id FROM events WHERE id=? AND status != '已取消'",
      [eventId],
    )[0];
    if (!evt) {
      alert("所选营期不存在或已取消，请重新选择");
      return;
    }
  }
  const meal = readMealNeedPicker("resv-meal-need");
  if (!validateMealNeedPicker("resv-meal-need")) return;

  let participantTags;
  try {
    participantTags = readParticipantTagsFromForm("resv");
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  const resvId = document.getElementById("resv-id").value;
  const finishPending = beginActionPending(e, "保存中…");
  if (!finishPending) return;
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
      const guestId = findOrCreateGuest(
        person.name,
        gender,
        contact.phone,
        contact.idCard,
      );
      if (contact.emergencyName || contact.emergencyPhone) {
        run(
          "UPDATE guests SET emergency_contact = COALESCE(?, emergency_contact), emergency_phone = COALESCE(?, emergency_phone), updated_at = ? WHERE id = ?",
          [
            contact.emergencyName || null,
            contact.emergencyPhone || null,
            new Date().toISOString(),
            guestId,
          ],
        );
      }
      await withTransaction(async () => {
        if (resvId) {
          // 编辑模式 | Edit mode
          const existing = query("SELECT * FROM reservations WHERE id=?", [
            resvId,
          ])[0];
          if (!existing) {
            throw new Error("预约记录不存在");
          }
          if (existing.status === "已入住" || existing.status === "已取消") {
            throw new Error("已入住或已取消的预约不可编辑");
          }
          run(
            `UPDATE reservations SET
          guest_id=?, event_id=?, name=?, dharma_name=?, gender=?, phone=?, id_card=?,
          role=?, class_name=?, participant_identity=?, age_group=?, special_needs=?,
          expected_check_in=?, expected_check_out=?,
          room_preference=?, source=?, notes=?, meal_breakfast=?, meal_lunch=?, meal_dinner=?
          WHERE id=?`,
            [
              guestId,
              eventId,
              person.name,
              person.dharma_name,
              gender || null,
              contact.phone,
              contact.idCard,
              readLodgerRoleInput("resv-role"),
              document.getElementById("resv-class").value.trim() || null,
              ...Object.values(participantTags),
              checkIn,
              checkOut,
              document.getElementById("resv-room").value.trim() || null,
              document.getElementById("resv-source").value || null,
              document.getElementById("resv-notes").value.trim() || null,
              meal.breakfast,
              meal.lunch,
              meal.dinner,
              resvId,
            ],
          );
          logAudit("更新预约", "reservation", resvId, {
            guest_id: guestId,
            name: name,
          });
        } else {
          // 新增模式 | Add mode
          const result = run(
            `INSERT INTO reservations
          (guest_id, event_id, name, dharma_name, gender, phone, id_card, role, class_name, participant_identity, age_group, special_needs, expected_check_in, expected_check_out, room_preference, source, status, notes, meal_breakfast, meal_lunch, meal_dinner)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '预约', ?, ?, ?, ?)`,
            [
              guestId,
              eventId,
              person.name,
              person.dharma_name,
              gender || null,
              contact.phone,
              contact.idCard,
              readLodgerRoleInput("resv-role"),
              document.getElementById("resv-class").value.trim() || null,
              ...Object.values(participantTags),
              checkIn,
              checkOut,
              document.getElementById("resv-room").value.trim() || null,
              document.getElementById("resv-source").value || null,
              document.getElementById("resv-notes").value.trim() || null,
              meal.breakfast,
              meal.lunch,
              meal.dinner,
            ],
          );
          const newId = result.lastInsertId;
          logAudit("添加预约", "reservation", newId, {
            guest_id: guestId,
            name: name,
          });
        }
      });
      await saveDB();
    } else {
      writeResult = await apiUpsertReservation({
        reservation_id: resvId ? parseInt(resvId, 10) : null,
        name: name,
        gender: gender || null,
        phone: contact.phone,
        id_card: contact.idCard,
        emergency_name: contact.emergencyName || null,
        emergency_phone: contact.emergencyPhone || null,
        event_id: eventId,
        role: readLodgerRoleInput("resv-role"),
        class_name: document.getElementById("resv-class").value.trim() || null,
        ...participantTags,
        expected_check_in: checkIn,
        expected_check_out: checkOut,
        room_preference:
          document.getElementById("resv-room").value.trim() || null,
        source: document.getElementById("resv-source").value || null,
        notes: document.getElementById("resv-notes").value.trim() || null,
        meal_breakfast: meal.breakfast,
        meal_lunch: meal.lunch,
        meal_dinner: meal.dinner,
      });
    }
    showToast(resvId ? "预约更新成功" : "预约添加成功");
    resetResvForm();
    renderReservations("全部");
    rcRefreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("保存预约失败：" + e.message);
  } finally {
    finishPending();
  }
});

function resetResvForm() {
  document.getElementById("resv-form").reset();
  document.getElementById("resv-id").value = "";
  document.getElementById("resv-in").valueAsDate = new Date();
  setMealNeedPicker("resv-meal-need", 1, 1, 1);
  const btn = document.getElementById("resv-submit-btn");
  if (btn) btn.textContent = "添加预约";
  var form = document.getElementById("resv-form");
  if (form) {
    form.setAttribute("data-wizard-step", "1");
    if (typeof syncStayFormWizard === "function")
      syncStayFormWizard("resv-form");
  }
}

function editResv(id) {
  const r = reservationForStatus(id);
  if (!r) return;
  if (r.status === "已入住" || r.status === "已取消") {
    alert("已入住或已取消的预约不可编辑");
    return;
  }
  showView("reservations");
  document.getElementById("resv-id").value = r.id;
  document.getElementById("resv-name").value = personNameInputValue(r);
  document.getElementById("resv-gender").value = r.gender || "";
  document.getElementById("resv-phone").value = r.phone || "";
  document.getElementById("resv-idcard").value = r.id_card || "";
  const resvRoleSel = document.getElementById("resv-role");
  if (resvRoleSel) {
    resvRoleSel.innerHTML = roleSelectOptionsHtml(r.role || "");
    if (typeof rebuildSelectPicker === "function")
      rebuildSelectPicker(resvRoleSel);
  } else {
    document.getElementById("resv-role").value = r.role || "";
  }
  document.getElementById("resv-in").value = r.expected_check_in || "";
  document.getElementById("resv-out").value = r.expected_check_out || "";
  document.getElementById("resv-room").value = r.room_preference || "";
  populateEventSelect("resv-event", r.event_id || null);
  document.getElementById("resv-class").value = r.class_name || "";
  if (typeof populateParticipantTagSelects === "function") {
    populateParticipantTagSelects("resv", r);
  }
  document.getElementById("resv-source").value = r.source || "";
  document.getElementById("resv-notes").value = r.notes || "";
  if (r.guest_id) {
    const guest = guestEmergencyFields(r.guest_id);
    if (guest) {
      document.getElementById("resv-emergency-name").value =
        guest.emergency_contact || "";
      document.getElementById("resv-emergency-phone").value =
        guest.emergency_phone || "";
    }
  }
  const mf = reservationMealFlags(r);
  setMealNeedPicker("resv-meal-need", mf.breakfast, mf.lunch, mf.dinner);
  ["resv-gender", "resv-role", "resv-source", "resv-event"].forEach(
    function (selId) {
      if (typeof refreshSelectPicker === "function")
        refreshSelectPicker(document.getElementById(selId));
    },
  );
  const btn = document.getElementById("resv-submit-btn");
  if (btn) btn.textContent = "保存预约";
  document.getElementById("resv-name").focus();
}

function renderReservations(filterStatus) {
  populateEventSelect("resv-event", null);
  const tbody = document.getElementById("resv-table");
  tbody.innerHTML = "";
  const rows = reservationRowsForRender(filterStatus);
  rows.forEach((r) => {
    const pendingStatus = RESERVATION_STATUS_PENDING[r.id];
    const displayStatus = pendingStatus || r.status;
    const isPending = !!pendingStatus;
    const actionCell = isPending
      ? '<button type="button" class="btn btn-sm" disabled>保存中…</button>'
      : `${r.status === "预约" ? `<button class="btn btn-success btn-sm" onclick="updateResvStatus(event.currentTarget, ${r.id}, '已确认')">确认</button>` : ""}
        ${r.status === "预约" || r.status === "已确认" ? `<button class="btn btn-primary btn-sm" onclick="checkInFromResv(${r.id})">转入住</button>` : ""}
        ${r.status !== "已入住" && r.status !== "已取消" ? `<button class="btn btn-danger btn-sm" onclick="updateResvStatus(event.currentTarget, ${r.id}, '已取消')">取消</button>` : ""}
        ${r.status === "预约" || r.status === "已确认" ? `<button class="btn btn-warning btn-sm" onclick="updateResvStatus(event.currentTarget, ${r.id}, 'No-show')">No-show</button>` : ""}
        ${r.status === "预约" || r.status === "已确认" ? `<button class="btn btn-default btn-sm" onclick="editResv(${r.id})">编辑</button>` : ""}`;
    const mf = reservationMealFlags(r);
    const mealLabel = formatMealNeedLabel(mf.breakfast, mf.lunch, mf.dinner);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(personDisplayName(r))}</td>
      <td>${escapeHtml(r.gender) || "-"}</td>
      <td>${escapeHtml(r.phone) || "-"}</td>
      <td>${escapeHtml(r.expected_check_in) || "-"}</td>
      <td>${escapeHtml(r.expected_check_out) || "-"}</td>
      <td>${escapeHtml(mealLabel)}</td>
      <td>${escapeHtml(r.role) || "-"}</td>
      <td>${escapeHtml(r.room_preference) || "-"}</td>
      <td>${escapeHtml(displayStatus)}</td>
      <td>${escapeHtml(r.source) || "-"}</td>
      <td>${actionCell}</td>
    `;
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="11" class="empty-tip">无预约记录</td></tr>';
  }
}

function reservationRowsForRender(filterStatus) {
  if (
    !isLocalForceDb() &&
    typeof rcReadReady === "function" &&
    rcReadReady() &&
    typeof rcRows === "function"
  ) {
    return rcRows("reservations", "reservations")
      .filter(function (r) {
        return !filterStatus || filterStatus === "全部" || r.status === filterStatus;
      })
      .slice()
      .sort(function (a, b) {
        var da = a.expected_check_in || "";
        var db = b.expected_check_in || "";
        if (da !== db) return db.localeCompare(da);
        return (b.id || 0) - (a.id || 0);
      });
  }
  let sql = "SELECT * FROM reservations WHERE 1=1";
  const params = [];
  if (filterStatus && filterStatus !== "全部") {
    sql += " AND status = ?";
    params.push(filterStatus);
  }
  sql += " ORDER BY expected_check_in DESC, id DESC";
  return query(sql, params);
}

function reservationForStatus(id) {
  if (
    !isLocalForceDb() &&
    typeof rcReservationById === "function" &&
    typeof rcReadReady === "function" &&
    rcReadReady()
  ) {
    return rcReservationById(id);
  }
  return query("SELECT * FROM reservations WHERE id=?", [id])[0];
}

function guestEmergencyFields(guestId) {
  if (!guestId) return null;
  if (
    !isLocalForceDb() &&
    typeof rcGuestById === "function" &&
    typeof rcReadReady === "function" &&
    rcReadReady()
  ) {
    var g = rcGuestById(guestId);
    if (!g) return null;
    return {
      emergency_contact: g.emergency_contact || "",
      emergency_phone: g.emergency_phone || "",
    };
  }
  return (
    query("SELECT emergency_contact, emergency_phone FROM guests WHERE id=?", [
      guestId,
    ])[0] || null
  );
}

function applyReservationStatusOptimistic(row, status) {
  if (
    isLocalForceDb() ||
    !row ||
    typeof rcApplyDeltaPatches !== "function" ||
    typeof rcReadReady !== "function" ||
    !rcReadReady()
  ) {
    return null;
  }
  var original = Object.assign({}, row);
  rcApplyDeltaPatches(
    { reservations: [Object.assign({}, row, { status: status })] },
    [],
  );
  return original;
}

function rollbackReservationStatusOptimistic(original) {
  if (!original || typeof rcApplyDeltaPatches !== "function") return true;
  try {
    rcApplyDeltaPatches({ reservations: [original] }, []);
    return true;
  } catch (e) {
    console.warn("reservation optimistic rollback failed:", e.message || e);
    return false;
  }
}

async function forceRefreshReservations() {
  if (typeof rcEnsureReservations !== "function") return false;
  try {
    await rcEnsureReservations(true);
    return true;
  } catch (e) {
    console.warn("reservation force refresh failed:", e.message || e);
    return false;
  }
}

async function updateResvStatus(source, id, status) {
  if (RESERVATION_STATUS_PENDING[id]) return;
  const r = reservationForStatus(id);
  if (!r) return;
  const oldStatus = r.status;
  RESERVATION_STATUS_PENDING[id] = status;
  var original = applyReservationStatusOptimistic(r, status);
  renderReservations("全部");
  var writeResult = null;
  try {
    if (isLocalForceDb()) {
      await withTransaction(async () => {
        run("UPDATE reservations SET status=? WHERE id=?", [status, id]);
        logAudit("更新预约状态", "reservation", id, {
          name: r.name,
          from: oldStatus,
          to: status,
        });
      });
      await saveDB();
      writeResult = { ok: true, local: true };
    } else {
      writeResult = await apiUpdateReservationStatus({
        reservation_id: id,
        status: status,
      });
    }
    var rollbackOk = original ? rollbackReservationStatusOptimistic(original) : true;
    if (!rollbackOk) await forceRefreshReservations();
    showToast(`预约已标记为「${status}」`);
    if (rollbackOk) rcRefreshAfterWrite(writeResult, { skipViewRefresh: true });
  } catch (e) {
    console.error(e);
    var rollbackOk = rollbackReservationStatusOptimistic(original);
    var refreshOk = await forceRefreshReservations();
    if (!rollbackOk && !refreshOk) {
      alert("更新预约状态失败，且无法恢复最新数据，请手动刷新页面：" + e.message);
    } else {
      alert("更新预约状态失败：" + e.message);
    }
  } finally {
    delete RESERVATION_STATUS_PENDING[id];
    renderReservations("全部");
  }
}

function checkInFromResv(id) {
  const r = reservationForStatus(id);
  if (!r) return;
  if (r.status === "已取消" || r.status === "No-show") {
    alert("该预约已取消或 No-show，无法转入住");
    return;
  }
  const mf = reservationMealFlags(r);
  showView("checkin");
  document.getElementById("ci-name").value = personNameInputValue(r);
  document.getElementById("ci-gender").value = r.gender || "";
  document.getElementById("ci-phone").value = r.phone || "";
  document.getElementById("ci-idcard").value = r.id_card || "";
  if (r.guest_id) {
    const guest = guestEmergencyFields(r.guest_id);
    if (guest) {
      document.getElementById("ci-emergency-name").value =
        guest.emergency_contact || "";
      document.getElementById("ci-emergency-phone").value =
        guest.emergency_phone || "";
    }
  }
  const ciRoleSel = document.getElementById("ci-role");
  if (ciRoleSel) {
    ciRoleSel.innerHTML = roleSelectOptionsHtml(r.role || "");
    if (typeof rebuildSelectPicker === "function")
      rebuildSelectPicker(ciRoleSel);
  } else {
    document.getElementById("ci-role").value = r.role || "";
  }
  document.getElementById("ci-in").value = r.expected_check_in || todayStr();
  document.getElementById("ci-out").value = r.expected_check_out || "";
  document.getElementById("ci-source").value = r.source || "法会预约";
  populateEventSelect("ci-event", r.event_id || null);
  ["ci-gender", "ci-role", "ci-source"].forEach(function (id) {
    if (typeof refreshSelectPicker === "function")
      refreshSelectPicker(document.getElementById(id));
  });
  document.getElementById("ci-class").value = r.class_name || "";
  if (typeof populateParticipantTagSelects === "function") {
    populateParticipantTagSelects("ci", r);
  }
  document.getElementById("ci-notes").value = r.notes || "";
  setMealNeedPicker("ci-meal-need", mf.breakfast, mf.lunch, mf.dinner);
  document.getElementById("ci-resv-id").value = id;
  renderBedOptions();
}

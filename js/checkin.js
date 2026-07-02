function populateEventSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const html =
    '<option value="">散客 / 不归属营期</option>' +
    getEventOptionsHtml(selectedId, false);
  if (typeof rebuildSelectPicker === "function") rebuildSelectPicker(sel, html);
  else sel.innerHTML = html;
}

function renderBedPicker(options) {
  const dropdown = document.getElementById(options.dropdownId);
  if (!dropdown) return;

  const excludeId = parseInt(options.excludeBedId, 10) || -1;
  const gender = options.gender || "";
  const selectedRoomId = options.selectedRoomId || null;
  const selectedBedId = options.selectedBedId || null;
  const onSelect = options.onSelect || "selectBed";
  const spareRoomFilter = options.spareRoomFilter !== false;

  const rooms = query(
    `
    SELECT r.*, COUNT(b2.id) as total_beds,
      COUNT(CASE WHEN b2.status NOT IN ('维修','备用') AND b2.id != ?
        AND l2.id IS NULL
        AND (SELECT COALESCE(status,'净房') FROM housekeeping WHERE bed_id = b2.id ORDER BY changed_at DESC LIMIT 1) IN ('净房','可用')
        THEN 1 END) as avail
    FROM rooms r
    JOIN beds b2 ON b2.room_id = r.id
    LEFT JOIN lodgers l2 ON l2.bed_id = b2.id AND l2.status='在住'
    GROUP BY r.id
    ORDER BY r.floor ASC, r.id
  `,
    [excludeId],
  );

  let html = "";
  let hasAnyRoom = false;

  rooms.forEach(function (r) {
    if (spareRoomFilter && typeof isSpareRoom === "function" && isSpareRoom(r))
      return;
    if (gender === "男" && r.dorm_type === "女寮") return;
    if (gender === "女" && r.dorm_type === "男寮") return;
    hasAnyRoom = true;

    const isFull = (r.avail || 0) === 0;
    const dot = isFull ? "🔴" : "🟢";
    const dormLabel = r.dorm_type || "";
    const expanded =
      selectedRoomId && r.id == selectedRoomId ? " expanded" : "";

    html += `<div class="bp-room${expanded}" data-room="${r.id}">`;
    html += `<div class="bp-room-header" onclick="toggleRoom(event, ${r.id})">`;
    html += `<span class="bp-room-dot">${dot}</span>`;
    html += `<span>${escapeHtml(r.name)} (${escapeHtml(dormLabel)} · ${escapeHtml(r.location || "")})</span>`;
    if (isFull) html += '<span class="bp-room-full">已满</span>';
    html += '<span class="bp-room-arrow" aria-hidden="true">▸</span>';
    html += "</div>";

    html += '<div class="bp-room-beds">';
    if (!isFull) {
      const beds = query(
        `
        SELECT b.*,
          COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') as hk_status
        FROM beds b
        LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
        WHERE b.room_id = ? AND b.id != ? AND b.status NOT IN ('维修','备用') AND l.id IS NULL
        ORDER BY b.id
      `,
        [r.id, excludeId],
      );

      let hasBeds = false;
      beds.forEach(function (b) {
        if (b.hk_status !== "净房" && b.hk_status !== "可用") return;
        hasBeds = true;
        const bedLabel = escapeHtml(
          (b.bed_number || "") + " · " + (b.hk_status || ""),
        );
        const selClass =
          selectedBedId && b.id == selectedBedId ? " selected" : "";
        html += `<div class="bp-bed${selClass}" data-bed="${b.id}" data-label="${bedLabel}" onclick="${onSelect}(event, ${b.id})">`;
        html += escapeHtml(b.bed_number);
        html +=
          '<span class="bp-bed-status">' + escapeHtml(b.hk_status) + "</span>";
        html += "</div>";
      });
      if (!hasBeds) html += '<div class="bp-empty">无可用床位</div>';
    } else {
      html += '<div class="bp-empty">已满</div>';
    }
    html += "</div></div>";
  });

  dropdown.innerHTML = hasAnyRoom
    ? html
    : '<div class="bp-empty">' +
      (gender ? "没有符合性别要求的可用房间" : "暂无可选房间") +
      "</div>";
}

function renderBedOptions(selectedRoomId, selectedBedId) {
  const genderSel = document.getElementById("ci-gender");
  const gender = genderSel ? genderSel.value : "";

  renderBedPicker({
    dropdownId: "ci-bed-dropdown",
    selectedBedId: selectedBedId,
    gender: gender,
    selectedRoomId: selectedRoomId,
    onSelect: "selectBed",
  });

  // 预选回显 | Pre-select display
  if (selectedBedId) {
    const selBed = query(
      "SELECT b.*, r.name as room_name FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
      [selectedBedId],
    )[0];
    if (selBed) {
      updateBedLabel(selBed.room_name + " / " + (selBed.bed_number || ""));
    }
  }
}

// 切换下拉面板 | Toggle dropdown
function toggleBedPicker() {
  const picker = document.getElementById("ci-bed-picker");
  picker.classList.toggle("open");
}

// 展开/折叠房间 | Expand/collapse room (scoped to clicked header)
function toggleRoom(e, roomId) {
  e.stopPropagation();
  let room = e.currentTarget && e.currentTarget.closest(".bp-room");
  if (!room && roomId)
    room = document.querySelector('.bp-room[data-room="' + roomId + '"]');
  if (room) room.classList.toggle("expanded");
}

// 选择床位 | Select bed
function selectBed(e, bedId) {
  e.stopPropagation();
  const el = document.querySelector('.bp-bed[data-bed="' + bedId + '"]');
  const label = el && el.dataset.label ? el.dataset.label : String(bedId);
  document.getElementById("ci-bed").value = bedId;
  updateBedLabel(label);

  // 高亮选中 | Highlight selected
  document.querySelectorAll(".bp-bed").forEach(function (row) {
    row.classList.remove("selected");
  });
  if (el) el.classList.add("selected");

  // 关闭下拉 | Close dropdown
  document.getElementById("ci-bed-picker").classList.remove("open");
}

function updateBedLabel(text) {
  document.getElementById("ci-bed-label").textContent = text;
}

// 点击外部关闭 | Close on outside click
document.addEventListener("click", function (e) {
  ["ci-bed-picker", "chg-bed-picker"].forEach(function (id) {
    let picker = document.getElementById(id);
    if (picker && !picker.contains(e.target)) picker.classList.remove("open");
  });
});

function openCheckinForRoom(roomId) {
  showView("checkin");
  renderBedOptions(roomId);
  document.getElementById("ci-name").focus();
}

// 从房态看板点击空床位：优先分配已有挂单/预约 | Assign existing lodger/reservation first
function openCheckinForBed(bedId) {
  openAssignBedModal(bedId);
}

function openNewCheckinForBed(bedId) {
  closeModal();
  showView("checkin");
  renderBedOptions();
  const bed = query(
    "SELECT b.*, r.name as room_name FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
    [bedId],
  )[0];
  if (bed) {
    document.getElementById("ci-bed").value = bedId;
    updateBedLabel(escapeHtml(bed.room_name + " / " + (bed.bed_number || "")));
  }
  document.getElementById("ci-name").focus();
}

function renderAssignPickRow(kind, id, bedId, title, meta) {
  const fn =
    kind === "lodger" ? "assignExistingLodgerToBed" : "assignReservationToBed";
  return (
    '<button type="button" class="assign-pick-item ui-menu-item" onclick="' +
    fn +
    "(" +
    id +
    "," +
    bedId +
    ')">' +
    '<span class="assign-pick-text">' +
    '<span class="assign-pick-name">' +
    title +
    "</span>" +
    '<span class="assign-pick-meta">' +
    meta +
    "</span>" +
    "</span>" +
    "</button>"
  );
}

function renderAssignPickSection(title, emptyTip, rowsHtml) {
  return (
    '<div class="assign-pick-section">' +
    '<div class="assign-pick-section-title">' +
    escapeHtml(title) +
    "</div>" +
    '<div class="assign-pick-list">' +
    (rowsHtml ||
      '<p class="empty-tip assign-pick-empty">' +
        escapeHtml(emptyTip) +
        "</p>") +
    "</div>" +
    "</div>"
  );
}

function openAssignBedModal(bedId) {
  const bed = query(
    "SELECT b.*, r.name as room_name, r.dorm_type FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
    [bedId],
  )[0];
  if (!bed) return;
  if (!isBedAssignable(bedId)) {
    alert("该床位当前不可分配（可能未清洁或已占用）");
    return;
  }

  const lodgers = query(`
    SELECT l.* FROM lodgers l
    WHERE l.status = '在住' AND (l.bed_id IS NULL OR l.bed_id = '')
    ORDER BY l.check_in_date ASC, l.id ASC
  `).filter(function (l) {
    return dormMatchGender(bed.dorm_type, l.gender);
  });

  const reservations = query(`
    SELECT * FROM reservations
    WHERE status IN ('预约', '已确认')
    ORDER BY expected_check_in ASC, id ASC
  `).filter(function (r) {
    return dormMatchGender(bed.dorm_type, r.gender);
  });

  const lodgerRows = lodgers
    .map(function (l) {
      const title = escapeHtml(personDisplayName(l));
      const metaParts = [];
      if (l.check_in_date) metaParts.push("入住 " + l.check_in_date);
      if (l.role) metaParts.push(l.role);
      if (l.phone) metaParts.push(l.phone);
      return renderAssignPickRow(
        "lodger",
        l.id,
        bedId,
        title,
        escapeHtml(metaParts.join(" · ") || "已登记"),
      );
    })
    .join("");

  const resvRows = reservations
    .map(function (r) {
      const title = escapeHtml(personDisplayName(r));
      const metaParts = [];
      if (r.expected_check_in) metaParts.push("预计 " + r.expected_check_in);
      if (r.status) metaParts.push(r.status);
      if (r.room_preference) metaParts.push("意向 " + r.room_preference);
      return renderAssignPickRow(
        "reservation",
        r.id,
        bedId,
        title,
        escapeHtml(metaParts.join(" · ") || "预约"),
      );
    })
    .join("");

  const bedLabel = escapeHtml(bed.room_name + " / " + (bed.bed_number || ""));
  setModalBody(
    '<div class="modal-form assign-bed-modal">' +
      '<div class="modal-summary">' +
      '<p><span class="modal-summary-label">目标床位</span>' +
      bedLabel +
      "</p>" +
      '<p class="modal-summary-muted">优先选择已登记或预约待入住的客人；也可新建登记。</p>' +
      "</div>" +
      renderAssignPickSection(
        "已登记 · 未分床",
        "暂无已登记未分床的客人",
        lodgerRows,
      ) +
      renderAssignPickSection("预约 · 待入住", "暂无待入住预约", resvRows) +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-default" onclick="closeModal()">取消</button>' +
      '<button type="button" class="btn btn-primary" onclick="openNewCheckinForBed(' +
      bedId +
      ')">新建登记</button>' +
      "</div>" +
      "</div>",
  );
  document.getElementById("modal-title").textContent = "分配床位";
  document.getElementById("modal").classList.add("active");
}

async function assignExistingLodgerToBed(lodgerId, bedId) {
  const l = query("SELECT * FROM lodgers WHERE id=? AND status='在住'", [
    lodgerId,
  ])[0];
  if (!l) {
    alert("挂单不存在或已不在住");
    return;
  }
  if (l.bed_id) {
    alert("该挂单已有床位");
    return;
  }
  const bed = query(
    "SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
    [bedId],
  )[0];
  if (!bed) return;
  if (!dormMatchGender(bed.dorm_type, l.gender)) {
    alert("该床位所在房间寮类型不符");
    return;
  }
  if (!isBedAssignable(bedId)) {
    alert("该床位当前不可分配");
    return;
  }
  try {
    if (useRemoteWriteApi()) {
      await apiAssignBed({ lodger_id: lodgerId, bed_id: parseInt(bedId, 10) });
    } else {
      await withTransaction(async () => {
        run("UPDATE lodgers SET bed_id=? WHERE id=? AND status='在住'", [
          bedId,
          lodgerId,
        ]);
        run("UPDATE beds SET status='占用' WHERE id=?", [bedId]);
        setHouseStatus(bedId, "占用", "分配床位");
        logAudit("分配床位", "lodger", lodgerId, {
          guest_id: l.guest_id,
          bed_id: bedId,
          name: l.name,
        });
        await ensureLodgerMeals(lodgerId);
      });
      await saveDB();
    }
    closeModal();
    showToast("已分配床位");
    refreshAfterWrite();
  } catch (e) {
    console.error(e);
    alert("分配床位失败：" + e.message);
  }
}

async function assignReservationToBed(resvId, bedId) {
  const r = query("SELECT * FROM reservations WHERE id=?", [resvId])[0];
  if (!r || (r.status !== "预约" && r.status !== "已确认")) {
    alert("该预约当前不可分配床位");
    return;
  }
  const bed = query(
    "SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
    [bedId],
  )[0];
  if (!bed) return;
  if (!dormMatchGender(bed.dorm_type, r.gender)) {
    alert("该床位所在房间寮类型不符");
    return;
  }
  if (!isBedAssignable(bedId)) {
    alert("该床位当前不可分配");
    return;
  }
  const checkIn = r.expected_check_in || todayStr();
  const checkOut = r.expected_check_out || null;
  if (checkOut && checkOut < checkIn) {
    alert("预约离院日期不能早于入住日期");
    return;
  }
  try {
    if (useRemoteWriteApi()) {
      await apiAssignBed({
        reservation_id: parseInt(resvId, 10),
        bed_id: parseInt(bedId, 10),
      });
    } else {
      await withTransaction(async () => {
        const rNow = query("SELECT status FROM reservations WHERE id=?", [
          resvId,
        ])[0];
        if (!rNow || (rNow.status !== "预约" && rNow.status !== "已确认")) {
          throw new Error("该预约状态已变更，请刷新后重试");
        }
        const person = mergePersonNameFields(r.name, r.dharma_name);
        const guestId =
          r.guest_id ||
          findOrCreateGuest(person.name, r.gender, r.phone, r.id_card);
        incrementGuestVisit(guestId, checkIn);
        const result = run(
          `INSERT INTO lodgers
        (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', ?, ?)`,
          [
            guestId,
            r.event_id || null,
            person.name,
            person.dharma_name,
            r.gender || null,
            r.phone || null,
            r.id_card || null,
            checkIn,
            checkOut,
            bedId,
            r.role || null,
            r.class_name || null,
            r.source || "预约分配",
            r.notes || null,
          ],
        );
        const lodgerId = result.lastInsertId;
        run("UPDATE beds SET status='占用' WHERE id=?", [bedId]);
        setHouseStatus(bedId, "占用", "预约分配床位");
        run("UPDATE reservations SET status='已入住' WHERE id=?", [resvId]);
        const mf = reservationMealFlags(r);
        await generateMeals(
          lodgerId,
          checkIn,
          checkOut,
          mf.breakfast,
          mf.lunch,
          mf.dinner,
        );
        logAudit("预约分配床位", "lodger", lodgerId, {
          guest_id: guestId,
          bed_id: bedId,
          reservation_id: resvId,
          name: r.name,
        });
        logAudit("预约转入住", "reservation", resvId, { lodger_id: lodgerId });
      });
      await saveDB();
    }
    closeModal();
    showToast("已分配床位");
    refreshAfterWrite();
  } catch (e) {
    console.error(e);
    alert("分配床位失败：" + e.message);
  }
}

document
  .getElementById("checkin-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const bedId = document.getElementById("ci-bed").value;
    if (!bedId) {
      alert("请选择床位");
      return;
    }
    const bed = query(
      `
    SELECT b.*, r.dorm_type
    FROM beds b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?
  `,
      [bedId],
    )[0];
    const gender = document.getElementById("ci-gender").value;
    if (bed.dorm_type !== "不限" && !dormMatchGender(bed.dorm_type, gender)) {
      alert(`该房间为「${bed.dorm_type}」，请选择对应床位。`);
      return;
    }
    if (!isBedAssignable(bedId)) {
      alert("该床位当前不可分配（可能未清洁或已占用），请选择其他床位。");
      return;
    }

    // 批量校验所有字段 | Batch validate all fields
    if (!validateFields(["ci-name", "ci-phone", "ci-idcard"])) {
      scrollToFirstError(["ci-name", "ci-phone", "ci-idcard"]);
      return;
    }

    const name = document.getElementById("ci-name").value.trim();
    // 手机号存入时去掉空格 | Strip spaces from phone before saving
    const phoneRaw = document.getElementById("ci-phone").value.trim();
    const phone = phoneRaw ? phoneRaw.replace(/\s/g, "") : null;
    const idCard = document.getElementById("ci-idcard").value.trim() || null;

    const checkIn = document.getElementById("ci-in").value;
    const checkOut = document.getElementById("ci-out").value || null;
    if (checkOut && checkOut < checkIn) {
      alert("预离日期不能早于入住日期");
      return;
    }
    if (!validateMealNeedPicker("ci-meal-need")) return;
    const ciMeal = readMealNeedPicker("ci-meal-need");

    const dup = checkDuplicate(phone, idCard);
    if (dup) {
      const info =
        personDisplayName(dup) + (dup.phone ? " · " + dup.phone : "");
      if (
        !confirm(`检测到该手机号/身份证已有在住记录：${info}\n是否继续登记？`)
      )
        return;
    }

    // 预约转入住重校验 | Re-validate reservation status at submit time
    const resvId = document.getElementById("ci-resv-id").value;
    if (resvId) {
      const rsv = query("SELECT * FROM reservations WHERE id=?", [resvId])[0];
      if (!rsv || !["预约", "已确认"].includes(rsv.status)) {
        alert("该预约状态已变更，请重新选择预约或取消关联。");
        document.getElementById("ci-resv-id").value = "";
        return;
      }
    }

    try {
      if (useRemoteWriteApi()) {
        await apiCheckIn({
          bed_id: parseInt(bedId, 10),
          name: name,
          gender: gender || null,
          phone: phone,
          id_card: idCard,
          check_in_date: checkIn,
          expected_check_out: checkOut,
          event_id: document.getElementById("ci-event").value || null,
          role: readLodgerRoleInput("ci-role"),
          class_name: document.getElementById("ci-class").value.trim() || null,
          source: document.getElementById("ci-source").value || null,
          notes: document.getElementById("ci-notes").value.trim() || null,
          emergency_name:
            document.getElementById("ci-emergency-name").value.trim() || null,
          emergency_phone:
            document.getElementById("ci-emergency-phone").value.trim() || null,
          meal_breakfast: ciMeal.breakfast,
          meal_lunch: ciMeal.lunch,
          meal_dinner: ciMeal.dinner,
          deposit: parseFloat(document.getElementById("ci-deposit").value) || 0,
          room_fee:
            parseFloat(document.getElementById("ci-room-fee").value) || 0,
          pay_method: document.getElementById("ci-pay-method").value || null,
          pay_remark:
            document.getElementById("ci-pay-remark").value.trim() || null,
          reservation_id: resvId ? parseInt(resvId, 10) : null,
        });
      } else {
        await withTransaction(async () => {
          const person = parsePersonNameInput(name);
          const guestId = findOrCreateGuest(
            person.name,
            gender || null,
            phone,
            idCard,
          );
          incrementGuestVisit(guestId, checkIn);

          // 更新客人紧急联系人信息
          const emergencyName =
            document.getElementById("ci-emergency-name").value.trim() || null;
          const emergencyPhone =
            document.getElementById("ci-emergency-phone").value.trim() || null;
          if (emergencyName || emergencyPhone) {
            run(
              "UPDATE guests SET emergency_contact = COALESCE(?, emergency_contact), emergency_phone = COALESCE(?, emergency_phone), updated_at = ? WHERE id = ?",
              [
                emergencyName,
                emergencyPhone,
                new Date().toISOString(),
                guestId,
              ],
            );
          }

          const result = run(
            `INSERT INTO lodgers
        (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', ?, ?)`,
            [
              guestId,
              document.getElementById("ci-event").value || null,
              person.name,
              person.dharma_name,
              gender || null,
              phone,
              idCard,
              checkIn,
              checkOut,
              bedId,
              readLodgerRoleInput("ci-role"),
              document.getElementById("ci-class").value.trim() || null,
              document.getElementById("ci-source").value || null,
              document.getElementById("ci-notes").value.trim() || null,
            ],
          );
          // 同步更新床位状态为占用 | Sync bed status to occupied
          run("UPDATE beds SET status='占用' WHERE id=?", [bedId]);
          setHouseStatus(bedId, "占用", "办理入住");

          const lodgerId = result.lastInsertId;
          await generateMeals(
            lodgerId,
            checkIn,
            checkOut,
            ciMeal.breakfast,
            ciMeal.lunch,
            ciMeal.dinner,
          );

          // 收款记录
          const deposit =
            parseFloat(document.getElementById("ci-deposit").value) || 0;
          const roomFee =
            parseFloat(document.getElementById("ci-room-fee").value) || 0;
          const payMethod =
            document.getElementById("ci-pay-method").value || null;
          const payRemark =
            document.getElementById("ci-pay-remark").value.trim() || null;
          if (deposit > 0) {
            run(
              "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '押金', ?, ?, ?)",
              [lodgerId, deposit, payMethod, payRemark],
            );
          }
          if (roomFee > 0) {
            run(
              "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '房费', ?, ?, ?)",
              [lodgerId, roomFee, payMethod, payRemark],
            );
          }
          if (deposit > 0 || roomFee > 0) {
            logAudit("收款", "lodger", lodgerId, {
              guest_id: guestId,
              name: name,
              deposit: deposit,
              room_fee: roomFee,
              method: payMethod,
            });
          }

          logAudit("入住登记", "lodger", lodgerId, {
            guest_id: guestId,
            bed_id: bedId,
            name: name,
          });

          // 若从预约转入住，更新预约状态
          if (resvId) {
            const rsvNow = query("SELECT status FROM reservations WHERE id=?", [
              resvId,
            ])[0];
            if (rsvNow && ["预约", "已确认"].includes(rsvNow.status)) {
              run("UPDATE reservations SET status='已入住' WHERE id=?", [
                resvId,
              ]);
              logAudit("预约转入住", "reservation", resvId, {
                lodger_id: lodgerId,
              });
            }
          }
        });
        await saveDB();
      }
      document.getElementById("ci-resv-id").value = "";
      showToast("入住登记成功");
      resetCheckin();
      showView("board");
      refreshAfterWrite();
    } catch (err) {
      console.error(err);
      alert("入住登记失败：" + err.message);
    }
  });

function resetCheckin() {
  document.getElementById("checkin-form").reset();
  document.getElementById("ci-in").valueAsDate = new Date();
  setMealNeedPicker("ci-meal-need", 1, 1, 1);
  document.getElementById("ci-deposit").value = "";
  document.getElementById("ci-room-fee").value = "";
  document.getElementById("ci-pay-remark").value = "";
  document.getElementById("ci-resv-id").value = "";
  populateEventSelect("ci-event", null);
  renderBedOptions();
}

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur);
  return result;
}

function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length < 2) return rows;
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const get = (arr, names) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx >= 0) return (arr[idx] || "").trim();
    }
    return "";
  };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const merged = mergePersonNameFields(
      get(cols, ["姓名/法名", "姓名", "name"]),
      get(cols, ["法名", "dharma_name"]),
    );
    rows.push({
      name: merged.name,
      dharma_name: merged.dharma_name,
      gender: get(cols, ["性别", "gender"]),
      phone: get(cols, ["手机号", "手机", "phone"]),
      id_card: get(cols, ["身份证", "id_card", "idCard"]),
      role: get(cols, ["身份", "role"]),
      check_in_date: get(cols, ["入住日期", "check_in_date", "checkIn"]),
      expected_check_out: get(cols, [
        "预离日期",
        "expected_check_out",
        "checkOut",
      ]),
      event_name: get(cols, [
        "营期",
        "event",
        "团体批次",
        "group_code",
        "group",
      ]),
      class_name: get(cols, ["班级", "class", "分组"]),
      room_preference: get(cols, ["房间偏好", "room_preference", "room"]),
      notes: get(cols, ["备注", "notes"]),
    });
  }
  return rows;
}

function findAssignableBed(gender, roomPreference) {
  // 优先按房间偏好匹配
  if (roomPreference) {
    const exact = query(
      `
      SELECT b.*, r.name as room_name, r.dorm_type
      FROM beds b
      JOIN rooms r ON r.id = b.room_id
      LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
      WHERE b.status != '维修' AND b.status != '备用' AND l.id IS NULL AND (r.name LIKE ? OR r.location LIKE ?)
      ORDER BY b.id
      LIMIT 1
    `,
      ["%" + roomPreference + "%", "%" + roomPreference + "%"],
    );
    for (const b of exact) {
      const hk = getHouseStatus(b.id);
      if (
        (hk === "净房" || hk === "可用") &&
        dormMatchGender(b.dorm_type, gender)
      )
        return b;
    }
  }
  // 按性别匹配
  const beds = query(`
    SELECT b.*, r.name as room_name, r.dorm_type
    FROM beds b
    JOIN rooms r ON r.id = b.room_id
    LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
    WHERE b.status != '维修' AND b.status != '备用' AND l.id IS NULL
    ORDER BY r.id, b.id
  `);
  for (const b of beds) {
    const hk = getHouseStatus(b.id);
    if (
      (hk === "净房" || hk === "可用") &&
      dormMatchGender(b.dorm_type, gender)
    )
      return b;
  }
  return null;
}

async function importBatchCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const resultDiv = document.getElementById("batch-result");
  resultDiv.innerHTML = "<p>正在解析...</p>";
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length === 0) {
        resultDiv.innerHTML = '<p class="empty-tip">未读取到有效数据</p>';
        return;
      }

      if (!validateMealNeedPicker("batch-meal-need")) {
        resultDiv.innerHTML =
          '<p class="field-error">请选择用斋默认（至少选一餐）</p>';
        return;
      }
      const batchMeal = readMealNeedPicker("batch-meal-need");
      const breakfast = batchMeal.breakfast;
      const lunch = batchMeal.lunch;
      const dinner = batchMeal.dinner;

      if (useRemoteWriteApi()) {
        resultDiv.innerHTML = "<p>正在导入云端...</p>";
        const result = await apiBatchCheckIn({
          rows: rows,
          meal_breakfast: breakfast,
          meal_lunch: lunch,
          meal_dinner: dinner,
        });
        const failedRows = (result.failed || []).map(function (item) {
          return (
            "第 " +
            item.line +
            " 行（" +
            (item.name || "") +
            "）：" +
            item.error
          );
        });
        const success = result.success || 0;
        const fail = result.fail != null ? result.fail : failedRows.length;
        resultDiv.innerHTML = `
        <p>导入完成：成功 ${success} 条，失败 ${fail} 条。</p>
        ${failedRows.length ? "<details><summary>失败明细</summary><pre>" + escapeHtml(failedRows.join("\n")) + "</pre></details>" : ""}
      `;
        showToast(`批量导入完成：成功 ${success} 条`);
        refreshAfterWrite();
        return;
      }

      const today = todayStr();
      let success = 0,
        fail = 0,
        failedRows = [];

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        try {
          if (!row.name || !row.gender) {
            throw new Error("姓名/性别缺失");
          }
          const checkIn = row.check_in_date || today;
          const checkOut = row.expected_check_out || null;
          if (checkOut && checkOut < checkIn) {
            throw new Error("预离日期早于入住日期");
          }

          const bed = findAssignableBed(row.gender, row.room_preference);
          if (!bed) {
            throw new Error("无可用床位");
          }

          const evt = row.event_name
            ? findEventByName(row.event_name) || null
            : null;
          const guestId = findOrCreateGuest(
            row.name,
            row.gender,
            row.phone || null,
            row.id_card || null,
          );
          incrementGuestVisit(guestId, checkIn);

          await withTransaction(async () => {
            const result = run(
              `INSERT INTO lodgers
              (guest_id, event_id, name, dharma_name, gender, phone, id_card, check_in_date, expected_check_out, bed_id, role, class_name, status, source, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在住', '法会批量导入', ?)`,
              [
                guestId,
                evt ? evt.id : null,
                row.name,
                row.dharma_name || null,
                row.gender,
                row.phone || null,
                row.id_card || null,
                checkIn,
                checkOut,
                bed.id,
                row.role || null,
                row.class_name || null,
                row.notes || null,
              ],
            );
            const lodgerId = result.lastInsertId;
            run("UPDATE beds SET status='占用' WHERE id=?", [bed.id]);
            setHouseStatus(bed.id, "占用", "法会批量导入");
            await generateMeals(
              lodgerId,
              checkIn,
              checkOut,
              breakfast,
              lunch,
              dinner,
            );
            logAudit("批量导入入住", "lodger", lodgerId, {
              guest_id: guestId,
              bed_id: bed.id,
              name: row.name,
            });
          });
          success++;
        } catch (err) {
          fail++;
          failedRows.push(
            `第 ${idx + 2} 行（${row.name || ""}）：${err.message}`,
          );
        }
      }

      await saveDB();
      resultDiv.innerHTML = `
        <p>导入完成：成功 ${success} 条，失败 ${fail} 条。</p>
        ${failedRows.length ? "<details><summary>失败明细</summary><pre>" + escapeHtml(failedRows.join("\n")) + "</pre></details>" : ""}
      `;
      showToast(`批量导入完成：成功 ${success} 条`);
      refreshAfterWrite();
    } catch (err) {
      resultDiv.innerHTML =
        '<p style="color:var(--color-danger)">导入出错：' +
        escapeHtml(err.message) +
        "</p>";
    }
  };
  reader.readAsText(file);
  input.value = "";
}

function downloadBatchTemplate() {
  const headers = [
    "姓名/法名",
    "性别",
    "手机号",
    "身份证",
    "身份",
    "入住日期",
    "预离日期",
    "营期",
    "班级",
    "房间偏好",
    "备注",
  ];
  const sample = [
    "张三",
    "男",
    "13800138000",
    "",
    "客人",
    todayStr(),
    "",
    "2026-06-水陆法会",
    "一班",
    "男众",
    "",
  ];
  const blob = new Blob(
    ["\uFEFF" + headers.join(",") + "\n" + sample.join(",") + "\n"],
    { type: "text/csv;charset=utf-8;" },
  );
  downloadBlob(blob, "batch_import_template.csv");
}

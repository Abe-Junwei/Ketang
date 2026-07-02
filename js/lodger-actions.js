// 床位/挂单操作菜单 | Single trigger + popover menu for lodger actions
function renderBedActionMenu(lodgerId) {
  let id = lodgerId;
  function item(action, iconName, label, extraCls) {
    return (
      '<button type="button" class="bed-action-item ui-menu-item' +
      (extraCls ? " " + extraCls : "") +
      '" role="menuitem" onclick="event.stopPropagation(); closeBedActionMenus(); ' +
      action +
      "(" +
      id +
      ')">' +
      icon(iconName, "icon-xs") +
      "<span>" +
      label +
      "</span>" +
      "</button>"
    );
  }
  return (
    '<div class="bed-action-menu" data-lodger-id="' +
    id +
    '" onclick="event.stopPropagation()">' +
    '<button type="button" class="bed-action-trigger bed-action-trigger-icon" onclick="event.stopPropagation(); toggleBedActionMenu(this)" aria-haspopup="menu" aria-expanded="false" aria-label="操作" title="操作">' +
    icon("more", "icon-xs") +
    "</button>" +
    '<div class="bed-action-popover ui-menu" role="menu">' +
    item("openMealModal", "dawn", "用斋") +
    item("openExtendModal", "extend", "续住") +
    item("openChangeBedModal", "swap", "换床") +
    item("openCheckoutModal", "checkout", "退房") +
    item(
      "deleteLodger",
      "delete",
      "删除",
      "bed-action-item-danger ui-menu-item-danger",
    ) +
    "</div>" +
    "</div>"
  );
}

function closeBedActionMenus() {
  document.querySelectorAll(".bed-action-menu.open").forEach(function (menu) {
    menu.classList.remove("open");
    const trigger = menu.querySelector(".bed-action-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    const popover = menu.querySelector(".bed-action-popover");
    if (popover) {
      popover.classList.remove("bed-action-popover-fixed");
      popover.style.top = "";
      popover.style.left = "";
    }
  });
}

function toggleBedActionMenu(triggerEl) {
  const menu = triggerEl.closest(".bed-action-menu");
  if (!menu) return;
  const wasOpen = menu.classList.contains("open");
  closeBedActionMenus();
  if (typeof closeAllSelectPickers === "function") closeAllSelectPickers();
  if (wasOpen) return;

  menu.classList.add("open");
  triggerEl.setAttribute("aria-expanded", "true");
  const popover = menu.querySelector(".bed-action-popover");
  if (!popover) return;

  popover.classList.add("bed-action-popover-fixed");
  popover.style.visibility = "hidden";
  const tr = triggerEl.getBoundingClientRect();
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  let top = tr.bottom + 4;
  let left = tr.right - pw;
  if (top + ph > window.innerHeight - 8) top = tr.top - ph - 4;
  if (left < 8) left = Math.max(8, tr.left);
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  popover.style.top = top + "px";
  popover.style.left = left + "px";
  popover.style.visibility = "";
}

function openLodgerActions(id) {
  closeBedActionMenus();
  const menu = document.querySelector(
    '.bed-action-menu[data-lodger-id="' + id + '"]',
  );
  if (menu) {
    const trigger = menu.querySelector(".bed-action-trigger");
    if (trigger) toggleBedActionMenu(trigger);
    return;
  }
  openExtendModal(id);
}

document.addEventListener("click", function (e) {
  if (e.target.closest(".bed-action-menu")) return;
  closeBedActionMenus();
});

function openExtendModal(id) {
  const l = query(
    "SELECT l.*, r.name as room_name, b.bed_number FROM lodgers l LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.id=?",
    [id],
  )[0];
  const label = escapeHtml(
    (l.room_name || "-") + (l.bed_number ? " / " + l.bed_number : ""),
  );
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "续住 - " + escapeHtml(personDisplayName(l));
  setModalBody(`
    <div class="modal-form">
      <div class="modal-summary">
        <p><span class="modal-summary-label">当前床位</span>${label}</p>
        <p class="modal-summary-muted">当前预离：${escapeHtml(l.expected_check_out) || "未填写"}</p>
      </div>
      <div class="field">
        <label>新预计离院日期</label>
        <input type="date" id="ext-date" value="${escapeHtml(l.expected_check_out) || ""}" min="${escapeHtml(l.check_in_date)}">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" onclick="submitExtend(${l.id})">确认续住</button>
      </div>
    </div>
  `);
  modal.classList.add("active");
}

async function submitExtend(id) {
  const date = document.getElementById("ext-date").value;
  if (!date) {
    alert("请选择新的预离日期");
    return;
  }
  const l = query("SELECT * FROM lodgers WHERE id=?", [id])[0];
  if (date < l.check_in_date) {
    alert("预离日期不能早于入住日期");
    return;
  }
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiExtendStay({ lodger_id: id, expected_check_out: date });
    } else {
      await withTransaction(async () => {
        run(
          "UPDATE lodgers SET expected_check_out=? WHERE id=? AND status='在住'",
          [date, id],
        );
        logAudit("续住", "lodger", id, {
          guest_id: l.guest_id,
          name: l.name,
          new_check_out: date,
        });
        // 续住后同步用斋日期范围：缩短时清理超期记录，延长/不变时补充新日期
        const defaults = getLodgerMealDefaults(l);
        run("DELETE FROM meals WHERE lodger_id=? AND date>?", [id, date]);
        const existing = query(
          "SELECT date FROM meals WHERE lodger_id=? ORDER BY date DESC LIMIT 1",
          [id],
        )[0];
        const start = existing
          ? formatLocalDate(
              new Date(
                new Date(existing.date + "T12:00:00").getTime() + 86400000,
              ),
            )
          : l.check_in_date;
        await generateMeals(
          id,
          start,
          date,
          defaults.breakfast,
          defaults.lunch,
          defaults.dinner,
        );
      });
      await saveDB();
    }
    closeModal();
    showToast("续住成功");
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("续住失败：" + e.message);
  }
}

function openChangeBedModal(id) {
  const l = query(
    "SELECT l.*, r.name as room_name, b.bed_number, r.dorm_type FROM lodgers l LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.id=?",
    [id],
  )[0];
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "换床 - " + escapeHtml(personDisplayName(l));
  setModalBody(`
    <div class="modal-form">
      <div class="modal-summary">
        <p><span class="modal-summary-label">当前床位</span>${escapeHtml(l.room_name || "-")} / ${escapeHtml(l.bed_number || "-")}</p>
      </div>
      <div class="field">
        <label>选择新床位</label>
        <div class="bed-picker" id="chg-bed-picker">
          <button type="button" class="bed-picker-trigger" onclick="toggleChangeBedPicker()">
            <span id="chg-bed-label">点击展开房间，再选床位</span>
            <span class="bed-picker-arrow" aria-hidden="true">▾</span>
          </button>
          <div class="bed-picker-dropdown" id="chg-bed-dropdown"></div>
        </div>
        <input type="hidden" id="chg-bed" value="">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-warning" onclick="submitChangeBed(${l.id}, '${escapeHtml(l.gender || "")}')">确认换床</button>
      </div>
    </div>
  `);
  renderChangeBedOptions(l.bed_id, l.gender || "");
  modal.classList.add("active");
}

function renderChangeBedOptions(excludeBedId, gender) {
  renderBedPicker({
    dropdownId: "chg-bed-dropdown",
    excludeBedId: excludeBedId,
    gender: gender,
    onSelect: "selectChangeBed",
  });
}

function toggleChangeBedPicker() {
  const picker = document.getElementById("chg-bed-picker");
  if (picker) picker.classList.toggle("open");
}

function selectChangeBed(e, bedId) {
  e.stopPropagation();
  let hidden = document.getElementById("chg-bed");
  const labelEl = document.getElementById("chg-bed-label");
  const el = document.querySelector(
    '#chg-bed-dropdown .bp-bed[data-bed="' + bedId + '"]',
  );
  let label = el && el.dataset.label ? el.dataset.label : String(bedId);
  if (hidden) hidden.value = bedId;
  if (labelEl) labelEl.textContent = label;
  document
    .querySelectorAll("#chg-bed-dropdown .bp-bed")
    .forEach(function (row) {
      row.classList.remove("selected");
    });
  if (el) el.classList.add("selected");
  const picker = document.getElementById("chg-bed-picker");
  if (picker) picker.classList.remove("open");
}

async function submitChangeBed(lodgerId, gender) {
  const bedId = document.getElementById("chg-bed").value;
  if (!bedId) {
    alert("请选择新床位");
    return;
  }
  const bed = query(
    `SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?`,
    [bedId],
  )[0];
  if (!dormMatchGender(bed.dorm_type, gender)) {
    alert("该床位所在房间寮类型不符");
    return;
  }
  const occ = query(
    "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
    [bedId],
  )[0].c;
  if (occ > 0) {
    alert("该床位已有人");
    return;
  }
  if (!isBedAssignable(bedId)) {
    alert("该床位当前不可分配（可能未清洁或处于维修状态）");
    return;
  }
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      const old = query(
        "SELECT bed_id, guest_id, name, event_id FROM lodgers WHERE id=?",
        [lodgerId],
      )[0];
      writeResult = await apiChangeBed({ lodger_id: lodgerId, bed_id: parseInt(bedId, 10) });
      if (old && typeof maybeLogRoomingChangeBed === "function") {
        await maybeLogRoomingChangeBed(lodgerId, old.bed_id, bedId);
      }
    } else {
      const old = query(
        "SELECT bed_id, guest_id, name, event_id FROM lodgers WHERE id=?",
        [lodgerId],
      )[0];
      await withTransaction(async () => {
        run("UPDATE lodgers SET bed_id=? WHERE id=? AND status='在住'", [
          bedId,
          lodgerId,
        ]);
        // 释放旧床位，占用新床位 | Release old bed, occupy new bed
        if (old && old.bed_id) {
          run("UPDATE beds SET status='可用' WHERE id=?", [old.bed_id]);
          setHouseStatus(old.bed_id, "脏房", "换床释放旧床位");
        }
        run("UPDATE beds SET status='占用' WHERE id=?", [bedId]);
        setHouseStatus(bedId, "占用", "换床占用新床位");
        logAudit("换床", "lodger", lodgerId, {
          guest_id: old.guest_id,
          old_bed_id: old.bed_id,
          new_bed_id: bedId,
          name: old.name,
        });
      });
      await saveDB();
      if (old && typeof maybeLogRoomingChangeBed === "function") {
        await maybeLogRoomingChangeBed(lodgerId, old.bed_id, bedId);
      }
    }
    closeModal();
    showToast("换床成功");
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("换床失败：" + e.message);
  }
}

function openEditLodgerModal(id) {
  const l = query("SELECT * FROM lodgers WHERE id=?", [id])[0];
  let emergencyName = "";
  let emergencyPhone = "";
  if (l.guest_id) {
    const guest = query(
      "SELECT emergency_contact, emergency_phone FROM guests WHERE id=?",
      [l.guest_id],
    )[0];
    if (guest) {
      emergencyName = guest.emergency_contact || "";
      emergencyPhone = guest.emergency_phone || "";
    }
  }
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "编辑挂单 - " + escapeHtml(personDisplayName(l));
  setModalBody(`
    <div class="modal-form">
      <div class="form-grid">
        <div class="field"><label>姓名 / 法名</label><input type="text" id="edit-name" value="${escapeHtml(personNameInputValue(l))}"></div>
        <div class="field"><label>性别</label>
          <select id="edit-gender">
            <option value="">请选择</option>
            <option value="男" ${l.gender === "男" ? "selected" : ""}>男</option>
            <option value="女" ${l.gender === "女" ? "selected" : ""}>女</option>
          </select>
        </div>
        <div class="field"><label>身份</label>
          <select id="edit-role">${roleSelectOptionsHtml(l.role)}</select>
        </div>
        <div class="field"><label>手机号</label>
          <input type="tel" id="edit-phone" value="${escapeHtml(l.phone || "")}"
            oninput="filterPhoneLoose(this)" onblur="validateField(this)">
          <div class="field-error" id="edit-phone-error"></div>
        </div>
        <div class="field"><label>身份证</label>
          <input type="text" id="edit-idcard" value="${escapeHtml(l.id_card || "")}"
            inputmode="numeric"
            pattern="\\d{17}[\\dXx]"
            oninput="filterIdCard(this)" onblur="validateField(this)">
          <div class="field-error" id="edit-idcard-error"></div>
        </div>
        <div class="field"><label>紧急联系人</label>
          <input type="text" id="edit-emergency-name" value="${escapeHtml(emergencyName)}">
        </div>
        <div class="field"><label>紧急联系电话</label>
          <input type="tel" id="edit-emergency-phone" value="${escapeHtml(emergencyPhone)}"
            oninput="filterPhoneLoose(this)" onblur="validateField(this)">
          <div class="field-error" id="edit-emergency-phone-error"></div>
        </div>
        <div class="field"><label>入住日期</label><input type="date" id="edit-in" value="${escapeHtml(l.check_in_date)}"></div>
        <div class="field"><label>预离日期</label><input type="date" id="edit-out" value="${escapeHtml(l.expected_check_out || "")}"></div>
        <div class="field"><label>所属营期</label><select id="edit-event"><option value="">散客 / 不归属营期</option></select></div>
        <div class="field"><label>班级/分组</label><input type="text" id="edit-class" value="${escapeHtml(l.class_name || "")}" placeholder="如：一班、师父组"></div>
        ${participantTagFieldsHtml("edit", l)}
      </div>
      <div class="field"><label>备注</label><textarea id="edit-notes" rows="2">${escapeHtml(l.notes || "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" onclick="submitEditLodger(${l.id})">保存修改</button>
      </div>
    </div>
  `);
  populateEventSelect("edit-event", l.event_id || null);
  ["edit-participant-identity", "edit-age-group"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && typeof rebuildSelectPicker === "function") rebuildSelectPicker(el);
  });
  modal.classList.add("active");
}

async function submitEditLodger(id) {
  if (
    !validateFields([
      "edit-name",
      "edit-phone",
      "edit-idcard",
      "edit-emergency-phone",
    ])
  ) {
    alert("请修正红色标记的字段后重新提交");
    return;
  }
  const name = document.getElementById("edit-name").value.trim();
  const person = parsePersonNameInput(name);
  const phoneRaw = document.getElementById("edit-phone").value.trim();
  const phone = phoneRaw ? phoneRaw.replace(/\s/g, "") : null;
  const idCard = document.getElementById("edit-idcard").value.trim();
  const emergencyName =
    document.getElementById("edit-emergency-name").value.trim();
  const emergencyPhoneRaw = document
    .getElementById("edit-emergency-phone")
    .value.trim();
  const emergencyPhone = emergencyPhoneRaw
    ? emergencyPhoneRaw.replace(/\s/g, "")
    : "";
  const contact = validateEditLodgerContact(id, phone, idCard, {
    emergencyName: emergencyName,
    emergencyPhone: emergencyPhone,
  });
  if (!contact.ok) {
    alertGuestContactError(contact);
    return;
  }

  const gender = document.getElementById("edit-gender").value;
  const l = query("SELECT bed_id FROM lodgers WHERE id=?", [id])[0];
  const bed = query(
    `SELECT b.*, r.dorm_type FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?`,
    [l.bed_id],
  )[0];
  if (!dormMatchGender(bed.dorm_type, gender)) {
    if (
      !confirm(
        `该床位所在房间为「${bed.dorm_type}」，修改性别后可能不符合安排。是否继续？`,
      )
    )
      return;
  }

  const checkIn = document.getElementById("edit-in").value;
  const checkOut = document.getElementById("edit-out").value || null;
  if (checkOut && checkOut < checkIn) {
    alert("预离日期不能早于入住日期");
    return;
  }

  const dup = checkDuplicate(contact.phone, contact.idCard, id);
  if (dup) {
    const info = personDisplayName(dup) + (dup.phone ? " · " + dup.phone : "");
    if (!confirm(`检测到该手机号/身份证已有在住记录：${info}\n是否继续保存？`))
      return;
  }

  let participantTags;
  try {
    participantTags = readParticipantTagsFromForm("edit");
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiEditLodger({
        lodger_id: id,
        name: name,
        gender: gender || null,
        phone: contact.phone,
        id_card: contact.idCard,
        emergency_name: contact.emergencyName || null,
        emergency_phone: contact.emergencyPhone || null,
        check_in_date: checkIn,
        expected_check_out: checkOut,
        role: readLodgerRoleInput("edit-role"),
        class_name: document.getElementById("edit-class").value.trim() || null,
        ...participantTags,
        event_id: document.getElementById("edit-event").value || null,
        notes: document.getElementById("edit-notes").value.trim() || null,
      });
    } else {
      await withTransaction(async () => {
        run(
          `UPDATE lodgers SET
        name=?, dharma_name=?, gender=?, phone=?, id_card=?,
        check_in_date=?, expected_check_out=?, role=?, class_name=?, participant_identity=?, age_group=?, special_needs=?, event_id=?, notes=?
        WHERE id=?`,
          [
            person.name,
            person.dharma_name,
            gender || null,
            contact.phone,
            contact.idCard,
            checkIn,
            checkOut,
            readLodgerRoleInput("edit-role"),
            document.getElementById("edit-class").value.trim() || null,
            ...Object.values(participantTags),
            document.getElementById("edit-event").value || null,
            document.getElementById("edit-notes").value.trim() || null,
            id,
          ],
        );

        // 同步更新关联 guests 表
        const lodger = query("SELECT guest_id FROM lodgers WHERE id=?", [
          id,
        ])[0];
        if (lodger && lodger.guest_id) {
          run(
            `UPDATE guests SET
          name=?, dharma_name=?, gender=?, phone=?, id_card=?, emergency_contact=?, emergency_phone=?, updated_at=?
          WHERE id=?`,
            [
              person.name,
              person.dharma_name,
              gender || null,
              contact.phone,
              contact.idCard,
              contact.emergencyName || null,
              contact.emergencyPhone || null,
              new Date().toISOString(),
              lodger.guest_id,
            ],
          );
        }

        logAudit("编辑挂单", "lodger", id, {
          guest_id: lodger && lodger.guest_id,
          name: name,
        });

        // 重新生成用斋记录（保留已有跳过设置；缺失日期按默认用斋）
        const existing = {};
        query("SELECT * FROM meals WHERE lodger_id=?", [id]).forEach((m) => {
          existing[m.date] = m;
        });
        run("DELETE FROM meals WHERE lodger_id=?", [id]);
        const defaults = getLodgerMealDefaults(id);
        const dates = getLodgerStayDates({
          check_in_date: checkIn,
          expected_check_out: checkOut,
        });
        dates.forEach((d) => {
          const m = existing[d] || {
            breakfast: defaults.breakfast,
            lunch: defaults.lunch,
            dinner: defaults.dinner,
          };
          run(
            `INSERT INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)`,
            [id, d, m.breakfast ? 1 : 0, m.lunch ? 1 : 0, m.dinner ? 1 : 0],
          );
        });
      });
      await saveDB();
    }
    closeModal();
    showToast("修改成功");
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("保存修改失败：" + e.message);
  }
}

async function deleteLodger(id) {
  const l = query("SELECT * FROM lodgers WHERE id=?", [id])[0];
  const info = personDisplayName(l) + (l.phone ? " · " + l.phone : "");
  const ok = await showConfirm({
    title: "删除挂单",
    message: "确定删除挂单记录？\n" + info + "\n删除后不可恢复。",
    confirmText: "删除",
    cancelText: "取消",
    danger: true,
  });
  if (!ok) return;
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiDeleteLodger({ lodger_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM meals WHERE lodger_id=?", [id]);
        run("DELETE FROM payments WHERE lodger_id=?", [id]);
        run("DELETE FROM lodgers WHERE id=?", [id]);
        if (l.bed_id) {
          run("UPDATE beds SET status='可用' WHERE id=?", [l.bed_id]);
          setHouseStatus(l.bed_id, "脏房", "删除挂单释放床位");
        }
        logAudit("删除挂单", "lodger", id, {
          guest_id: l.guest_id,
          name: l.name,
        });
      });
      await saveDB();
    }
    showToast("已删除");
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("删除失败：" + e.message);
  }
}

function openCheckoutModal(id) {
  const l = query(
    "SELECT l.*, r.name as room_name, b.bed_number FROM lodgers l LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.id=?",
    [id],
  )[0];
  const label = escapeHtml(
    (l.room_name || "-") + (l.bed_number ? " / " + l.bed_number : ""),
  );
  const paid = query(
    "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) as refund FROM payments WHERE lodger_id = ?",
    [id],
  )[0];
  const balance = (paid.income || 0) - (paid.refund || 0);
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "退房 - " + escapeHtml(personDisplayName(l));
  setModalBody(`
    <div class="modal-form">
      <div class="modal-summary">
        <p><span class="modal-summary-label">床位</span>${label}</p>
        <p class="modal-summary-muted">已收 ${paid.income || 0} · 已退 ${paid.refund || 0} · 余额 ${balance}</p>
      </div>
      <div class="form-grid">
        <div class="field">
          <label>退还押金</label>
          <input type="number" id="co-refund" min="0" step="0.01" value="${balance > 0 ? balance : 0}" placeholder="0.00">
        </div>
        <div class="field">
          <label>退款方式</label>
          <select id="co-refund-method">
            <option value="现金">现金</option>
            <option value="微信">微信</option>
            <option value="支付宝">支付宝</option>
            <option value="原路退回">原路退回</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>退房备注</label>
        <textarea id="co-notes" rows="2" placeholder="物品损坏/加床收费等"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" onclick="submitCheckout(${l.id})">确认退房</button>
      </div>
    </div>
  `);
  modal.classList.add("active");
}

async function submitCheckout(id) {
  const refund = parseFloat(document.getElementById("co-refund").value) || 0;
  const method = document.getElementById("co-refund-method").value;
  const notes = document.getElementById("co-notes").value.trim() || null;
  if (refund < 0) {
    alert("退款金额不能为负数");
    return;
  }
  const paid = query(
    "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) as refund_total FROM payments WHERE lodger_id = ?",
    [id],
  )[0];
  const balance = (paid.income || 0) - (paid.refund_total || 0);
  if (refund > balance) {
    alert(`退款金额不能超过余额 ${balance.toFixed(2)}`);
    return;
  }
  const l = query("SELECT bed_id, guest_id, name FROM lodgers WHERE id=?", [
    id,
  ])[0];
  const today = new Date().toISOString().slice(0, 10);
  try {
    var writeResult = null;
    if (useRemoteWriteApi()) {
      writeResult = await apiCheckout({
        lodger_id: id,
        refund: refund,
        refund_method: method,
        notes: notes,
      });
    } else {
      await withTransaction(async () => {
        run(
          "UPDATE lodgers SET status='已退', actual_check_out=?, bed_id=NULL WHERE id=?",
          [today, id],
        );
        if (l && l.bed_id) {
          run("UPDATE beds SET status='可用' WHERE id=?", [l.bed_id]);
          setHouseStatus(l.bed_id, "脏房", notes || "办理退房");
        }
        if (refund > 0) {
          run(
            "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '退款', ?, ?, ?)",
            [id, refund, method, notes],
          );
          logAudit("退款", "lodger", id, {
            guest_id: l.guest_id,
            name: l.name,
            refund: refund,
            method: method,
          });
        } else {
          // 零退款也写入一条占位流水，确保每笔退房都有支付记录可追踪
          run(
            "INSERT INTO payments (lodger_id, type, amount, method, remark) VALUES (?, '退款', 0, ?, ?)",
            [id, method, "退房结算（无退款）"],
          );
        }
        logAudit("退房", "lodger", id, {
          guest_id: l.guest_id,
          bed_id: l.bed_id,
          refund: refund,
          name: l.name,
        });
      });
      await saveDB();
    }
    closeModal();
    showToast("退房成功");
    refreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("退房失败：" + e.message);
  }
}

function printVoucher(id) {
  const l = query(
    `
    SELECT l.*, r.name as room_name, b.bed_number,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '押金') as deposit,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '房费') as room_fee
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.id = ?
  `,
    [id],
  )[0];
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "挂单凭证 - " + escapeHtml(personDisplayName(l));
  document.getElementById("modal-body").innerHTML = `
    <div class="voucher" id="print-voucher">
      <h2>🏯 客堂管理凭证</h2>
      <div class="row"><span class="label">凭证号</span><span class="value">${l.id}</span></div>
      <div class="row"><span class="label">姓名</span><span class="value">${escapeHtml(personDisplayName(l))}</span></div>
      <div class="row"><span class="label">性别</span><span class="value">${escapeHtml(l.gender) || "-"}</span></div>
      <div class="row"><span class="label">身份</span><span class="value">${escapeHtml(l.role) || "-"}</span></div>
      <div class="row"><span class="label">房间/床位</span><span class="value">${escapeHtml((l.room_name || "-") + (l.bed_number ? " / " + l.bed_number : ""))}</span></div>
      <div class="row"><span class="label">入住日期</span><span class="value">${escapeHtml(l.check_in_date) || "-"}</span></div>
      <div class="row"><span class="label">预离日期</span><span class="value">${escapeHtml(l.expected_check_out) || "-"}</span></div>
      <div class="row"><span class="label">押金</span><span class="value">${(l.deposit || 0).toFixed(2)}</span></div>
      <div class="row"><span class="label">房费</span><span class="value">${(l.room_fee || 0).toFixed(2)}</span></div>
      <div class="row"><span class="label">手机号</span><span class="value">${escapeHtml(l.phone) || "-"}</span></div>
      <div class="row"><span class="label">备注</span><span class="value">${escapeHtml(l.notes) || "-"}</span></div>
      <div class="footer">请妥善保管此凭证，退房时出示。</div>
    </div>
    <div style="text-align:center; margin-top: var(--space-4);">
      <button class="btn btn-primary" onclick="window.print()">打印</button>
      <button class="btn btn-default" onclick="closeModal()">关闭</button>
    </div>
  `;
  modal.classList.add("active");
}

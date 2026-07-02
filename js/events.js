/* ============================================================
   营期管理 | Event / Program Management
   禅修营、法会、修道班等营期的增删改查与批量操作
   ============================================================ */

const EVENT_TYPE_OPTIONS = ["禅营", "禅七", "法会", "修道班", "其他"];
const EVENT_GENDER_OPTIONS = ["男众", "女众", "混合"];
const EVENT_STATUS_OPTIONS = ["筹备中", "招生中", "进行中", "已结束", "已取消"];

// 营期列表（用于基础设置页）
function renderEventList() {
  const f = infoGetFilters("events");
  const events = query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM lodgers l WHERE l.event_id = e.id AND l.status = '在住') as checked_in,
      (SELECT COUNT(*) FROM reservations r WHERE r.event_id = e.id AND r.status IN ('预约','已确认')) as reserved,
      (SELECT COUNT(*) FROM lodgers l2 WHERE l2.event_id = e.id) as total_lodgers
    FROM events e
    ORDER BY e.start_date DESC, e.id DESC
  `);

  const filtered = events.filter((e) => {
    if (f.eventType && e.event_type !== f.eventType) return false;
    if (
      f.q &&
      !infoTextIncludes(
        [e.name, e.event_type, e.manager_name, e.notes].join(" "),
        f.q,
      )
    ) {
      return false;
    }
    return true;
  });

  const toolbar = infoToolbarHtml(
    `${infoSearchBox("events", "搜索营期名称…")}
     ${infoFilterSelect(
       "events",
       "eventType",
       "类型筛选",
       EVENT_TYPE_OPTIONS.map((t) => [t, t]),
       "类型筛选",
     )}`,
    `<button type="button" class="btn btn-primary" onclick="openEventModal()">+ 新增营期</button>`,
  );

  let html = `
    <div class="event-chart-box">
      <h4>营期招生进度</h4>
      <canvas id="chart-events-progress"></canvas>
    </div>
  `;

  if (!filtered.length) {
    html += infoEmptyTable(
      events.length ? "没有符合条件的营期。" : "暂无营期，请先新增。",
    );
    infoPageShell(toolbar, html);
    renderEventProgressChart(events);
    return;
  }

  const canRoomingPlan =
    typeof hasPermission === "function" && hasPermission("settings.read");

  html += `<div class="event-grid">`;
  filtered.forEach((e) => {
    const registered = (e.reserved || 0) + (e.checked_in || 0);
    const expected = e.expected_count || 0;
    const pct = expected ? Math.round((registered / expected) * 100) : 0;
    const gap = expected - registered;
    let alertHtml = "";
    if (expected > 0 && gap > 0) {
      const daysToStart = e.start_date
        ? Math.ceil(
            (new Date(e.start_date) - new Date(todayStr())) /
              (1000 * 60 * 60 * 24),
          )
        : null;
      const urgent =
        daysToStart !== null && daysToStart <= 7 && daysToStart >= 0;
      alertHtml = `<div class="event-card-alert ${urgent ? "event-card-alert-urgent" : ""}">还差 ${gap} 人${daysToStart !== null && daysToStart >= 0 ? "，" + (daysToStart === 0 ? "今天开始" : daysToStart + " 天后开始") : ""}</div>`;
    } else if (expected > 0 && gap <= 0) {
      alertHtml = `<div class="event-card-alert event-card-alert-ok">招生完成${registered > expected ? "（超额 " + (registered - expected) + " 人）" : ""}</div>`;
    }
    html += `
      <div class="event-card">
        <div class="event-card-header">
          <span class="event-card-name">${infoEscape(e.name)}</span>
          <span class="event-tag event-tag-type">${infoEscape(e.event_type)}</span>
          <span class="event-tag event-tag-gender-${e.gender_type === "男众" ? "male" : e.gender_type === "女众" ? "female" : "mix"}">${infoEscape(e.gender_type)}</span>
          <span class="event-tag event-tag-status-${e.status}">${infoEscape(e.status)}</span>
          ${e.include_spare_beds ? '<span class="event-tag">含备用床</span>' : ""}
          ${e.activity_target ? '<span class="event-tag">' + infoEscape(e.activity_target) + "</span>" : ""}
        </div>
        <div class="event-card-meta">
          <span>${infoEscape(e.start_date) || "-"} ~ ${infoEscape(e.end_date) || "-"}</span>
          ${e.arrival_date || e.departure_date ? `<span>报到 ${infoEscape(e.arrival_date) || "-"} / 离寺 ${infoEscape(e.departure_date) || "-"}</span>` : ""}
          <span>预计 ${expected} 人</span>
          ${e.manager_name ? `<span>负责人 ${infoEscape(e.manager_name)}</span>` : ""}
        </div>
        <div class="event-card-stats">
          <div class="event-stat"><div class="event-stat-num">${registered}</div><div class="event-stat-label">已报名</div></div>
          <div class="event-stat"><div class="event-stat-num">${e.checked_in || 0}</div><div class="event-stat-label">已入住</div></div>
          <div class="event-stat"><div class="event-stat-num">${e.reserved || 0}</div><div class="event-stat-label">仅预约</div></div>
          <div class="event-stat"><div class="event-stat-num">${gap}</div><div class="event-stat-label">差额</div></div>
        </div>
        <div class="event-progress"><div class="event-progress-bar" style="width:${pct}%"></div></div>
        ${alertHtml}
        <div class="event-card-actions">
          <button class="btn btn-sm btn-default" onclick="openEventModal(${e.id})">编辑</button>
          <button class="btn btn-sm btn-primary" onclick="renderEventMembers(${e.id})">成员 / 批量取消</button>
          ${canRoomingPlan ? `<button class="btn btn-sm btn-warning" onclick="renderRoomingPlan(${e.id})">预分房</button>` : ""}
          <button class="btn btn-sm btn-success" onclick="openRoomingSuggestion(${e.id})">排房建议</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.id})">删除</button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  infoPageShell(toolbar, html);
  renderEventProgressChart(filtered);
}

// 营期成员与批量操作
function renderEventMembers(eventId) {
  const evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) return;

  const lodgers = query(
    `
    SELECT l.id, l.name, l.dharma_name, l.gender, l.check_in_date, l.expected_check_out, l.role, l.class_name, l.participant_identity, l.age_group, l.status, r.name as room_name, b.bed_number, 'lodger' as kind
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.event_id = ? AND l.status = '在住'
    ORDER BY l.status, l.name
  `,
    [eventId],
  );

  const reservations = query(
    `
    SELECT r.id, r.name, r.dharma_name, r.gender, r.expected_check_in, r.expected_check_out, r.role, r.class_name, r.participant_identity, r.age_group, r.status, r.room_preference, 'reservation' as kind
    FROM reservations r
    WHERE r.event_id = ? AND r.status IN ('预约', '已确认')
    ORDER BY r.expected_check_in, r.name
  `,
    [eventId],
  );

  const members = [...lodgers, ...reservations];

  let html = `
    <h3 class="info-subsection-title">${infoEscape(evt.name)} · 成员管理</h3>
    <p class="text-muted">共 ${members.length} 人（在住/已预约）。勾选后可批量操作。</p>
  `;

  infoSetToolbar(
    infoToolbarHtml(
      "",
      `<button type="button" class="btn btn-default" onclick="renderEventList()">← 返回营期列表</button>`,
    ),
  );

  if (!members.length) {
    html += infoEmptyTable("该营期暂无在住或预约成员。");
    infoSetHtml(html);
    return;
  }

  html += `
    <div class="btn-bar" style="margin-bottom: var(--space-3);">
      <button class="btn btn-warning" onclick="batchNoShowEventMembers()">批量标记 No-show</button>
      <button class="btn btn-danger" onclick="batchCancelEventMembers()">批量取消</button>
      <button class="btn btn-success" onclick="exportEventMembersCSV(${eventId})">导出名单</button>
      <label style="margin-left:auto"><input type="checkbox" id="event-member-select-all" onchange="toggleSelectAllEventMembers(this)"> 全选</label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th><input type="checkbox" id="event-member-select-all-header" onchange="toggleSelectAllEventMembers(this)"></th>
        <th>姓名 / 法名</th><th>性别</th><th>身份</th><th>排房身份</th><th>年龄段</th><th>班级</th><th>类型</th><th>状态</th><th>入住/预计入住</th><th>预离</th><th>房间/床位/偏好</th>
      </tr></thead><tbody>
  `;

  members.forEach((m) => {
    const kindLabel = m.kind === "lodger" ? "在住" : "预约";
    const roomInfo =
      m.kind === "lodger"
        ? `${infoEscape(m.room_name || "-")} / ${infoEscape(m.bed_number || "-")}`
        : infoEscape(m.room_preference || "-");
    const checkDate =
      m.kind === "lodger" ? m.check_in_date : m.expected_check_in;
    html += `
      <tr>
        <td><input type="checkbox" class="event-member-checkbox" data-id="${m.id}" data-kind="${m.kind}"></td>
        <td>${infoEscape(personDisplayName(m))}</td>
        <td>${infoEscape(m.gender) || "-"}</td>
        <td>${infoEscape(m.role) || "-"}</td>
        <td>${infoEscape(m.participant_identity) || "-"}</td>
        <td>${infoEscape(m.age_group) || "-"}</td>
        <td>${infoEscape(m.class_name) || "-"}</td>
        <td>${kindLabel}</td>
        <td>${infoEscape(m.status)}</td>
        <td>${infoEscape(checkDate) || "-"}</td>
        <td>${infoEscape(m.expected_check_out) || "-"}</td>
        <td>${roomInfo}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  infoSetHtml(html);
}

function toggleSelectAllEventMembers(source) {
  const checked = source.checked;
  document
    .querySelectorAll(".event-member-checkbox")
    .forEach((cb) => (cb.checked = checked));
  document.getElementById("event-member-select-all").checked = checked;
  document.getElementById("event-member-select-all-header").checked = checked;
}

function getSelectedEventMembers() {
  const selected = [];
  document.querySelectorAll(".event-member-checkbox:checked").forEach((cb) => {
    selected.push({ id: parseInt(cb.dataset.id), kind: cb.dataset.kind });
  });
  return selected;
}

async function batchCancelEventMembers() {
  const selected = getSelectedEventMembers();
  if (!selected.length) {
    alert("请先勾选要取消的成员");
    return;
  }
  if (!confirm(`确定要取消选中的 ${selected.length} 人吗？此操作不可恢复。`))
    return;

  let eventId = null;
  const first = selected[0];
  if (first.kind === "reservation") {
    const r = query("SELECT event_id FROM reservations WHERE id = ?", [
      first.id,
    ])[0];
    eventId = r ? r.event_id : null;
  } else {
    const l = query("SELECT event_id FROM lodgers WHERE id = ?", [first.id])[0];
    eventId = l ? l.event_id : null;
  }

  try {
    if (useRemoteWriteApi()) {
      await apiBatchEventMembers({
        action: "cancel",
        items: selected,
        event_id: eventId,
      });
    } else {
      await withTransaction(async () => {
        for (const item of selected) {
          if (item.kind === "reservation") {
            const r = query("SELECT * FROM reservations WHERE id = ?", [
              item.id,
            ])[0];
            if (r && r.status !== "已取消") {
              run("UPDATE reservations SET status = '已取消' WHERE id = ?", [
                item.id,
              ]);
              logAudit("批量取消预约", "reservation", item.id, {
                name: r.name,
              });
            }
          } else {
            const l = query("SELECT * FROM lodgers WHERE id = ?", [item.id])[0];
            if (l && l.status === "在住") {
              const today = todayStr();
              run(
                "UPDATE lodgers SET status = '已取消', bed_id = NULL, actual_check_out = ? WHERE id = ?",
                [today, item.id],
              );
              run("DELETE FROM meals WHERE lodger_id = ? AND date > ?", [
                item.id,
                today,
              ]);
              if (l.bed_id) {
                run("UPDATE beds SET status = '可用' WHERE id = ?", [l.bed_id]);
                setHouseStatus(l.bed_id, "脏房", "批量取消挂单释放床位");
              }
              logAudit("批量取消挂单", "lodger", item.id, { name: l.name });
            }
          }
        }
      });
      await saveDB();
    }
  } catch (e) {
    console.error(e);
    alert("批量取消失败：" + e.message);
    return;
  }
  showToast(`已取消 ${selected.length} 人`);
  refreshAfterWrite();
  if (eventId) renderEventMembers(eventId);
  else renderEventList();
}

async function batchNoShowEventMembers() {
  const selected = getSelectedEventMembers();
  // No-show 仅适用于预约，过滤掉在住挂单
  const resvOnly = selected.filter((item) => item.kind === "reservation");
  if (!resvOnly.length) {
    alert("No-show 仅适用于预约记录，请勾选预约成员");
    return;
  }
  if (!confirm(`确定要将选中的 ${resvOnly.length} 人标记为 No-show 吗？`))
    return;

  let eventId = null;
  const first = resvOnly[0];
  const r0 = query("SELECT event_id FROM reservations WHERE id = ?", [
    first.id,
  ])[0];
  eventId = r0 ? r0.event_id : null;

  try {
    if (useRemoteWriteApi()) {
      await apiBatchEventMembers({
        action: "noshow",
        items: resvOnly,
        event_id: eventId,
      });
    } else {
      await withTransaction(async () => {
        for (const item of resvOnly) {
          const r = query("SELECT * FROM reservations WHERE id = ?", [
            item.id,
          ])[0];
          if (r && r.status !== "已入住" && r.status !== "No-show") {
            run("UPDATE reservations SET status = 'No-show' WHERE id = ?", [
              item.id,
            ]);
            logAudit("批量标记 No-show", "reservation", item.id, {
              name: r.name,
            });
          }
        }
      });
      await saveDB();
    }
  } catch (e) {
    console.error(e);
    alert("批量标记 No-show 失败：" + e.message);
    return;
  }
  showToast(`已标记 ${resvOnly.length} 人为 No-show`);
  refreshAfterWrite();
  if (eventId) renderEventMembers(eventId);
  else renderEventList();
}

// 营期编辑弹窗
function openEventModal(id) {
  const isEdit = !!id;
  const e = isEdit ? query("SELECT * FROM events WHERE id = ?", [id])[0] : null;

  document.getElementById("modal-title").textContent = isEdit
    ? "编辑营期"
    : "新增营期";
  setModalWide(true);
  setModalBody(`
          <form id="event-form" onsubmit="submitEvent(event)">
            <input type="hidden" id="event-id" value="${isEdit ? e.id : ""}">
            <div class="form-grid">
              ${infoField("营期名称 *", `<input type="text" id="event-name" required value="${isEdit ? infoEscape(e.name) : ""}">`, "event-name")}
              ${infoField("营期类型", infoSelectHtml("event-type", EVENT_TYPE_OPTIONS, isEdit ? e.event_type : "禅营"), "event-type")}
              ${infoField("性别类型", infoSelectHtml("event-gender", EVENT_GENDER_OPTIONS, isEdit ? e.gender_type : "混合"), "event-gender")}
              ${infoField("预计招生人数", `<input type="number" id="event-expected" min="0" value="${isEdit ? e.expected_count || "" : ""}">`, "event-expected")}
              ${infoField("开始日期", `<input type="date" id="event-start" value="${isEdit ? infoEscape(e.start_date) : ""}">`, "event-start")}
              ${infoField("结束日期", `<input type="date" id="event-end" value="${isEdit ? infoEscape(e.end_date) : ""}">`, "event-end")}
              ${infoField("状态", infoSelectHtml("event-status", EVENT_STATUS_OPTIONS, isEdit ? e.status : "筹备中"), "event-status")}
              ${infoField("备注", `<textarea id="event-notes" rows="2">${isEdit ? infoEscape(e.notes) : ""}</textarea>`, "event-notes")}
              ${infoField("统计口径", `<label class="role-perm-item"><input type="checkbox" id="event-include-spare" ${isEdit && e.include_spare_beds ? "checked" : ""}> 排房/营期统计包含备用床（日常房态仍排除）</label>`, "event-include-spare")}
            </div>
            ${eventRoomingFormFieldsHtml(e)}
            <div class="btn-bar">
              <button type="submit" class="btn btn-primary">保存</button>
              <button type="button" class="btn" onclick="closeModal()">取消</button>
            </div>
          </form>
  `);
  document.getElementById("modal").classList.add("active");
}

function closeEventModal() {
  closeModal();
}

async function submitEvent(e) {
  e.preventDefault();
  const id = document.getElementById("event-id").value;
  const name = document.getElementById("event-name").value.trim();
  const eventType = document.getElementById("event-type").value;
  const genderType = document.getElementById("event-gender").value;
  const expected =
    parseInt(document.getElementById("event-expected").value, 10) || 0;
  const startDate = document.getElementById("event-start").value || null;
  const endDate = document.getElementById("event-end").value || null;
  const status = document.getElementById("event-status").value;
  const notes = document.getElementById("event-notes").value.trim() || null;
  const includeSpareBeds = document.getElementById("event-include-spare")?.checked
    ? 1
    : 0;
  let rooming;
  let roomingValues;
  try {
    rooming = readEventRoomingFromForm();
    roomingValues = eventRoomingDbValues(rooming);
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  if (!name) {
    alert("请输入营期名称");
    return;
  }
  if (startDate && endDate && endDate < startDate) {
    alert("结束日期不能早于开始日期");
    return;
  }
  if (
    rooming.arrival_date &&
    rooming.departure_date &&
    rooming.departure_date < rooming.arrival_date
  ) {
    alert("离寺日期不能早于报到日期");
    return;
  }

  try {
    if (useRemoteWriteApi()) {
      await apiAdminRecord("event", id ? "update" : "create", {
        event_id: id,
        name: name,
        event_type: eventType,
        gender_type: genderType,
        expected_count: expected,
        start_date: startDate,
        end_date: endDate,
        status: status,
        notes: notes,
        include_spare_beds: includeSpareBeds,
        ...rooming,
      });
    } else {
      await withTransaction(async () => {
        if (id) {
          const old = query("SELECT status FROM events WHERE id=?", [id])[0];
          const oldStatus = old ? old.status : "";
          run(
            `UPDATE events SET name=?, event_type=?, gender_type=?, expected_count=?, start_date=?, end_date=?, status=?, notes=?, include_spare_beds=?, ${EVENT_ROOMING_DB_COLUMNS} WHERE id=?`,
            [
              name,
              eventType,
              genderType,
              expected,
              startDate,
              endDate,
              status,
              notes,
              includeSpareBeds,
              ...roomingValues,
              id,
            ],
          );
          // 营期取消时级联取消成员、释放床位
          if (status === "已取消" && oldStatus !== "已取消") {
            const today = todayStr();
            const lodgers = query(
              "SELECT * FROM lodgers WHERE event_id=? AND status='在住'",
              [id],
            );
            lodgers.forEach((l) => {
              run(
                "UPDATE lodgers SET status='已取消', bed_id=NULL, actual_check_out=? WHERE id=?",
                [today, l.id],
              );
              if (l.bed_id) {
                run("UPDATE beds SET status='可用' WHERE id=?", [l.bed_id]);
                setHouseStatus(l.bed_id, "脏房", "营期取消释放床位");
              }
              run("DELETE FROM meals WHERE lodger_id=? AND date>?", [
                l.id,
                today,
              ]);
              logAudit("营期取消释放挂单", "lodger", l.id, {
                name: l.name,
                event_id: id,
              });
            });
            const reservations = query(
              "SELECT * FROM reservations WHERE event_id=? AND status IN ('预约','已确认')",
              [id],
            );
            reservations.forEach((r) => {
              run("UPDATE reservations SET status='已取消' WHERE id=?", [r.id]);
              logAudit("营期取消释放预约", "reservation", r.id, {
                name: r.name,
                event_id: id,
              });
            });
          }
          logAudit("更新营期", "event", id, { name });
        } else {
          const result = run(
            `INSERT INTO events (name, event_type, gender_type, expected_count, start_date, end_date, status, notes, include_spare_beds, ${EVENT_ROOMING_DB_COLUMNS})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${roomingValues.map(() => "?").join(", ")})`,
            [
              name,
              eventType,
              genderType,
              expected,
              startDate,
              endDate,
              status,
              notes,
              includeSpareBeds,
              ...roomingValues,
            ],
          );
          const newId = result.lastInsertId;
          logAudit("新增营期", "event", newId, { name });
        }
      });
    }
  } catch (e) {
    console.error(e);
    alert("保存营期失败：" + e.message);
    return;
  }
  if (!useRemoteWriteApi()) await saveDB();
  closeEventModal();
  showToast("营期保存成功");
  renderEventList();
  refreshAfterWrite();
}

async function deleteEvent(id) {
  const e = query("SELECT * FROM events WHERE id = ?", [id])[0];
  if (!e) return;
  const related =
    (query("SELECT COUNT(*) as c FROM lodgers WHERE event_id = ?", [id])[0]
      ?.c || 0) +
    (query("SELECT COUNT(*) as c FROM reservations WHERE event_id = ?", [id])[0]
      ?.c || 0);
  if (related > 0) {
    alert(`该营期下还有 ${related} 条记录，无法删除。请先取消或转移这些记录。`);
    return;
  }
  if (!confirm(`确定删除营期「${e.name}」吗？`)) return;
  try {
    if (useRemoteWriteApi()) {
      await apiAdminRecord("event", "delete", { event_id: id });
    } else {
      await withTransaction(async () => {
        run("DELETE FROM events WHERE id = ?", [id]);
        logAudit("删除营期", "event", id, { name: e.name });
      });
      await saveDB();
    }
    showToast("营期已删除");
    renderEventList();
    refreshAfterWrite();
  } catch (e) {
    console.error(e);
    alert("删除营期失败：" + e.message);
  }
}

// 生成营期下拉选项 HTML（供登记、预约、批量导入表单使用）
function getEventOptionsHtml(selectedId, allowEmpty) {
  const events = query(
    "SELECT id, name, event_type, status FROM events WHERE status != '已取消' ORDER BY start_date DESC, id DESC",
  );
  let html = allowEmpty ? '<option value="">散客 / 不归属营期</option>' : "";
  events.forEach((e) => {
    const selected = e.id == selectedId ? "selected" : "";
    html += `<option value="${e.id}" ${selected}>${infoEscape(e.name)} (${infoEscape(e.event_type)})</option>`;
  });
  return html;
}

// 根据营期 ID 返回营期对象（用于批量导入时按名称匹配）
function findEventByName(name) {
  if (!name) return null;
  const rows = query("SELECT * FROM events WHERE name = ? LIMIT 1", [
    name.trim(),
  ]);
  if (rows.length) return rows[0];
  // 尝试模糊匹配
  const fuzzy = query("SELECT * FROM events WHERE name LIKE ? LIMIT 1", [
    `%${name.trim()}%`,
  ]);
  return fuzzy.length ? fuzzy[0] : null;
}

/* ============================================================
   排房建议 | Rooming Suggestion
   ============================================================ */

function openRoomingSuggestion(eventId) {
  const evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) return;

  const suggestion = generateRoomingSuggestion(eventId);

  document.getElementById("modal-title").textContent = "排房建议 · " + evt.name;
  setModalWide(true);

  let bodyHtml = `
          <div class="rooming-summary">
            <div class="rooming-summary-item">
              <span class="rooming-summary-label">营期类型</span>
              <span class="rooming-summary-value">${infoEscape(evt.event_type)} · ${infoEscape(evt.gender_type)}</span>
            </div>
            <div class="rooming-summary-item">
              <span class="rooming-summary-label">预计招生</span>
              <span class="rooming-summary-value">${evt.expected_count || 0} 人</span>
            </div>
            <div class="rooming-summary-item">
              <span class="rooming-summary-label">已报名</span>
              <span class="rooming-summary-value">${suggestion.registered} 人（男 ${suggestion.registeredMale} / 女 ${suggestion.registeredFemale}）</span>
            </div>
            <div class="rooming-summary-item">
              <span class="rooming-summary-label">仍需床位</span>
              <span class="rooming-summary-value ${suggestion.totalGap > 0 ? "rooming-gap" : ""}">${suggestion.totalGap > 0 ? "男 " + suggestion.maleGap + " / 女 " + suggestion.femaleGap : "已满足"}</span>
            </div>
          </div>
  `;

  // 男众方案
  if (suggestion.malePlan.length > 0) {
    bodyHtml += `<h4 class="rooming-section-title">男众分配方案（${suggestion.registeredMale + (suggestion.maleGap > 0 ? suggestion.maleGap : 0)} 人）</h4>`;
    bodyHtml += renderRoomingSuggestionTable(suggestion.malePlan, suggestion.maleGap);
  }

  // 女众方案
  if (suggestion.femalePlan.length > 0) {
    bodyHtml += `<h4 class="rooming-section-title">女众分配方案（${suggestion.registeredFemale + (suggestion.femaleGap > 0 ? suggestion.femaleGap : 0)} 人）</h4>`;
    bodyHtml += renderRoomingSuggestionTable(
      suggestion.femalePlan,
      suggestion.femaleGap,
    );
  }

  // 调剂建议
  if (suggestion.flexRecommendations.length > 0) {
    bodyHtml += `<h4 class="rooming-section-title">房间调剂建议</h4>`;
    bodyHtml += `<div class="rooming-flex-list">`;
    suggestion.flexRecommendations.forEach((r) => {
      bodyHtml += `<div class="rooming-flex-item">
        <strong>${infoEscape(r.room.name)}</strong>（${infoEscape(r.room.location || "")}）
        <span class="room-tag" style="background:${r.toGender === "男众" ? "#e3f2fd;color:#1565c0" : "#fce4ec;color:#c2185b"}">改为${infoEscape(r.toGender)}</span>
        可提供 ${r.beds} 床
      </div>`;
    });
    bodyHtml += `</div>`;
  }

  if (suggestion.malePlan.length === 0 && suggestion.femalePlan.length === 0) {
    bodyHtml += `<p class="empty-tip">暂无排房需求。</p>`;
  }

  bodyHtml += `
          <div class="btn-bar" style="margin-top: var(--space-4);">
            <button class="btn btn-default" onclick="exportRoomingSuggestionCSV(${eventId})">导出 CSV</button>
            <button class="btn" onclick="closeModal()">关闭</button>
          </div>
  `;

  setModalBody(bodyHtml);
  document.getElementById("modal").classList.add("active");
}

function closeRoomingModal() {
  closeModal();
}

function generateRoomingSuggestion(eventId) {
  const evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];

  // 统计营期人员性别（已入住 + 预约/已确认）
  const members = query(
    `
    SELECT gender FROM lodgers WHERE event_id = ? AND status = '在住'
    UNION ALL
    SELECT gender FROM reservations WHERE event_id = ? AND status IN ('预约', '已确认')
  `,
    [eventId, eventId],
  );

  const registeredMale = members.filter((m) => m.gender === "男").length;
  const registeredFemale = members.filter((m) => m.gender === "女").length;
  const registered = members.length;

  // 营期性别类型决定预估总需求
  let needMale = registeredMale,
    needFemale = registeredFemale;
  if (evt.gender_type === "男众") {
    needMale = Math.max(needMale, evt.expected_count || 0);
    needFemale = 0;
  } else if (evt.gender_type === "女众") {
    needMale = 0;
    needFemale = Math.max(needFemale, evt.expected_count || 0);
  } else {
    // 混合：如果实际报名不足预计招生，按已报名比例估算
    if (registered < (evt.expected_count || 0)) {
      const remaining = (evt.expected_count || 0) - registered;
      const maleRatio = registered > 0 ? registeredMale / registered : 0.5;
      needMale += Math.round(remaining * maleRatio);
      needFemale += remaining - Math.round(remaining * maleRatio);
    }
  }

  // 查询可用床位（按房间分组）
  const requireInspect =
    typeof housekeepingRequiresInspect === "function" &&
    housekeepingRequiresInspect();
  const hkStatuses = requireInspect ? "('可用')" : "('净房','可用')";
  const includeSpare = !!evt.include_spare_beds;
  const spareSql = spareRoomExcludeClause("r", includeSpare);
  const availRooms = query(`
    SELECT r.id, r.name, r.location, r.dorm_type, COUNT(b.id) as avail_beds
    FROM rooms r
    JOIN beds b ON b.room_id = r.id
    LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
    WHERE b.status != '维修' AND b.status != '备用' AND l.id IS NULL
      AND ${spareSql}
      AND COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') IN ${hkStatuses}
    GROUP BY r.id
    HAVING avail_beds > 0
    ORDER BY CASE r.dorm_type WHEN '男寮' THEN 1 WHEN '女寮' THEN 2 ELSE 3 END, r.location, r.name
  `);

  // 分配算法
  const maleRooms = availRooms.filter((r) => r.dorm_type === "男寮");
  const femaleRooms = availRooms.filter((r) => r.dorm_type === "女寮");
  const flexRooms = availRooms.filter((r) => r.dorm_type === "不限");

  const malePlan = allocateRooms(needMale, maleRooms);
  const femalePlan = allocateRooms(needFemale, femaleRooms);

  const maleAssigned = malePlan.reduce((sum, p) => sum + p.assigned, 0);
  const femaleAssigned = femalePlan.reduce((sum, p) => sum + p.assigned, 0);
  const maleGap = Math.max(0, needMale - maleAssigned);
  const femaleGap = Math.max(0, needFemale - femaleAssigned);

  // 调剂建议：用不限房间补缺口
  const flexRecommendations = [];
  let remainingFlex = [...flexRooms];
  if (maleGap > 0) {
    const recs = allocateRooms(maleGap, remainingFlex);
    recs.forEach((r) => {
      flexRecommendations.push({
        room: r.room,
        toGender: "男众",
        beds: r.assigned,
      });
      remainingFlex = remainingFlex.filter((fr) => fr.id !== r.room.id);
    });
  }
  if (femaleGap > 0) {
    const recs = allocateRooms(femaleGap, remainingFlex);
    recs.forEach((r) => {
      flexRecommendations.push({
        room: r.room,
        toGender: "女众",
        beds: r.assigned,
      });
      remainingFlex = remainingFlex.filter((fr) => fr.id !== r.room.id);
    });
  }

  return {
    registered,
    registeredMale,
    registeredFemale,
    needMale,
    needFemale,
    malePlan,
    femalePlan,
    maleAssigned,
    femaleAssigned,
    maleGap,
    femaleGap,
    totalGap: maleGap + femaleGap,
    flexRecommendations,
  };
}

function allocateRooms(needed, rooms) {
  let remaining = needed;
  const plan = [];
  for (const room of rooms) {
    if (remaining <= 0) break;
    const assign = Math.min(remaining, room.avail_beds);
    plan.push({ room, assigned: assign });
    remaining -= assign;
  }
  return plan;
}

function renderRoomingSuggestionTable(plan, gap) {
  if (plan.length === 0) return '<p class="empty-tip">无可用房间。</p>';
  let html = `<div class="table-wrap"><table><thead><tr><th>房间</th><th>位置</th><th>类型</th><th>可用床</th><th>分配人数</th></tr></thead><tbody>`;
  plan.forEach((p) => {
    html += `<tr>
      <td>${infoEscape(p.room.name)}</td>
      <td>${infoEscape(p.room.location || "-")}</td>
      <td>${infoEscape(p.room.dorm_type)}</td>
      <td>${p.room.avail_beds}</td>
      <td>${p.assigned}</td>
    </tr>`;
  });
  if (gap > 0) {
    html += `<tr class="rooming-gap-row"><td colspan="5">⚠️ 分配后仍缺 ${gap} 床，请考虑加床或调整其他营期</td></tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function exportRoomingSuggestionCSV(eventId) {
  const evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  const s = generateRoomingSuggestion(eventId);
  const lines = [
    "\uFEFF" +
      ["营期", "性别需求", "房间", "位置", "类型", "分配人数"]
        .map(csvCell)
        .join(","),
  ];
  s.malePlan.forEach((p) =>
    lines.push(
      [
        evt.name,
        "男众",
        p.room.name,
        p.room.location || "",
        p.room.dorm_type,
        p.assigned,
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  s.femalePlan.forEach((p) =>
    lines.push(
      [
        evt.name,
        "女众",
        p.room.name,
        p.room.location || "",
        p.room.dorm_type,
        p.assigned,
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  s.flexRecommendations.forEach((r) =>
    lines.push(
      [
        evt.name,
        r.toGender + "(调剂)",
        r.room.name,
        r.room.location || "",
        "不限",
        r.beds,
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `rooming_suggestion_${evt.id}.csv`);
}

/* ============================================================
   营期招生进度图表 | Event Progress Chart
   ============================================================ */

function renderEventProgressChart(events) {
  if (typeof Chart === "undefined") return;
  const activeEvents = events
    .filter((e) => e.expected_count > 0 && e.status !== "已取消")
    .slice(0, 12);
  if (activeEvents.length === 0) return;

  const T = getChartTheme();
  const labels = activeEvents.map((e) => e.name);
  const registered = activeEvents.map(
    (e) => (e.checked_in || 0) + (e.reserved || 0),
  );
  const gaps = activeEvents.map((e) =>
    Math.max(0, e.expected_count - (e.checked_in || 0) - (e.reserved || 0)),
  );

  createKetangChart("events-progress", "chart-events-progress", {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "已报名",
          data: registered,
          backgroundColor: T.registered,
          stack: "Stack 0",
        },
        { label: "差额", data: gaps, backgroundColor: T.gap, stack: "Stack 0" },
      ],
    },
    options: {
      indexAxis: "y",
      scales: {
        x: { stacked: true },
        y: { stacked: true },
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterLabel: function (context) {
              const idx = context.dataIndex;
              const e = activeEvents[idx];
              const pct = e.expected_count
                ? Math.round(
                    (((e.checked_in || 0) + (e.reserved || 0)) /
                      e.expected_count) *
                      100,
                  )
                : 0;
              return "进度 " + pct + "%";
            },
          },
        },
      },
    },
  });
}

// 导出营期成员名单
function exportEventMembersCSV(eventId) {
  const evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) return;

  const lodgers = query(
    `
    SELECT l.name, l.dharma_name, l.gender, l.phone, l.check_in_date, l.expected_check_out, l.role, l.class_name, l.participant_identity, l.age_group, l.special_needs, l.status, r.name as room_name, b.bed_number, '在住' as kind
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.event_id = ? AND l.status = '在住'
    ORDER BY l.name
  `,
    [eventId],
  );

  const reservations = query(
    `
    SELECT r.name, r.dharma_name, r.gender, r.phone, r.expected_check_in, r.expected_check_out, r.role, r.class_name, r.participant_identity, r.age_group, r.special_needs, r.status, '' as room_name, '' as bed_number, '预约' as kind
    FROM reservations r
    WHERE r.event_id = ?
    ORDER BY r.status, r.name
  `,
    [eventId],
  );

  const members = [...lodgers, ...reservations];
  const headers = [
    "姓名 / 法名",
    "性别",
    "手机号",
    "身份",
    "排房身份",
    "年龄段",
    "特殊需求（排房）",
    "班级",
    "类型",
    "状态",
    "入住/预计入住",
    "预离",
    "房间",
    "床位",
  ];
  const lines = ["\uFEFF" + headers.map(csvCell).join(",")];
  members.forEach((m) => {
    lines.push(
      [
        personDisplayName(m),
        m.gender || "",
        m.phone || "",
        m.role || "",
        m.participant_identity || "",
        m.age_group || "",
        m.special_needs || "",
        m.class_name || "",
        m.kind,
        m.status,
        m.check_in_date || m.expected_check_in || "",
        m.expected_check_out || "",
        m.room_name || "",
        m.bed_number || "",
      ]
        .map(csvCell)
        .join(","),
    );
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(
    blob,
    `event_members_${evt.id}_${sanitizeFilename(evt.name)}.csv`,
  );
}

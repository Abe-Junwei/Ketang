/* ============================================================
   营期管理 | Event / Program Management
   禅修营、法会、修道班等营期的增删改查与批量操作
   ============================================================ */

const EVENT_TYPE_OPTIONS = ["禅营", "禅七", "法会", "修道班", "其他"];
const EVENT_GENDER_OPTIONS = ["男众", "女众", "混合"];
const EVENT_STATUS_OPTIONS = ["筹备中", "招生中", "进行中", "已结束", "已取消"];
var EVENT_MEMBER_BATCH_PENDING = null;

function eventWriteRefreshOptions() {
  if (document.getElementById("view-info")?.classList.contains("active")) {
    return {
      infoOnly: true,
      infoTab: "events",
      deferSyncRender: true,
      skipModuleSync: true,
      quietSync: true,
      skipViewRefresh: true,
    };
  }
  return {
    deferSyncRender: true,
    skipModuleSync: true,
    quietSync: true,
    skipViewRefresh: true,
  };
}

/** 营期写后：服务端 patches + 即时列表 + 后台对账 | Event post-write refresh */
function eventRefreshAfterWrite(writeResult, options) {
  if (typeof rcRefreshAfterWrite !== "function") return;
  rcRefreshAfterWrite(
    writeResult,
    Object.assign(
      {},
      eventWriteRefreshOptions(),
      {
        skipViewRefresh: false,
        viewRefresh: function () {
          if (
            document
              .getElementById("view-info")
              ?.classList.contains("active") &&
            typeof infoCurrentTab !== "undefined" &&
            infoCurrentTab === "events" &&
            typeof infoRenderCurrentTabLists === "function"
          ) {
            infoRenderCurrentTabLists();
          } else if (typeof renderEventList === "function") {
            renderEventList();
          }
        },
      },
      options || {},
    ),
  );
}

function eventUseApiData() {
  return typeof useOnlineDataPath === "function" && useOnlineDataPath();
}

/** 营期表单保存保护兜底 | Fallback pending guard for event forms */
function eventBeginActionPending(source, pendingText) {
  if (typeof beginActionPending === "function") {
    return beginActionPending(source, pendingText);
  }
  var form = source && (source.currentTarget || source.target || source);
  if (!form || !form.querySelector) return function () {};
  if (form.dataset.actionPending === "1") return null;
  var button = form.querySelector("button[type='submit']");
  var oldText = button ? button.textContent : null;
  var oldDisabled = button ? button.disabled : false;
  form.dataset.actionPending = "1";
  if (button) {
    button.disabled = true;
    button.textContent = pendingText || "保存中…";
  }
  return function finishEventPending() {
    if (button) {
      button.disabled = oldDisabled;
      if (oldText != null) button.textContent = oldText;
    }
    delete form.dataset.actionPending;
  };
}

function eventBuildOptimisticRow(eventId, core) {
  return Object.assign(
    {
      checked_in: 0,
      reserved: 0,
      total_lodgers: 0,
    },
    core,
    { id: eventId },
  );
}

/** 立即 patch 营期列表 | Optimistic event list patch */
function eventApplyOptimistic(optimistic) {
  if (!eventUseApiData() || !optimistic) return;
  if (typeof rcBootstrapPatchTable === "function") {
    rcBootstrapPatchTable("events", "events");
  }
  if (typeof infoApplyOptimistic === "function") {
    infoApplyOptimistic(optimistic, "events");
    return;
  }
  if (typeof rcApplyDeltaPatches !== "function") return;
  rcApplyDeltaPatches(optimistic.patches || {}, optimistic.deletions || []);
  if (
    document.getElementById("view-info")?.classList.contains("active") &&
    typeof infoCurrentTab !== "undefined" &&
    infoCurrentTab === "events" &&
    typeof infoRenderCurrentTabLists === "function"
  ) {
    infoRenderCurrentTabLists();
  } else if (typeof renderEventList === "function") {
    renderEventList();
  }
}

/** 创建成功后移除临时 id | Drop optimistic temp row after create */
function eventFinalizeWriteResult(writeResult, tempId) {
  if (!writeResult || tempId == null) return writeResult;
  var out = Object.assign({}, writeResult);
  out.deletions = (out.deletions || []).concat([
    { table_name: "events", row_id: tempId },
  ]);
  return out;
}

/** API 失败后回滚营期列表 | Revert optimistic event list */
async function eventRevertAfterWriteFailure() {
  if (typeof infoRevertTab === "function") {
    await infoRevertTab("events");
    return;
  }
  if (typeof rcEnsureEvents === "function") {
    try {
      await rcEnsureEvents(true);
    } catch (err) {
      console.warn("event revert fetch failed:", err.message || err);
    }
  }
  if (typeof renderEventList === "function") renderEventList();
}

function eventMemberViewRefresh(eventId) {
  return function () {
    if (eventId) renderEventMembers(eventId);
    else if (typeof renderEventList === "function") renderEventList();
  };
}

function eventReadReady() {
  if (typeof readUseCachedModule === "function") {
    return readUseCachedModule("events");
  }
  return typeof readUseRc === "function" && readUseRc();
}

/** 营期列表可渲染：全局 rc 就绪或 events 模块已缓存 | Event list renderable */
function eventListDataReady() {
  if (eventReadReady()) return true;
  if (
    eventUseApiData() &&
    typeof rcModuleCached === "function" &&
    rcModuleCached("events")
  ) {
    return true;
  }
  return !eventUseApiData();
}

function eventGetById(id) {
  return typeof readEventById === "function" ? readEventById(id) : null;
}

function eventMemberEventId(item) {
  if (!item) return null;
  if (item.kind === "reservation") {
    var resv =
      typeof readReservation === "function" ? readReservation(item.id) : null;
    return resv ? resv.event_id : null;
  }
  var lodger = typeof readLodger === "function" ? readLodger(item.id) : null;
  return lodger ? lodger.event_id : null;
}

function applyEventMembersOptimistic(items, action) {
  if (
    !eventReadReady() ||
    !items ||
    !items.length ||
    typeof rcApplyDeltaPatches !== "function"
  ) {
    return null;
  }
  var original = { reservations: [], lodgers: [] };
  var patches = { reservations: [], lodgers: [] };
  items.forEach(function (item) {
    if (item.kind === "reservation") {
      var row = rcRows("reservations", "reservations").find(function (r) {
        return r.id == item.id;
      });
      if (!row) return;
      original.reservations.push(Object.assign({}, row));
      patches.reservations.push(
        Object.assign({}, row, {
          status: action === "noshow" ? "No-show" : "已取消",
        }),
      );
      return;
    }
    if (item.kind === "lodger" && action === "cancel") {
      var lodger =
        typeof rcLodgerById === "function"
          ? rcLodgerById(item.id)
          : rcAllLodgersMerged().find(function (l) {
              return l.id == item.id;
            });
      if (!lodger) return;
      original.lodgers.push(Object.assign({}, lodger));
      patches.lodgers.push(
        Object.assign({}, lodger, {
          status: "已取消",
          bed_id: null,
          actual_check_out: typeof todayStr === "function" ? todayStr() : null,
        }),
      );
    }
  });
  if (!patches.reservations.length && !patches.lodgers.length) return null;
  rcApplyDeltaPatches(patches, []);
  return original;
}

function rollbackEventMembersOptimistic(original) {
  if (!original || typeof rcApplyDeltaPatches !== "function") return true;
  try {
    rcApplyDeltaPatches(
      {
        reservations: original.reservations || [],
        lodgers: original.lodgers || [],
      },
      [],
    );
    return true;
  } catch (e) {
    console.warn("event members optimistic rollback failed:", e.message || e);
    return false;
  }
}

async function forceRefreshEventMembers() {
  var ok = true;
  if (typeof rcEnsureEvents === "function") {
    try {
      await rcEnsureEvents(true);
    } catch (e) {
      console.warn("event members events refresh failed:", e.message || e);
      ok = false;
    }
  }
  if (typeof rcEnsureViewModules === "function") {
    try {
      await rcEnsureViewModules("info_events", true);
    } catch (e) {
      console.warn("event members force refresh failed:", e.message || e);
      ok = false;
    }
  }
  return ok;
}

function eventRelatedCount(eventId) {
  return typeof readEventRelatedCount === "function"
    ? readEventRelatedCount(eventId)
    : 0;
}

// 营期列表（用于基础设置页）
function renderEventList() {
  if (typeof updateTopbarForInfoTab === "function") {
    updateTopbarForInfoTab("events");
  }
  const f = infoGetFilters("events");
  const canSettingsWrite =
    typeof hasPermission === "function" && hasPermission("settings.write");
  const canRoomingPlan =
    typeof hasPermission === "function" && hasPermission("settings.read");
  if (!eventListDataReady()) {
    if (eventUseApiData()) {
      infoPageShell(
        infoToolbarHtml(
          `${infoSearchBox("events", "搜索营期名称…")}
     ${infoFilterSelect(
       "events",
       "eventType",
       "类型筛选",
       EVENT_TYPE_OPTIONS.map((t) => [t, t]),
       "类型筛选",
     )}`,
          canSettingsWrite
            ? `<button type="button" class="btn btn-primary" onclick="openEventModal()">+ 新增营期</button>`
            : "",
        ),
        '<p class="empty-tip">数据加载中，请稍候…</p>',
      );
      return;
    }
  }
  const events =
    typeof readEventListWithStats === "function"
      ? readEventListWithStats()
      : [];

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
    canSettingsWrite
      ? `<button type="button" class="btn btn-primary" onclick="openEventModal()">+ 新增营期</button>`
      : "",
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
          ${canSettingsWrite ? `<button class="btn btn-sm btn-default" onclick="openEventModal(${e.id})">编辑</button>` : ""}
          <button class="btn btn-sm btn-primary" onclick="renderEventMembers(${e.id})">成员 / 批量取消</button>
          ${canRoomingPlan ? `<button class="btn btn-sm btn-warning" onclick="renderRoomingPlan(${e.id})">预分房</button>` : ""}
          <button class="btn btn-sm btn-success" onclick="openRoomingSuggestion(${e.id})">排房建议</button>
          ${canSettingsWrite ? `<button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.id})">删除</button>` : ""}
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
  var pack =
    eventReadReady() && typeof rcEventMembers === "function"
      ? rcEventMembers(eventId)
      : null;
  const evt = pack ? pack.evt : eventGetById(eventId);
  if (!evt) {
    if (eventUseApiData()) {
      infoSetToolbar(
        infoToolbarHtml(
          "",
          `<button type="button" class="btn btn-default" onclick="renderEventList()">← 返回营期列表</button>`,
        ),
      );
      infoPageShell("", '<p class="empty-tip">数据加载中，请稍候…</p>');
    }
    return;
  }
  if (typeof updateTopbarTitle === "function") {
    updateTopbarTitle("info", (evt.name || "营期") + " · 成员");
  }

  const lodgers = pack
    ? pack.lodgers
    : typeof readEventMemberLodgers === "function"
      ? readEventMemberLodgers(eventId)
      : [];

  const reservations = pack
    ? pack.reservations
    : typeof readEventMemberReservations === "function"
      ? readEventMemberReservations(eventId)
      : [];

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

  const batchPending =
    EVENT_MEMBER_BATCH_PENDING && EVENT_MEMBER_BATCH_PENDING.eventId == eventId;
  html += `
    <div class="btn-bar" style="margin-bottom: var(--space-3);">
      <button class="btn btn-warning" onclick="batchNoShowEventMembers(event.currentTarget)" ${batchPending ? "disabled>保存中…" : ">批量标记 No-show"}</button>
      <button class="btn btn-danger" onclick="batchCancelEventMembers(event.currentTarget)" ${batchPending ? "disabled>保存中…" : ">批量取消"}</button>
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
    selected.push({ id: parseInt(cb.dataset.id, 10), kind: cb.dataset.kind });
  });
  return selected;
}

async function batchCancelEventMembers(source) {
  if (EVENT_MEMBER_BATCH_PENDING) return;
  const selected = getSelectedEventMembers();
  if (!selected.length) {
    alert("请先勾选要取消的成员");
    return;
  }
  if (!confirm(`确定要取消选中的 ${selected.length} 人吗？此操作不可恢复。`))
    return;

  let eventId = null;
  const first = selected[0];
  eventId = eventMemberEventId(first);

  EVENT_MEMBER_BATCH_PENDING = {
    eventId: eventId,
    action: "cancel",
    count: selected.length,
  };
  var original = applyEventMembersOptimistic(selected, "cancel");
  if (eventId) renderEventMembers(eventId);
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
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
      writeResult = { ok: true, local: true };
    } else {
      writeResult = await apiBatchEventMembers({
        action: "cancel",
        items: selected,
        event_id: eventId,
      });
    }
    var rollbackOk = original ? rollbackEventMembersOptimistic(original) : true;
    if (!rollbackOk) await forceRefreshEventMembers();
    if (rollbackOk) {
      var refreshTask = rcRefreshAfterWrite(writeResult, {
        viewRefresh: eventMemberViewRefresh(eventId),
      });
      if (refreshTask && typeof refreshTask.then === "function") {
        refreshTask.catch(function (err) {
          console.warn("event members refresh failed:", err.message || err);
          forceRefreshEventMembers();
        });
      }
    }
  } catch (e) {
    console.error(e);
    var rollbackOk = rollbackEventMembersOptimistic(original);
    var refreshOk = await forceRefreshEventMembers();
    if (!rollbackOk && !refreshOk) {
      alert(
        "批量取消失败，且无法恢复最新成员数据，请手动刷新页面：" + e.message,
      );
    } else {
      alert("批量取消失败：" + e.message);
    }
    return;
  } finally {
    EVENT_MEMBER_BATCH_PENDING = null;
    if (eventId) renderEventMembers(eventId);
  }
  showToast(`已取消 ${selected.length} 人`);
}

async function batchNoShowEventMembers(source) {
  if (EVENT_MEMBER_BATCH_PENDING) return;
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
  eventId = eventMemberEventId(first);

  EVENT_MEMBER_BATCH_PENDING = {
    eventId: eventId,
    action: "noshow",
    count: resvOnly.length,
  };
  var original = applyEventMembersOptimistic(resvOnly, "noshow");
  if (eventId) renderEventMembers(eventId);
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
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
      writeResult = { ok: true, local: true };
    } else {
      writeResult = await apiBatchEventMembers({
        action: "noshow",
        items: resvOnly,
        event_id: eventId,
      });
    }
    var rollbackOk = original ? rollbackEventMembersOptimistic(original) : true;
    if (!rollbackOk) await forceRefreshEventMembers();
    if (rollbackOk) {
      var refreshTask = rcRefreshAfterWrite(writeResult, {
        viewRefresh: eventMemberViewRefresh(eventId),
      });
      if (refreshTask && typeof refreshTask.then === "function") {
        refreshTask.catch(function (err) {
          console.warn("event members refresh failed:", err.message || err);
          forceRefreshEventMembers();
        });
      }
    }
  } catch (e) {
    console.error(e);
    var rollbackOk = rollbackEventMembersOptimistic(original);
    var refreshOk = await forceRefreshEventMembers();
    if (!rollbackOk && !refreshOk) {
      alert(
        "批量标记 No-show 失败，且无法恢复最新成员数据，请手动刷新页面：" +
          e.message,
      );
    } else {
      alert("批量标记 No-show 失败：" + e.message);
    }
    return;
  } finally {
    EVENT_MEMBER_BATCH_PENDING = null;
    if (eventId) renderEventMembers(eventId);
  }
  showToast(`已标记 ${resvOnly.length} 人为 No-show`);
}

// 营期编辑弹窗
function openEventModal(id) {
  if (typeof hasPermission === "function" && !hasPermission("settings.write")) {
    alert("需要信息管理编辑权限");
    return;
  }
  const isEdit = !!id;
  const e = isEdit ? eventGetById(id) : null;
  if (isEdit && !e) {
    alert(eventUseApiData() ? "数据加载中，请稍候再试" : "营期不存在");
    return;
  }

  document.getElementById("modal-title").textContent = isEdit
    ? "编辑营期"
    : "新增营期";
  setModalWide(true);
  setModalBody(`
          <form id="event-form" onsubmit="event.preventDefault(); submitEvent(event);">
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
  const includeSpareBeds = document.getElementById("event-include-spare")
    ?.checked
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

  const finishPending =
    typeof beginActionPending === "function"
      ? beginActionPending(e, "保存中…")
      : eventBeginActionPending(e, "保存中…");
  if (!finishPending) {
    showToast("正在保存，请稍候");
    return;
  }
  try {
    var writeResult = null;
    var apiPayload = {
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
    };
    if (isLocalForceDb()) {
      await withTransaction(async () => {
        if (id) {
          const old = query("SELECT status FROM events WHERE id=?", [id])[0];
          const oldStatus = old ? old.status : "";
          run(
            `UPDATE events SET name=?, event_type=?, gender_type=?, expected_count=?, start_date=?, end_date=?, status=?, notes=?, include_spare_beds=?, ${EVENT_ROOMING_DB_SET} WHERE id=?`,
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
    } else {
      var optimisticTempId = null;
      if (eventUseApiData()) {
        optimisticTempId = id
          ? null
          : typeof infoTempId === "function"
            ? infoTempId()
            : -Math.abs(Date.now());
        eventApplyOptimistic({
          patches: {
            events: [
              eventBuildOptimisticRow(id || optimisticTempId, {
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
              }),
            ],
          },
          deletions: [],
        });
        closeEventModal();
      }
      writeResult = await apiAdminRecord(
        "event",
        id ? "update" : "create",
        apiPayload,
      );
      if (optimisticTempId != null) {
        writeResult = eventFinalizeWriteResult(writeResult, optimisticTempId);
      }
    }
    if (isLocalForceDb()) {
      await saveDB();
      closeEventModal();
    }
    if (
      eventUseApiData() &&
      typeof infoRcTabDataReady === "function" &&
      !infoRcTabDataReady("events") &&
      typeof rcEnsureViewModules === "function"
    ) {
      try {
        await rcEnsureViewModules("info_events", true);
      } catch (fetchErr) {
        console.warn(
          "event post-write fetch failed:",
          fetchErr.message || fetchErr,
        );
      }
    }
    showToast("营期保存成功");
    eventRefreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    if (eventUseApiData()) await eventRevertAfterWriteFailure();
    alert("保存营期失败：" + e.message);
  } finally {
    finishPending();
  }
}

async function deleteEvent(id) {
  const e = eventGetById(id);
  if (!e) return;
  const related = eventRelatedCount(id);
  if (related > 0) {
    alert(`该营期下还有 ${related} 条记录，无法删除。请先取消或转移这些记录。`);
    return;
  }
  if (!confirm(`确定删除营期「${e.name}」吗？`)) return;
  try {
    var deleteResult = null;
    if (isLocalForceDb()) {
      await withTransaction(async () => {
        run("DELETE FROM events WHERE id = ?", [id]);
        logAudit("删除营期", "event", id, { name: e.name });
      });
      await saveDB();
    } else {
      if (eventUseApiData()) {
        eventApplyOptimistic({
          patches: {},
          deletions: [{ table_name: "events", row_id: id }],
        });
      }
      deleteResult = await apiAdminRecord("event", "delete", { event_id: id });
    }
    showToast("营期已删除");
    eventRefreshAfterWrite(deleteResult);
  } catch (e) {
    console.error(e);
    if (eventUseApiData()) await eventRevertAfterWriteFailure();
    alert("删除营期失败：" + e.message);
  }
}

// 生成营期下拉选项 HTML（供登记、预约、批量导入表单使用）
function getEventOptionsHtml(selectedId, allowEmpty) {
  const events =
    typeof readEventsForSelect === "function" ? readEventsForSelect() : [];
  let html = allowEmpty ? '<option value="">散客 / 不归属营期</option>' : "";
  events.forEach((e) => {
    const selected = e.id == selectedId ? "selected" : "";
    html += `<option value="${e.id}" ${selected}>${infoEscape(e.name)} (${infoEscape(e.event_type)})</option>`;
  });
  return html;
}

// 根据营期 ID 返回营期对象（用于批量导入时按名称匹配）
function findEventByName(name) {
  return typeof readFindEventByName === "function"
    ? readFindEventByName(name)
    : null;
}

/* ============================================================
   排房建议 | Rooming Suggestion
   ============================================================ */

async function openRoomingSuggestion(eventId) {
  if (!roomingUseLocalRead()) {
    await roomingEnsureEvent(eventId, false);
  }
  const evt = roomingGetEvent(eventId);
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
    bodyHtml += renderRoomingSuggestionTable(
      suggestion.malePlan,
      suggestion.maleGap,
    );
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
  const evt = roomingGetEvent(eventId);
  if (!evt) return null;

  var members =
    typeof readEventMemberGenders === "function"
      ? readEventMemberGenders(eventId)
      : [];

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
  const availRooms = roomingReadReady()
    ? roomingAvailRoomsGrouped(evt)
    : typeof readAvailRoomsGroupedForEvent === "function"
      ? readAvailRoomsGroupedForEvent(evt)
      : [];

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
  const evt = roomingGetEvent(eventId) || eventGetById(eventId);
  const s = generateRoomingSuggestion(eventId);
  if (!evt || !s) return;
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
  var evt = eventGetById(eventId);
  if (!evt) return;
  var lodgers =
    typeof readEventMemberLodgers === "function"
      ? readEventMemberLodgers(eventId)
      : [];
  var reservations =
    typeof readEventMemberReservationsForExport === "function"
      ? readEventMemberReservationsForExport(eventId)
      : typeof readEventMemberReservations === "function"
        ? readEventMemberReservations(eventId)
        : [];
  var members = lodgers
    .map(function (l) {
      return Object.assign({}, l, { kind: "在住" });
    })
    .concat(
      reservations.map(function (r) {
        return Object.assign({}, r, {
          kind: "预约",
          room_name: "",
          bed_number: "",
          check_in_date: r.expected_check_in,
        });
      }),
    );
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

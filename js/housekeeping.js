function getHouseStatus(bedId) {
  const row = query(
    "SELECT * FROM housekeeping WHERE bed_id = ? ORDER BY changed_at DESC LIMIT 1",
    [bedId],
  )[0];
  return row ? row.status : "净房";
}

function setHouseStatus(bedId, status, notes, operator) {
  run(
    "INSERT INTO housekeeping (bed_id, status, operator, notes) VALUES (?, ?, ?, ?)",
    [bedId, status, operator || null, notes || null],
  );
}

function isBedAssignable(bedId) {
  const bed = query("SELECT * FROM beds WHERE id = ?", [bedId])[0];
  if (!bed || bed.status === "维修" || bed.status === "备用") return false;
  const occ =
    query(
      "SELECT COUNT(*) as c FROM lodgers WHERE bed_id = ? AND status = '在住'",
      [bedId],
    )[0]?.c || 0;
  if (occ > 0) return false;
  const hk = getHouseStatus(bedId);
  return hk === "净房" || hk === "可用";
}

function renderHousekeeping() {
  const grid = document.getElementById("hk-grid");
  grid.innerHTML = "";
  const rooms = query("SELECT * FROM rooms ORDER BY id");
  rooms.forEach((r) => {
    if (typeof isSpareRoom === "function" && isSpareRoom(r)) return;
    const beds = query(
      `
      SELECT b.*, l.id as lodger_id, l.name, l.dharma_name
      FROM beds b
      LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
      WHERE b.room_id = ? AND b.status != '备用'
      ORDER BY b.id
    `,
      [r.id],
    );
    beds.forEach((b) => {
      const hk = getHouseStatus(b.id);
      const div = document.createElement("div");
      const occupied = !!b.lodger_id;
      div.className =
        "room " + (hk === "脏房" ? "partial" : occupied ? "full" : "empty");
      div.innerHTML = `
        <div class="name">${escapeHtml(r.name)} / ${escapeHtml(b.bed_number)}</div>
        <div class="info">房务状态：${escapeHtml(hk)}</div>
        <div class="info">${b.lodger_id ? escapeHtml(personDisplayName(b)) + " 在住" : "无人"}</div>
        <div style="margin-top: var(--space-2); display: flex; gap: var(--space-1); flex-wrap: wrap;">
          ${hk === "脏房" ? `<button class="btn btn-success btn-sm" onclick="setHkAndRender(${b.id}, '净房')">已净房</button>` : ""}
          ${hk === "净房" ? `<button class="btn btn-primary btn-sm" onclick="setHkAndRender(${b.id}, '查房')">查房</button>` : ""}
          ${hk === "查房" ? `<button class="btn btn-success btn-sm" onclick="setHkAndRender(${b.id}, '可用')">可入住</button>` : ""}
          ${!b.lodger_id && hk !== "维修" ? `<button class="btn btn-warning btn-sm" onclick="setHkAndRender(${b.id}, '维修')">报修</button>` : ""}
          ${hk === "维修" ? `<button class="btn btn-default btn-sm" onclick="setHkAndRender(${b.id}, '净房')">维修完成</button>` : ""}
        </div>
      `;
      grid.appendChild(div);
    });
  });
}

async function setHkAndRender(bedId, status) {
  if (status === "维修") {
    const occ =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
        [bedId],
      )[0]?.c || 0;
    if (occ > 0) {
      alert("该床位当前有在住住客，不能设为维修");
      return;
    }
  }
  try {
    if (useRemoteWriteApi()) {
      await apiSetHouseStatus({
        bed_id: bedId,
        status: status,
        notes: `手动设置${status}`,
      });
    } else {
      await withTransaction(async () => {
        setHouseStatus(bedId, status, `手动设置${status}`);
        if (status === "维修")
          run("UPDATE beds SET status='维修' WHERE id=?", [bedId]);
        else if (status === "净房" || status === "可用") {
          const occ = query(
            "SELECT COUNT(*) as c FROM lodgers WHERE bed_id=? AND status='在住'",
            [bedId],
          )[0].c;
          if (occ === 0)
            run("UPDATE beds SET status='可用' WHERE id=?", [bedId]);
        }
        logAudit("房务状态变更", "bed", bedId, { status: status });
      });
      await saveDB();
    }
    renderHousekeeping();
    refreshAfterWrite();
  } catch (e) {
    console.error(e);
    alert("房务状态变更失败：" + e.message);
  }
}

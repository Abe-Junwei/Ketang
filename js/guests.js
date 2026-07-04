function guestUseLocalDb() {
  return typeof isLocalForceDb === "function" && isLocalForceDb();
}

function findGuestByPhoneOrIdCard(phone, idCard) {
  if (!phone && !idCard) return null;
  // Online: read from rc store; local/disaster: sql.js query
  if (!guestUseLocalDb()) {
    return typeof rcFindGuestByPhoneOrIdCard === "function"
      ? rcFindGuestByPhoneOrIdCard(phone, idCard)
      : null;
  }
  let sql = "SELECT * FROM guests WHERE ";
  const conds = [];
  const params = [];
  if (phone) {
    conds.push("phone = ?");
    params.push(phone);
  }
  if (idCard) {
    conds.push("id_card = ?");
    params.push(idCard);
  }
  sql += conds.join(" OR ");
  const rows = query(sql, params);
  return rows.length ? rows[0] : null;
}

function findGuestByDisplayName(displayName) {
  if (!displayName) return null;
  if (!guestUseLocalDb()) {
    return typeof rcFindGuestByDisplayName === "function"
      ? rcFindGuestByDisplayName(displayName)
      : null;
  }
  const rows = query(
    "SELECT * FROM guests WHERE name = ? OR dharma_name = ? OR trim(coalesce(name, '') || CASE WHEN dharma_name IS NOT NULL AND dharma_name != '' THEN ' ' || dharma_name ELSE '' END) = ? LIMIT 1",
    [displayName, displayName, displayName],
  );
  return rows.length ? rows[0] : null;
}

/** 本地/灾备写路径专用；在线创建走入住/预约/批量导入 API | Local-only write; online uses business APIs */
function findOrCreateGuest(displayName, gender, phone, idCard) {
  if (!guestUseLocalDb()) {
    throw new Error(
      "在线模式请通过业务 API 创建住客档案（入住/预约/批量导入）",
    );
  }
  const parsed = parsePersonNameInput(displayName);
  const name = parsed.name;
  if (!name) return null;
  let guest = null;
  if (phone || idCard) guest = findGuestByPhoneOrIdCard(phone, idCard);
  if (!guest) guest = findGuestByDisplayName(name);
  if (guest) {
    const updates = [];
    const params = [];
    if (gender && !guest.gender) {
      updates.push("gender = ?");
      params.push(gender);
    }
    if (phone && !guest.phone) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (idCard && !guest.id_card) {
      updates.push("id_card = ?");
      params.push(idCard);
    }
    if (updates.length) {
      params.push(new Date().toISOString());
      params.push(guest.id);
      run(
        `UPDATE guests SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`,
        params,
      );
    }
    return guest.id;
  }
  const result = run(
    `INSERT INTO guests (name, dharma_name, gender, phone, id_card, visit_count, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [
      name,
      null,
      gender || null,
      phone || null,
      idCard || null,
      new Date().toISOString(),
    ],
  );
  return result.lastInsertId;
}

function incrementGuestVisit(guestId, visitDate) {
  if (!guestUseLocalDb()) {
    throw new Error("在线模式请通过业务 API 更新住客到访次数");
  }
  run(
    "UPDATE guests SET visit_count = visit_count + 1, last_visit_date = ?, updated_at = ? WHERE id = ?",
    [visitDate || todayStr(), new Date().toISOString(), guestId],
  );
}

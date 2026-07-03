/* ============================================================
   校验引擎 | Validation Engine
   集中规则定义 + 声明式注册 → 入住/编辑复用同一规则
   Centralized rules + declarative registration → checkin/edit share rules
   ============================================================ */

// 集中规则定义 | Centralized rule definitions
function isPhoneLooseValid(v) {
  if (!v) return true;
  const raw = String(v).replace(/\s/g, "");
  if (/^1[3-9]\d{9}$/.test(raw)) return true;
  if (/^0\d{9,11}$/.test(raw)) return true;
  if (/^0\d{2,3}-?\d{7,8}$/.test(raw)) return true;
  if (/^\+\d{8,15}$/.test(raw)) return true;
  return false;
}

const RULES = {
  phoneLoose: {
    test: isPhoneLooseValid,
    msg: "请输入有效手机号、座机或国际号码（无手机号请填紧急联系人）",
  },
  phone: {
    test: isPhoneLooseValid,
    msg: "请输入有效手机号、座机或国际号码",
  },
  idCard: {
    test: (v) => !!v && /^\d{17}[\dXx]$/.test(String(v).trim()),
    msg: "请输入 18 位身份证号（末位可为 X）",
  },
  required: {
    test: (v) => v && v.trim().length > 0,
    msg: "此项为必填",
  },
};

// 字段→规则映射（声明式注册）| Field→Rule mapping (declarative registration)
const FIELD_RULES = {};

function registerValidation(fieldId, ruleName) {
  if (!FIELD_RULES[fieldId]) FIELD_RULES[fieldId] = [];
  FIELD_RULES[fieldId].push(ruleName);
}

// 注册入住表单 | Register checkin form
registerValidation("ci-name", "required");
registerValidation("ci-phone", "phoneLoose");
registerValidation("ci-idcard", "required");
registerValidation("ci-idcard", "idCard");
registerValidation("ci-emergency-phone", "phoneLoose");
// 注册编辑表单（字段在弹窗中动态创建，规则预先注册）| Register edit form (fields created dynamically, rules pre-registered)
registerValidation("edit-name", "required");
registerValidation("edit-phone", "phoneLoose");
registerValidation("edit-idcard", "required");
registerValidation("edit-idcard", "idCard");
registerValidation("edit-emergency-phone", "phoneLoose");
// 注册预约表单 | Register reservation form
registerValidation("resv-phone", "phoneLoose");
registerValidation("resv-idcard", "required");
registerValidation("resv-idcard", "idCard");
registerValidation("resv-emergency-phone", "phoneLoose");

function normalizePhoneInput(value) {
  if (value == null || value === "") return null;
  return String(value).replace(/\s/g, "");
}

/** 身份证 + 手机号/紧急联系人组合校验 | ID + phone/emergency composite validation */
function validateGuestContact(opts) {
  const idRaw = (opts.idCard || "").trim().toUpperCase();
  if (!idRaw) {
    return { ok: false, msg: "身份证为必填项", field: "idcard" };
  }
  if (!RULES.idCard.test(idRaw)) {
    return { ok: false, msg: RULES.idCard.msg, field: "idcard" };
  }

  const phone = normalizePhoneInput(opts.phone);
  if (phone) {
    if (!RULES.phoneLoose.test(phone)) {
      return { ok: false, msg: RULES.phoneLoose.msg, field: "phone" };
    }
    return { ok: true, idCard: idRaw, phone: phone };
  }

  const emergencyName = (opts.emergencyName || "").trim();
  const emergencyPhone = normalizePhoneInput(opts.emergencyPhone);
  if (!emergencyName || !emergencyPhone) {
    return {
      ok: false,
      msg: "无手机号时请填写紧急联系人和联系电话",
      field: "emergency",
    };
  }
  if (!RULES.phoneLoose.test(emergencyPhone)) {
    return {
      ok: false,
      msg: "紧急联系电话格式不正确",
      field: "emergency_phone",
    };
  }
  return {
    ok: true,
    idCard: idRaw,
    phone: null,
    emergencyName: emergencyName,
    emergencyPhone: emergencyPhone,
  };
}

function validateEditLodgerContact(lodgerId, phone, idCard, emergencyOverride) {
  let emergencyName = "";
  let emergencyPhone = "";
  if (typeof readLodger === "function") {
    const row = readLodger(lodgerId);
    if (row && row.guest_id && typeof readGuest === "function") {
      const guest = readGuest(row.guest_id);
      if (guest) {
        emergencyName = guest.emergency_contact || "";
        emergencyPhone = guest.emergency_phone || "";
      }
    }
  } else {
    const row = query("SELECT guest_id FROM lodgers WHERE id=?", [lodgerId])[0];
    if (row?.guest_id) {
      const guest = query(
        "SELECT emergency_contact, emergency_phone FROM guests WHERE id=?",
        [row.guest_id],
      )[0];
      if (guest) {
        emergencyName = guest.emergency_contact || "";
        emergencyPhone = guest.emergency_phone || "";
      }
    }
  }
  if (emergencyOverride) {
    if (emergencyOverride.emergencyName !== undefined) {
      emergencyName = emergencyOverride.emergencyName;
    }
    if (emergencyOverride.emergencyPhone !== undefined) {
      emergencyPhone = emergencyOverride.emergencyPhone;
    }
  }
  return validateGuestContact({
    phone: phone,
    idCard: idCard,
    emergencyName: emergencyName,
    emergencyPhone: emergencyPhone,
  });
}

/** 批量/CSV 行校验 | Batch row validation */
function validateGuestContactRow(row) {
  return validateGuestContact({
    phone: row.phone,
    idCard: row.id_card,
    emergencyName: row.emergency_name || row.emergency_contact,
    emergencyPhone: row.emergency_phone,
  });
}

function alertGuestContactError(result) {
  alert(result.msg);
  if (result.field === "idcard") {
    const el =
      document.getElementById("ci-idcard") ||
      document.getElementById("resv-idcard") ||
      document.getElementById("edit-idcard");
    if (el) el.focus();
    return;
  }
  if (result.field === "phone") {
    const el =
      document.getElementById("ci-phone") ||
      document.getElementById("resv-phone") ||
      document.getElementById("edit-phone");
    if (el) el.focus();
    return;
  }
  const emergency =
    document.getElementById("ci-emergency-name") ||
    document.getElementById("resv-emergency-name") ||
    document.getElementById("edit-emergency-name");
  if (emergency) emergency.focus();
}

// 实时单字段校验 | Real-time single field validation
function validateField(input) {
  // 去掉格式化空格再校验 | Strip formatting spaces before validation
  let raw = (input.value || "").replace(/\s/g, "");
  const errorEl = document.getElementById(input.id + "-error");
  const ruleNames = FIELD_RULES[input.id];

  if (!ruleNames) return true;

  // 遍历规则，找到第一个失败的 | Iterate rules, find first failure
  let firstError = null;
  for (const name of ruleNames) {
    const rule = RULES[name];
    if (!rule) continue;
    const testValue =
      name === "idCard"
        ? String(input.value || "")
            .trim()
            .toUpperCase()
        : raw;
    if (!rule.test(testValue)) {
      firstError = rule.msg;
      break;
    }
  }

  if (firstError) {
    input.classList.add("invalid");
    input.classList.remove("valid");
    if (input.tagName === "SELECT" && typeof refreshSelectPicker === "function")
      refreshSelectPicker(input);
    if (errorEl) {
      errorEl.textContent = "⚠ " + firstError;
      errorEl.classList.add("visible");
    }
    return false;
  }

  // 全部通过 | All passed
  input.classList.add("valid");
  input.classList.remove("invalid");
  if (input.tagName === "SELECT" && typeof refreshSelectPicker === "function")
    refreshSelectPicker(input);
  if (errorEl) errorEl.classList.remove("visible");
  return true;
}

// 批量校验（提交时使用）| Batch validation (for submit)
function validateFields(fieldIds) {
  let allValid = true;
  for (const id of fieldIds) {
    const input = document.getElementById(id);
    if (!input) continue;
    if (!validateField(input)) allValid = false;
  }
  return allValid;
}

function checkDuplicate(phone, idCard, excludeId) {
  if (!phone && !idCard) return null;
  if (
    typeof readUseRc === "function" &&
    readUseRc() &&
    typeof rcRows === "function"
  ) {
    const rows = rcRows("lodgers", "lodgers").filter(function (l) {
      if (l.status !== "在住") return false;
      if (excludeId && l.id == excludeId) return false;
      if (phone && l.phone === phone) return true;
      if (idCard && l.id_card === idCard) return true;
      return false;
    });
    return rows.length > 0 ? rows[0] : null;
  }
  if (!isLocalForceDb()) return null;
  let sql = "SELECT * FROM lodgers WHERE status='在住' AND (";
  const params = [];
  const conds = [];
  if (phone) {
    conds.push("phone = ?");
    params.push(phone);
  }
  if (idCard) {
    conds.push("id_card = ?");
    params.push(idCard);
  }
  sql += conds.join(" OR ") + ")";
  if (excludeId) {
    sql += " AND id != ?";
    params.push(excludeId);
  }
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// 输入拦截：大陆手机号分段；座机/国际号保留原样 | Phone input filter
function filterPhoneLoose(input) {
  let raw = input.value.replace(/[^\d+\-]/g, "");
  if (raw.startsWith("+") || raw.startsWith("0")) {
    input.value = raw;
    validateField(input);
    return;
  }
  raw = raw.replace(/\D/g, "");
  if (raw.length > 11) raw = raw.slice(0, 11);
  let formatted = raw;
  if (raw.length > 3 && raw.length <= 7) {
    formatted = raw.slice(0, 3) + " " + raw.slice(3);
  } else if (raw.length > 7) {
    formatted = raw.slice(0, 3) + " " + raw.slice(3, 7) + " " + raw.slice(7);
  }
  input.value = formatted;
  validateField(input);
}

// 兼容旧 onclick | Back-compat alias
function filterDigits(input) {
  filterPhoneLoose(input);
}

// 输入拦截：只允许数字和 X | Input filter: digits and X only
function filterIdCard(input) {
  input.value = input.value.replace(/[^\dXx]/g, "").toUpperCase();
  if (input.value.length > 18) input.value = input.value.slice(0, 18);
  validateField(input);
}

// 校验防抖（300ms）| Validation debounce (300ms)
const _debounceTimers = {};
function validateFieldDebounced(input, delay) {
  delay = delay || 300;
  const id = input.id;
  if (_debounceTimers[id]) clearTimeout(_debounceTimers[id]);
  _debounceTimers[id] = setTimeout(function () {
    validateField(input);
  }, delay);
}

// 滚动到第一个错误字段 | Scroll to first error field
function scrollToFirstError(fieldIds) {
  for (let i = 0; i < fieldIds.length; i++) {
    let input = document.getElementById(fieldIds[i]);
    if (input && input.classList.contains("invalid")) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus();
      return;
    }
  }
}

/* ============================================================
   校验引擎 | Validation Engine
   集中规则定义 + 声明式注册 → 入住/编辑复用同一规则
   Centralized rules + declarative registration → checkin/edit share rules
   ============================================================ */

// 集中规则定义 | Centralized rule definitions
const RULES = {
  phone: {
    test: (v) => !v || /^1[3-9]\d{9}$/.test(v),
    msg: "请输入 11 位有效手机号（1 开头，第二位 3-9）",
  },
  idCard: {
    test: (v) => !v || /^\d{17}[\dXx]$/.test(v),
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
registerValidation("ci-phone", "phone");
registerValidation("ci-idcard", "idCard");
// 注册编辑表单（字段在弹窗中动态创建，规则预先注册）| Register edit form (fields created dynamically, rules pre-registered)
registerValidation("edit-name", "required");
registerValidation("edit-phone", "phone");
registerValidation("edit-idcard", "idCard");
// 注册预约表单 | Register reservation form
registerValidation("resv-phone", "phone");
registerValidation("resv-idcard", "idCard");

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
    if (!rule.test(raw)) {
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

// 输入拦截：只允许数字 | Input filter: digits only
function filterDigits(input) {
  let cursor = input.selectionStart;
  const oldLen = input.value.length;
  // 去除非数字 | Strip non-digits
  let raw = input.value.replace(/\D/g, "");
  // 限 11 位 | Max 11 digits
  if (raw.length > 11) raw = raw.slice(0, 11);
  // 3-4-4 分段（支付宝/银行风格）| 3-4-4 segment (Alipay/bank style)
  let formatted = raw;
  if (raw.length > 3 && raw.length <= 7) {
    formatted = raw.slice(0, 3) + " " + raw.slice(3);
  } else if (raw.length > 7) {
    formatted = raw.slice(0, 3) + " " + raw.slice(3, 7) + " " + raw.slice(7);
  }
  input.value = formatted;
  // 保持光标位置 | Preserve cursor position
  const newLen = input.value.length;
  if (cursor === oldLen) input.setSelectionRange(newLen, newLen);
  validateField(input);
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

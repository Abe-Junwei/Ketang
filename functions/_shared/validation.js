/** 住客字段校验（服务端）| Guest field validation (server) */

function isValidPhoneLoose(value) {
  const v = String(value || "").replace(/\s/g, "");
  if (!v) return false;
  if (/^1[3-9]\d{9}$/.test(v)) return true;
  if (/^0\d{9,11}$/.test(v)) return true;
  if (/^0\d{2,3}-?\d{7,8}$/.test(v)) return true;
  if (/^\+\d{8,15}$/.test(v)) return true;
  return false;
}

export function normalizePhone(value) {
  if (value == null || value === "") return null;
  return String(value).replace(/\s/g, "");
}

export function assertIdCard(idCard) {
  const v = String(idCard || "")
    .trim()
    .toUpperCase();
  if (!v) throw new Error("身份证为必填项");
  if (!/^\d{17}[\dX]$/.test(v)) throw new Error("请输入 18 位有效身份证号");
  return v;
}

export function assertPhoneOrEmergency(phone, emergencyName, emergencyPhone) {
  const p = normalizePhone(phone);
  if (p) {
    if (!isValidPhoneLoose(p)) throw new Error("手机号/电话格式不正确");
    return p;
  }
  const name = String(emergencyName || "").trim();
  const ep = normalizePhone(emergencyPhone);
  if (!name || !ep) {
    throw new Error("无手机号时请填写紧急联系人和联系电话");
  }
  if (!isValidPhoneLoose(ep)) {
    throw new Error("紧急联系电话格式不正确");
  }
  return null;
}

/** 入住/预约共用校验 | Shared check-in / reservation validation */
export function assertGuestIdentityFields(body) {
  const idCard = assertIdCard(body.id_card);
  const phone = assertPhoneOrEmergency(
    body.phone,
    body.emergency_name,
    body.emergency_phone,
  );
  return { idCard, phone };
}

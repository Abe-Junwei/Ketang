/* 云端业务 API 客户端 | Remote business API client */

function apiAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token =
    typeof getRemoteSessionToken === "function" ? getRemoteSessionToken() : "";
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function handleApiUnauthorized() {
  if (typeof clearAuthSession === "function") clearAuthSession();
  if (typeof stopBoardPolling === "function") stopBoardPolling();
  if (typeof showLoginOverlay === "function") showLoginOverlay();
}

async function apiFetch(path, options) {
  const response = await fetch(path, {
    method: options?.method || "GET",
    headers: apiAuthHeaders(),
    body: options?.body != null ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  if (response.status === 401) handleApiUnauthorized();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function remoteDBRequestAsync(payload) {
  return apiFetch("/api/db", { method: "POST", body: payload });
}

async function remoteBatchQuery(queries) {
  const result = await remoteDBRequestAsync({
    action: "batch_query",
    queries: queries,
  });
  return result.results || [];
}

async function apiCheckIn(payload) {
  return apiFetch("/api/v1/check-in", { method: "POST", body: payload });
}

async function apiCheckout(payload) {
  return apiFetch("/api/v1/checkout", { method: "POST", body: payload });
}

async function apiChangeBed(payload) {
  return apiFetch("/api/v1/change-bed", { method: "POST", body: payload });
}

async function apiExtendStay(payload) {
  return apiFetch("/api/v1/extend-stay", { method: "POST", body: payload });
}

async function apiAssignBed(payload) {
  return apiFetch("/api/v1/assign-bed", { method: "POST", body: payload });
}

async function apiEditLodger(payload) {
  return apiFetch("/api/v1/edit-lodger", { method: "POST", body: payload });
}

async function apiDeleteLodger(payload) {
  return apiFetch("/api/v1/delete-lodger", { method: "POST", body: payload });
}

async function apiSaveMeals(payload) {
  return apiFetch("/api/v1/save-meals", { method: "POST", body: payload });
}

async function apiSetHouseStatus(payload) {
  return apiFetch("/api/v1/set-house-status", {
    method: "POST",
    body: payload,
  });
}

async function apiUpsertReservation(payload) {
  return apiFetch("/api/v1/upsert-reservation", {
    method: "POST",
    body: payload,
  });
}

async function apiUpdateReservationStatus(payload) {
  return apiFetch("/api/v1/reservation-status", {
    method: "POST",
    body: payload,
  });
}

async function apiBatchEventMembers(payload) {
  return apiFetch("/api/v1/batch-event-members", {
    method: "POST",
    body: payload,
  });
}

async function apiBoardVersion() {
  return apiFetch("/api/v1/board-version");
}

async function apiSessionMe() {
  return apiFetch("/api/v1/session");
}

async function apiAdminListUsers() {
  return apiFetch("/api/v1/admin/users");
}

async function apiAdminCreateUser(payload) {
  return apiFetch("/api/v1/admin/users", {
    method: "POST",
    body: { action: "create", ...payload },
  });
}

async function apiAdminUpdateUser(payload) {
  return apiFetch("/api/v1/admin/users", {
    method: "POST",
    body: { action: "update", ...payload },
  });
}

async function apiAdminDeactivateUser(userId) {
  return apiFetch("/api/v1/admin/users", {
    method: "POST",
    body: { action: "deactivate", user_id: userId },
  });
}

async function apiAdminReactivateUser(userId) {
  return apiFetch("/api/v1/admin/users", {
    method: "POST",
    body: { action: "reactivate", user_id: userId },
  });
}

async function apiAdminResetUserPassword(userId, password) {
  return apiFetch("/api/v1/admin/users", {
    method: "POST",
    body: { action: "reset_password", user_id: userId, password: password },
  });
}

async function apiAdminRecord(resource, action, payload) {
  return apiFetch("/api/v1/admin/records", {
    method: "POST",
    body: { resource: resource, action: action, ...payload },
  });
}

async function apiChangePassword(oldPassword, newPassword) {
  return remoteDBRequestAsync({
    action: "change_password",
    old_password: oldPassword,
    new_password: newPassword,
  });
}

async function apiExportJsonBackup() {
  return apiFetch("/api/v1/admin/data-backup");
}

async function apiImportJsonBackup(tables) {
  return apiFetch("/api/v1/admin/data-backup", {
    method: "POST",
    body: { confirm: true, tables: tables },
  });
}

function useRemoteWriteApi() {
  return typeof isRemoteDB === "function" && isRemoteDB();
}

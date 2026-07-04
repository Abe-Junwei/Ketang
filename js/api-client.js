/* 云端业务 API 客户端 | Remote business API client */

var _refreshInFlight = null;

function remoteApiCredentials() {
  return typeof isRemoteDB === "function" && isRemoteDB()
    ? "include"
    : "same-origin";
}

function apiAuthHeaders() {
  return { "Content-Type": "application/json" };
}

function handleApiUnauthorized() {
  if (typeof clearAuthSession === "function") clearAuthSession();
  if (typeof stopBoardPolling === "function") stopBoardPolling();
  if (typeof showLoginOverlay === "function") showLoginOverlay();
}

async function parseJsonResponse(response) {
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  return data;
}

async function tryRefreshAccessToken() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return false;
  if (
    typeof isRemoteRefreshBlocked === "function" &&
    isRemoteRefreshBlocked()
  ) {
    return false;
  }
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async function () {
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data.user) return false;
      if (typeof applySessionRefresh === "function") applySessionRefresh(data);
      return true;
    } catch (e) {
      return false;
    } finally {
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

async function apiFetch(path, options) {
  options = options || {};
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: apiAuthHeaders(),
    credentials: options.credentials || remoteApiCredentials(),
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  let data = await parseJsonResponse(response);
  if (
    response.status === 401 &&
    !options.preserveSessionOn401 &&
    !options.skipRefreshRetry &&
    typeof isRemoteDB === "function" &&
    isRemoteDB()
  ) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      return apiFetch(path, {
        method: options.method,
        body: options.body,
        credentials: options.credentials,
        preserveSessionOn401: options.preserveSessionOn401,
        skipRefreshRetry: true,
      });
    }
  }
  if (response.status === 401) {
    if (!options.preserveSessionOn401) handleApiUnauthorized();
    throw new Error(data.error || "登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function apiReadModel(ifNoneMatch) {
  const headers = apiAuthHeaders();
  if (ifNoneMatch != null && ifNoneMatch !== "") {
    headers["If-None-Match"] = String(ifNoneMatch);
  }
  let response = await fetch("/api/v1/read-model", {
    method: "GET",
    headers: headers,
    credentials: "include",
  });
  if (response.status === 401) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      const headers2 = apiAuthHeaders();
      if (ifNoneMatch != null && ifNoneMatch !== "") {
        headers2["If-None-Match"] = String(ifNoneMatch);
      }
      response = await fetch("/api/v1/read-model", {
        method: "GET",
        headers: headers2,
        credentials: "include",
      });
    }
  }
  if (response.status === 401) {
    handleApiUnauthorized();
    throw new Error("登录已过期，请重新登录");
  }
  if (response.status === 304) {
    const etag = response.headers.get("ETag");
    return {
      notModified: true,
      version: etag != null ? parseInt(etag, 10) : ifNoneMatch,
    };
  }
  const data = await parseJsonResponse(response);
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

async function apiAuthLogin(body) {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "登录失败");
  return data;
}

async function apiAuthRefreshForRestore(options) {
  if (
    typeof isRemoteRefreshBlocked === "function" &&
    isRemoteRefreshBlocked()
  ) {
    throw new Error("登录已过期，请重新登录");
  }
  var bootstrapBoard = !!(options && options.bootstrapBoard);
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: bootstrapBoard ? { "Content-Type": "application/json" } : undefined,
    body: bootstrapBoard
      ? JSON.stringify({ bootstrap_board: true })
      : undefined,
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "登录已过期，请重新登录");
  return data;
}

async function apiAuthLogout() {
  try {
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    return response.ok;
  } catch (e) {
    return false;
  }
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

/** 启动恢复会话：401 时不立即清空，由 restoreRemoteSession 决定 | Boot-time session restore */
async function apiSessionMeForRestore(options) {
  var qs = options && options.bootstrapBoard ? "?bootstrap_board=1" : "";
  return apiFetch("/api/v1/session" + qs, { preserveSessionOn401: true });
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

async function apiAdminGetRolePermissions() {
  return apiFetch("/api/v1/admin/role-permissions");
}

async function apiAdminSaveRolePermissions(roles) {
  return apiFetch("/api/v1/admin/role-permissions", {
    method: "POST",
    body: { roles: roles },
  });
}

async function apiAdminGetOperationalSettings() {
  return apiFetch("/api/v1/admin/operational-settings");
}

async function apiAdminSaveOperationalSettings(settings) {
  return apiFetch("/api/v1/admin/operational-settings", {
    method: "POST",
    body: settings,
  });
}

async function apiFetchEtag(path, ifNoneMatch) {
  const headers = apiAuthHeaders();
  if (ifNoneMatch != null && ifNoneMatch !== "") {
    headers["If-None-Match"] = String(ifNoneMatch);
  }
  let response = await fetch(path, {
    method: "GET",
    headers: headers,
    credentials: "include",
  });
  if (response.status === 401) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      const headers2 = apiAuthHeaders();
      if (ifNoneMatch != null && ifNoneMatch !== "") {
        headers2["If-None-Match"] = String(ifNoneMatch);
      }
      response = await fetch(path, {
        method: "GET",
        headers: headers2,
        credentials: "include",
      });
    }
  }
  if (response.status === 401) {
    handleApiUnauthorized();
    throw new Error("登录已过期，请重新登录");
  }
  if (response.status === 304) {
    const etag = response.headers.get("ETag");
    return {
      notModified: true,
      board_version:
        etag != null ? parseInt(etag, 10) : parseInt(ifNoneMatch, 10),
    };
  }
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function apiReadHistoryPage(filters) {
  filters = filters || {};
  var q = new URLSearchParams();
  if (filters.start) q.set("start", filters.start);
  if (filters.end) q.set("end", filters.end);
  if (filters.kw) q.set("kw", filters.kw);
  if (filters.room) q.set("room", filters.room);
  if (filters.role && typeof lodgerRoleMatchValues === "function") {
    lodgerRoleMatchValues(filters.role).forEach(function (v) {
      q.append("roles", v);
    });
  }
  q.set("limit", String(filters.limit || 2000));
  return apiFetch(
    "/api/v1/read/lodgers_history_page?" + q.toString(),
  );
}

async function apiReadModule(moduleName, ifNoneMatch) {
  return apiFetchEtag(
    "/api/v1/read/" + encodeURIComponent(moduleName),
    ifNoneMatch,
  );
}

async function apiReadSettingsModule(resource, ifNoneMatch) {
  return apiFetchEtag(
    "/api/v1/read/settings/" + encodeURIComponent(resource),
    ifNoneMatch,
  );
}

async function apiSyncDelta(sinceVersion, ifNoneMatch) {
  const since = parseInt(sinceVersion, 10) || 0;
  return apiFetchEtag("/api/v1/sync/delta?since=" + since, ifNoneMatch);
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

async function apiRoomingPlanAction(action, payload) {
  return apiFetch("/api/v1/admin/rooming-plans", {
    method: "POST",
    body: Object.assign({ action: action }, payload || {}),
  });
}

async function apiReadEventDetail(eventId) {
  return apiFetch("/api/v1/read/event/" + encodeURIComponent(eventId));
}

/** 排房冲突只读（无草稿 assignments 时）| Rooming conflicts read */
async function apiReadEventConflicts(eventId, planId) {
  var q =
    "/api/v1/read/event/" +
    encodeURIComponent(eventId) +
    "?view=conflicts";
  if (planId) q += "&plan_id=" + encodeURIComponent(planId);
  return apiFetch(q);
}

/** 排房成员统计只读 | Event members for rooming plan */
async function apiReadEventMembers(eventId) {
  return apiFetch(
    "/api/v1/read/event/" +
      encodeURIComponent(eventId) +
      "?view=members",
  );
}

async function apiBatchCheckIn(payload) {
  return apiFetch("/api/v1/batch-check-in", {
    method: "POST",
    body: payload,
  });
}

function isLocalForceDb() {
  return typeof window !== "undefined" && window.KETANG_FORCE_LOCAL_DB === true;
}

function useRemoteWriteApi() {
  return typeof isRemoteDB === "function" && isRemoteDB() && !isLocalForceDb();
}

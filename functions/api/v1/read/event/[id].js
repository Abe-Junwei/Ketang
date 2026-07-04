import { requireSession } from "../../../../_shared/auth.js";
import {
  getBoardVersion,
  queryD1,
  safeErrorMessage,
} from "../../../../_shared/d1.js";
import { buildEventDetailModule } from "../../../../_shared/read-modules.js";
import {
  checkRoomingPlanConflicts,
  listEventMembersForPlan,
} from "../../../../_shared/rooming-plans.js";
import { createRequestTimer } from "../../../../_shared/timing.js";

/** GET /api/v1/read/event/:id — 单营期排房读模型；?view=conflicts|members */
export async function onRequestGet({ request, env, params }) {
  if (!env.KETANG_DB) {
    return new Response(JSON.stringify({ error: "缺少 D1 绑定 KETANG_DB" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const timer = createRequestTimer();
  try {
    const session = await timer.stage("auth_ms", () =>
      requireSession(request, env, (sql, p) => queryD1(env, sql, p)),
    );
    const eventId = params?.id;
    const url = new URL(request.url);
    const view = url.searchParams.get("view") || "detail";

    if (view === "conflicts") {
      const planId = parseInt(url.searchParams.get("plan_id") || "0", 10) || 0;
      const payload = await timer.stage("read_module_ms", () =>
        checkRoomingPlanConflicts(env, session, {
          event_id: eventId,
          plan_id: planId,
        }),
      );
      const version = await getBoardVersion(env);
      return timer.finish(
        Object.assign(
          { module: "event_conflicts", board_version: version },
          payload,
        ),
        request,
      );
    }

    if (view === "members") {
      const members = await timer.stage("read_module_ms", () =>
        listEventMembersForPlan(env, eventId),
      );
      const version = await getBoardVersion(env);
      let lodgerCount = 0;
      let reservationCount = 0;
      let male = 0;
      let female = 0;
      (members || []).forEach(function (m) {
        if (m.member_kind === "lodger") lodgerCount++;
        else if (m.member_kind === "reservation") reservationCount++;
        else return;
        if (m.member_gender === "男") male++;
        if (m.member_gender === "女") female++;
      });
      return timer.finish(
        {
          module: "event_members",
          event_id: parseInt(eventId, 10) || 0,
          board_version: version,
          members: members,
          stats: {
            total: lodgerCount + reservationCount,
            male: male,
            female: female,
            lodger_count: lodgerCount,
            reservation_count: reservationCount,
          },
        },
        request,
      );
    }

    const version = await timer.stage("version_ms", () => getBoardVersion(env));
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (
      ifNoneMatch != null &&
      String(parseInt(ifNoneMatch, 10)) === String(version)
    ) {
      return new Response(null, {
        status: 304,
        headers: { ETag: String(version) },
      });
    }
    const payload = await timer.stage("read_module_ms", () =>
      buildEventDetailModule(env, session, eventId),
    );
    const response = timer.finish(payload, request);
    response.headers.set("ETag", String(payload.board_version));
    return response;
  } catch (error) {
    const status = /登录已过期/.test(error.message)
      ? 401
      : /管理员|权限|不存在|缺少/.test(error.message)
        ? 403
        : 400;
    return timer.finish({ error: safeErrorMessage(error) }, request, status);
  }
}

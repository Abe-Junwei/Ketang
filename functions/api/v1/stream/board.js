import { requireSession } from "../../../_shared/auth.js";
import {
  getBoardVersion,
  queryD1,
  safeErrorMessage,
} from "../../../_shared/d1.js";

/** GET /api/v1/stream/board — SSE 看板版本推送 */
export async function onRequestGet({ request, env }) {
  if (!env.KETANG_DB) {
    return new Response("缺少 D1 绑定", { status: 500 });
  }
  try {
    await requireSession(request, env, (sql, p) => queryD1(env, sql, p));
  } catch (error) {
    const status = /登录已过期/.test(error.message) ? 401 : 403;
    return new Response(safeErrorMessage(error), { status });
  }

  let closed = false;
  let poll = null;
  let heartbeat = null;
  const Stream = globalThis.ReadableStream;
  const stream = new Stream({
    start: function (controller) {
      const encoder = new TextEncoder();
      let lastVersion = null;

      function sendVersion(version) {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            "data: " + JSON.stringify({ version: version }) + "\n\n",
          ),
        );
      }

      async function tick() {
        if (closed) return;
        try {
          const version = await getBoardVersion(env);
          if (lastVersion == null || version !== lastVersion) {
            lastVersion = version;
            sendVersion(version);
          }
        } catch (e) {
          /* ignore transient poll errors */
        }
      }

      tick();
      poll = globalThis.setInterval(tick, 1500);
      heartbeat = globalThis.setInterval(function () {
        if (closed) return;
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
    },
    cancel: function () {
      closed = true;
      if (poll) globalThis.clearInterval(poll);
      if (heartbeat) globalThis.clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

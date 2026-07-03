/** 公开预约通知适配层 | Optional notify hook (WeCom/SMS); never blocks write path */
/* global fetch */

export async function notifyPublicReservationSubmitted(env, payload) {
  const url = env.KETANG_PUBLIC_RESV_NOTIFY_URL;
  if (!url || typeof url !== "string") return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "public_reservation_submitted",
        reservation_id: payload.reservation_id,
        name: payload.name,
        expected_check_in: payload.expected_check_in,
        source: payload.source || "公开预约",
      }),
    });
  } catch (error) {
    console.warn(
      "public reservation notify failed:",
      error && error.message ? error.message : error,
    );
  }
}

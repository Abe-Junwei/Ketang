import { batchD1, insertAudit, queryD1, runD1 } from "./d1.js";
import { finishWrite } from "./write-response.js";

function stayDateRange(startDate, endDate) {
  if (!startDate) return [];
  const dates = [];
  let cur = new Date(startDate + "T12:00:00");
  if (Number.isNaN(cur.getTime())) return [];
  let last = endDate ? new Date(endDate + "T12:00:00") : new Date(cur);
  if (endDate && Number.isNaN(last.getTime())) last = new Date(cur);
  if (!endDate) last.setDate(last.getDate() + 6);
  let safety = 0;
  while (cur <= last && safety < 366) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
  return dates;
}

export async function apiSaveMeals(env, session, body) {
  const lodgerId = parseInt(body.lodger_id, 10);
  const rows = await queryD1(
    env,
    "SELECT * FROM lodgers WHERE id=? AND status='在住'",
    [lodgerId],
  );
  const l = rows[0];
  if (!l) throw new Error("挂单不存在或已不在住");
  const defaults = {
    breakfast: body.defaults?.breakfast ? 1 : 0,
    lunch: body.defaults?.lunch ? 1 : 0,
    dinner: body.defaults?.dinner ? 1 : 0,
  };
  const map = body.days || {};
  const statements = [
    {
      sql: "UPDATE lodgers SET meal_default_breakfast=?, meal_default_lunch=?, meal_default_dinner=? WHERE id=?",
      params: [defaults.breakfast, defaults.lunch, defaults.dinner, lodgerId],
    },
  ];
  stayDateRange(l.check_in_date, l.expected_check_out).forEach((date) => {
    const vals = map[date] || {
      breakfast: defaults.breakfast,
      lunch: defaults.lunch,
      dinner: defaults.dinner,
    };
    statements.push({
      sql: "INSERT OR REPLACE INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
      params: [
        lodgerId,
        date,
        vals.breakfast ? 1 : 0,
        vals.lunch ? 1 : 0,
        vals.dinner ? 1 : 0,
      ],
    });
  });
  await batchD1(env, statements);
  await insertAudit(
    env,
    "保存用斋设置",
    "lodger",
    lodgerId,
    { name: l.name, defaults, affected_dates: Object.keys(map).length },
    session,
  );
  return finishWrite(env, {}, ["meals"], ["meals"]);
}

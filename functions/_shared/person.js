/** 与前端 parsePersonNameInput 一致：整串写入 name | Match frontend name storage */
export function parsePersonNameInput(value) {
  const v = String(value || "").trim();
  return { name: v, dharma_name: null };
}

export function mergePersonNameFields(name, dharma) {
  const parts = [String(name || "").trim(), String(dharma || "").trim()].filter(
    Boolean,
  );
  const unique = [];
  parts.forEach((p) => {
    if (!unique.includes(p)) unique.push(p);
  });
  const merged = unique.join(" ");
  return { name: merged, dharma_name: null };
}

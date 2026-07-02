/** 域 → 默认读模块 | Domain to default read modules (fallback when write omits changed_modules) */
export const DOMAIN_DEFAULT_MODULES = {
  board: ["board"],
  lodging: ["lodgers_records"],
  events: ["events"],
  reservations: ["reservations"],
  meals: ["meals"],
  settings: ["settings"],
  housekeeping: ["board"],
};

/** 合并域为模块清单 | Derive module list from changed_domains */
export function modulesFromDomains(domains) {
  const keys = [];
  (domains || []).forEach(function (domain) {
    const mods = DOMAIN_DEFAULT_MODULES[domain] || [];
    mods.forEach(function (mod) {
      if (keys.indexOf(mod) === -1) keys.push(mod);
    });
  });
  return keys;
}

/** 模块去重：board 已含 lodgers/beds/房务 | Dedupe overlapping modules */
export function dedupeReadModules(modules) {
  const keys = [];
  (modules || []).forEach(function (mod) {
    if (mod && keys.indexOf(mod) === -1) keys.push(mod);
  });
  if (keys.indexOf("board") !== -1) {
    return keys.filter(function (k) {
      return k !== "lodgers_records" && k !== "lodgers" && k !== "settings";
    });
  }
  return keys;
}

export function resolveChangedModules(changedDomains, changedModules) {
  if (Array.isArray(changedModules) && changedModules.length) {
    return dedupeReadModules(changedModules);
  }
  return dedupeReadModules(modulesFromDomains(changedDomains));
}

import { getBoardVersion } from "./d1.js";
import { buildReadModule } from "./read-modules.js";
import {
  deletionsSince,
  domainsDirtySince,
  moduleKeysForDomains,
} from "./sync-meta.js";
import { ensureRowSyncSchema, tryBuildRowPatches } from "./row-sync.js";
import { canSyncReadModel } from "./read-model.js";
import { getSessionPermissions } from "./permissions.js";
import { initRemoteDatabase } from "./d1.js";

const MAX_DELTA_MODULES = 6;

export async function buildSyncDelta(env, session, sinceVersion, options) {
  if (!options?.skipInit) {
    await initRemoteDatabase(env);
  }
  const permissions = await getSessionPermissions(env, session);
  if (!canSyncReadModel(permissions)) {
    throw new Error("权限不足");
  }
  const since = parseInt(sinceVersion, 10) || 0;
  const currentVersion = await getBoardVersion(env);
  if (since > 0 && since >= currentVersion) {
    return {
      not_modified: true,
      board_version: currentVersion,
      since_version: since,
    };
  }
  const dirtyDomains = await domainsDirtySince(env, since);
  const moduleKeys = moduleKeysForDomains(dirtyDomains);
  if (!moduleKeys.length && since > 0) {
    const deletions = await deletionsSince(env, since);
    if (!deletions.length) {
      // 版本已前进但无域日志/墓碑时，不得跳过同步 | Never skip when version gap has no trail
      return {
        full_sync_required: true,
        board_version: currentVersion,
        since_version: since,
        domains: dirtyDomains,
      };
    }
  }
  if (since <= 0 || moduleKeys.length > MAX_DELTA_MODULES) {
    return {
      full_sync_required: true,
      board_version: currentVersion,
      since_version: since,
      domains: dirtyDomains,
    };
  }

  await ensureRowSyncSchema(env);
  const patchResult = await tryBuildRowPatches(
    env,
    session,
    dirtyDomains,
    since,
  );
  if (patchResult) {
    const deletions = await deletionsSince(env, since);
    return {
      board_version: currentVersion,
      since_version: since,
      domains: dirtyDomains,
      patch_mode: true,
      patches: patchResult.patches,
      row_count: patchResult.row_count,
      deletions,
      synced_at: new Date().toISOString(),
    };
  }

  const modules = {};
  for (const moduleKey of moduleKeys) {
    modules[moduleKey] = await buildReadModule(env, session, moduleKey, {
      skipInit: true,
    });
  }
  const deletions = await deletionsSince(env, since);
  return {
    board_version: currentVersion,
    since_version: since,
    domains: dirtyDomains,
    modules,
    deletions,
    synced_at: new Date().toISOString(),
  };
}

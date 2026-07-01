const BLOCKED_PREFIXES = [
  "/.git/",
  "/.github/",
  "/backup/",
  "/data/",
  "/docs/",
  "/functions/",
  "/node_modules/",
  "/scripts/",
];

const BLOCKED_FILES = new Set([
  "/.gitignore",
  "/.prettierignore",
  "/_headers",
  "/_routes.json",
  "/AGENTS.md",
  "/AI_QUICKSTART.md",
  "/DESIGN.md",
  "/README.md",
  "/STITCH_DESIGN_BRIEF.md",
  "/STITCH_ROOM_BOARD_BRIEF.md",
  "/copilot-instructions.md",
  "/design-draft.html",
  "/eslint.config.mjs",
  "/ketang.db",
  "/package-lock.json",
  "/package.json",
  "/test_api_structure.py",
  "/test_auth_gateway.py",
  "/test_cdp.py",
  "/test_cdp_migration.py",
  "/test_file_protocol.py",
  "/test_headless.py",
  "/test_prod_latency.py",
  "/test_v3.db",
  "/wrangler.toml",
]);

function isBlockedPublicPath(pathname) {
  if (BLOCKED_FILES.has(pathname)) return true;
  return BLOCKED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** 阻断非运行产物公网访问 | Block non-runtime public assets */
export async function onRequest(context) {
  const pathname = new globalThis.URL(context.request.url).pathname;
  if (isBlockedPublicPath(pathname)) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  return context.next();
}

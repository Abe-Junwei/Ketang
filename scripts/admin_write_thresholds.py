"""Admin write warm-path latency thresholds (server _timing, warm samples only)."""

WARM_INIT_MS_P95_MAX = 50
WARM_BIZ_MS_P95_MAX = 3000
WARM_WRITE_TAIL_MS_P95_MAX = 800
WARM_PATCH_MS_P95_MAX = 500


def p95(values: list[int | float]) -> int | None:
    if not values:
        return None
    ordered = sorted(int(v) for v in values)
    return ordered[max(0, (len(ordered) * 95 + 99) // 100 - 1)]


def check_warm_thresholds(
    init_ms: list,
    biz_ms: list,
    write_tail_ms: list | None = None,
    patch_ms: list | None = None,
) -> list[str]:
    """Return failure messages; skip empty warm sample lists."""
    failures: list[str] = []
    warm_inits = [v for v in (init_ms[1:] if len(init_ms) > 1 else init_ms) if isinstance(v, (int, float))]
    warm_bizs = [v for v in (biz_ms[1:] if len(biz_ms) > 1 else biz_ms) if isinstance(v, (int, float))]
    if warm_inits:
        peak = max(warm_inits)
        p = p95(warm_inits)
        if peak > WARM_INIT_MS_P95_MAX:
            failures.append(
                f"warm init_ms max={peak} p95={p} exceeds {WARM_INIT_MS_P95_MAX}ms"
            )
    if warm_bizs:
        peak = max(warm_bizs)
        p = p95(warm_bizs)
        if peak > WARM_BIZ_MS_P95_MAX:
            failures.append(
                f"warm biz_ms max={peak} p95={p} exceeds {WARM_BIZ_MS_P95_MAX}ms"
            )
    if write_tail_ms:
        warm = [
            v
            for v in (write_tail_ms[1:] if len(write_tail_ms) > 1 else write_tail_ms)
            if isinstance(v, (int, float))
        ]
        if warm and max(warm) > WARM_WRITE_TAIL_MS_P95_MAX:
            failures.append(
                f"warm write_tail_ms max={max(warm)} exceeds {WARM_WRITE_TAIL_MS_P95_MAX}ms"
            )
    if patch_ms:
        warm = [
            v
            for v in (patch_ms[1:] if len(patch_ms) > 1 else patch_ms)
            if isinstance(v, (int, float))
        ]
        if warm and max(warm) > WARM_PATCH_MS_P95_MAX:
            failures.append(
                f"warm patch_ms max={max(warm)} exceeds {WARM_PATCH_MS_P95_MAX}ms"
            )
    return failures

"""
bench_safety.py — AF-HUB-018 bench safety environment lock.

The runtime has a development safety bypass that (in the telemetry loop) clears safety
faults and force-feeds the PLC/watchdog heartbeat. That is fine on a developer laptop, but
on a real bench / commissioned machine it MUST be impossible to enable — even if someone
sets the environment variables.

Hard rules enforced here:
  * The unsafe dev bypass is refused whenever the hardware is COMMISSIONED. You cannot have
    the dev safety bypass and commissioned hardware at the same time.
  * In production mode (no explicit dev flag) the bypass is disabled regardless of any
    other flag.
  * The bypass is ONLY active when ALL of: AQUAFLOW_DEV_MODE is truthy AND
    AQUAFLOW_UNSAFE_DEV is truthy AND the commissioning flag is FALSE.

Every safety-weakening flag is listed in SAFETY_WEAKENING_FLAGS.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Environment flags that can WEAKEN safety behaviour (audited — AF-HUB-018).
#   AQUAFLOW_DEV_MODE   — opts into developer mode (required for any bypass)
#   AQUAFLOW_ENV=dev    — legacy dev-mode selector (still honoured for dev detection)
#   AQUAFLOW_UNSAFE_DEV — the actual safety bypass: clears faults + skips the watchdog
# (AQUAFLOW_DEV only toggles uvicorn auto-reload — a production concern, not a safety
#  bypass — see AF-HUB-000B; listed for completeness.)
SAFETY_WEAKENING_FLAGS = ("AQUAFLOW_DEV_MODE", "AQUAFLOW_ENV", "AQUAFLOW_UNSAFE_DEV")


def _truthy(v) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


def dev_mode_enabled(env=None) -> bool:
    env = env if env is not None else os.environ
    return _truthy(env.get("AQUAFLOW_DEV_MODE")) or str(env.get("AQUAFLOW_ENV", "")).lower() == "dev"


def _commissioned() -> bool:
    try:
        from services.commissioning import is_hardware_commissioned
        return is_hardware_commissioned()
    except Exception:  # pragma: no cover - fail safe: treat as commissioned (stricter)
        return True


def safety_bypass_allowed(env=None) -> tuple[bool, str]:
    """(allowed, reason). The unsafe dev safety bypass is allowed ONLY on a
    non-commissioned dev machine with both dev + unsafe flags set. On a commissioned
    machine it is ALWAYS refused, even if the flags are set."""
    env = env if env is not None else os.environ
    unsafe_requested = _truthy(env.get("AQUAFLOW_UNSAFE_DEV"))
    dev = dev_mode_enabled(env)

    if _commissioned():
        # Cannot have dev/unsafe bypass + commissioned hardware simultaneously.
        return False, "hardware commissioned — dev/unsafe safety flags are IGNORED"
    if not dev:
        return False, "production mode — dev safety bypass disabled"
    if not unsafe_requested:
        return False, "dev mode without AQUAFLOW_UNSAFE_DEV — full safety enforced"
    return True, "dev unsafe bypass active (non-commissioned dev machine only)"


def resolve_safety_bypass(env=None) -> bool:
    """Compute the effective bypass flag AND loudly log if unsafe flags were requested but
    blocked (so a mis-set bench machine is obvious in the logs)."""
    env = env if env is not None else os.environ
    allowed, reason = safety_bypass_allowed(env)
    requested = _truthy(env.get("AQUAFLOW_UNSAFE_DEV")) or dev_mode_enabled(env)
    if requested and not allowed:
        logger.warning("BENCH SAFETY LOCK — unsafe dev flag(s) requested but BLOCKED: %s "
                       "(flags seen: %s)", reason,
                       {f: env.get(f) for f in SAFETY_WEAKENING_FLAGS if env.get(f)})
    return allowed


def startup_safety_banner(env=None) -> str:
    allowed, reason = safety_bypass_allowed(env)
    if allowed:
        return ("⚠️  DEV UNSAFE SAFETY BYPASS ACTIVE — development only, NEVER on a "
                "bench/commissioned machine.")
    return f"✅ Safety bypasses DISABLED — production/bench safety enforced ({reason})."

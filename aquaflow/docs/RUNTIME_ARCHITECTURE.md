# AquaFlow Runtime Architecture — Authorities (AF-HUB-013)

This document names the **single** authorities in the AquaFlow runtime so there is no
ambiguity about who owns playback timing, hardware output, and safe shutdown.

## Single playback / timing / output authority: `ShowEngine`

`engine/show_engine.py::ShowEngine` is the **one and only** playback authority.

- It runs the **single 100 Hz playback loop** (`_playback_loop`, `TICK_RATE = 100`).
- That loop is the **only** clock that advances the playhead (`show_state.playhead`).
- That loop is the **only** path that dispatches timeline output to hardware
  (`protocol_bus.send_batch(...)`).
- Playback controls (WebSocket `playback` play/pause/stop/seek, the scheduler's
  scheduled playback, and the emergency-stop interrupt via `RuntimeAuthority`) all act on
  **this** engine — the same authority, one path.

There is intentionally **no second timing loop**.

## Demoted: `RuntimeTransport` — a driven state + snapshot mirror

`engine/runtime_transport.py::RuntimeTransport` previously ran a **second** independent
100 Hz loop that advanced its own `position_ms`. Two loops commanding the same fixtures
with no guaranteed synchronization is nondeterministic on real hardware — the same
split-authority problem the runtime hardening set out to remove.

As of AF-HUB-013 it is **demoted** (`TIMING_AUTHORITY = False`):

- `start()` no longer launches a timing loop — the transport runs in **DRIVEN** mode.
- Its position/state advance **only** when `ShowEngine` calls
  `sync_from_engine(position_ms, is_playing, duration_ms)` from its single loop.
- It has **no output-dispatch path** — it cannot command a fixture.
- It still provides transport **state** (for the `/transport` API + UI), **rollback
  snapshots**, and safety `go_live`/`stop_live` integration.

The `/api/.../transport/*` routes operate on this mirror for display/snapshot purposes;
they do not run a clock and cannot drive hardware output.

## Safe-shutdown authority: `RuntimeAuthority`

`engine/runtime_authority.py::RuntimeAuthority` (AF-HUB-006B) remains the single
coordinator for `emergency_stop()` / `blackout()` / `recover()`. It halts the one playback
authority (`ShowEngine`), which in turn drives the transport mirror to its fault state — so
E-stop still flows through the one surviving loop.

## Invariant (enforced by tests)

> Exactly one active 100 Hz loop advances playback and dispatches output — `ShowEngine`.
> `RuntimeTransport` has no clock and no dispatch path and cannot produce output.

See `tests/test_playback_authority.py`.

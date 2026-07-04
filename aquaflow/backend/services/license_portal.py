"""
license_portal.py — AquaFlow Stage 4, AQ-S4-004

Online license portal: multi-seat license accounts with online activation, license
transfer between machines, and seat management.

Sits server-side (LuxuryCon's licensing service) on top of the existing license engine
(which signs a per-machine license bound to a hardware fingerprint). An account owns a
number of seats; activating binds a machine's fingerprint to a free seat and issues it
a signed license; a transfer frees one machine's seat and binds another; seat
management adds/sets seats and lists who is activated.

  * online activation supported — `activate(key, fingerprint)` binds a machine to a
    free seat and returns a signed license (idempotent for an already-activated
    machine; rejected when no seats remain),
  * license transfer supported — `transfer(key, from_fp, to_fp)` moves an activation
    between machines and records the transfer history,
  * seat management supported — `seats()` / `set_seats()` / `add_seats()` /
    `deactivate()` manage the seat pool, never dropping below the active-seat count.

Filesystem-scoped (one JSON per account) so it is fully unit-tested.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SeatError(Exception):
    """Raised when a seat operation is not permitted (no seats, unknown machine…)."""


class LicensePortal:
    """Server-side multi-seat license account store."""

    def __init__(self, root):
        self.root = Path(root)
        (self.root / "accounts").mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))
        return self.root / "accounts" / f"{safe}.json"

    def _load(self, key: str) -> Optional[dict]:
        p = self._path(key)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _save(self, account: dict) -> None:
        self._path(account["key"]).write_text(json.dumps(account, indent=2),
                                              encoding="utf-8", newline="")

    # ── Accounts ────────────────────────────────────────────────────────────────
    def create_account(self, key: str, edition: str, total_seats: int = 1,
                       user_name: str = "", company_name: str = "") -> dict:
        if self._load(key):
            raise SeatError(f"account '{key}' already exists")
        account = {
            "key": str(key), "edition": str(edition),
            "user_name": user_name, "company_name": company_name,
            "total_seats": max(1, int(total_seats)),
            "seats": [], "transfers": [], "created_at": _now(),
        }
        self._save(account)
        return self._public(account)

    def get_account(self, key: str) -> Optional[dict]:
        acc = self._load(key)
        return self._public(acc) if acc else None

    # ── Seat helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _active_seats(acc: dict) -> list:
        return [s for s in acc["seats"] if s.get("active")]

    @staticmethod
    def _find_active(acc: dict, fingerprint: str) -> Optional[dict]:
        return next((s for s in acc["seats"]
                     if s.get("active") and s.get("fingerprint") == fingerprint), None)

    def _issue_license(self, acc: dict, fingerprint: str) -> dict:
        from license.license_engine import create_license
        return create_license(acc.get("user_name") or "AquaFlow User",
                              acc.get("company_name") or "AquaFlow",
                              acc["edition"], fingerprint)

    # ── Online activation ───────────────────────────────────────────────────────
    def activate(self, key: str, fingerprint: str, machine_name: str = "") -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")

        existing = self._find_active(acc, fingerprint)
        if existing:                                   # idempotent re-activation
            return {"activated": True, "already_active": True,
                    "seat_id": existing["seat_id"], "license": self._issue_license(acc, fingerprint),
                    "seats_used": len(self._active_seats(acc)), "seats_total": acc["total_seats"]}

        if len(self._active_seats(acc)) >= acc["total_seats"]:
            raise SeatError(
                f"no seats available ({acc['total_seats']}/{acc['total_seats']} used) — "
                f"deactivate or transfer a seat, or add more seats")

        seat = {"seat_id": uuid.uuid4().hex[:12], "fingerprint": fingerprint,
                "machine_name": machine_name, "activated_at": _now(),
                "active": True, "deactivated_at": None}
        acc["seats"].append(seat)
        self._save(acc)
        return {"activated": True, "already_active": False, "seat_id": seat["seat_id"],
                "license": self._issue_license(acc, fingerprint),
                "seats_used": len(self._active_seats(acc)), "seats_total": acc["total_seats"]}

    def deactivate(self, key: str, fingerprint: str) -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")
        seat = self._find_active(acc, fingerprint)
        if not seat:
            raise SeatError("that machine is not activated on this license")
        seat["active"] = False
        seat["deactivated_at"] = _now()
        self._save(acc)
        return {"deactivated": True, "seat_id": seat["seat_id"],
                "seats_used": len(self._active_seats(acc)), "seats_total": acc["total_seats"]}

    # ── License transfer ────────────────────────────────────────────────────────
    def transfer(self, key: str, from_fingerprint: str, to_fingerprint: str,
                 machine_name: str = "") -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")
        src = self._find_active(acc, from_fingerprint)
        if not src:
            raise SeatError("source machine is not activated on this license")
        if from_fingerprint == to_fingerprint:
            raise SeatError("source and destination machines are the same")

        # Free the source seat and bind the destination (idempotent if already active).
        src["active"] = False
        src["deactivated_at"] = _now()
        dst = self._find_active(acc, to_fingerprint)
        if dst is None:
            dst = {"seat_id": uuid.uuid4().hex[:12], "fingerprint": to_fingerprint,
                   "machine_name": machine_name, "activated_at": _now(),
                   "active": True, "deactivated_at": None}
            acc["seats"].append(dst)
        acc["transfers"].append({"from": from_fingerprint, "to": to_fingerprint,
                                 "at": _now(), "seat_id": dst["seat_id"]})
        self._save(acc)
        return {"transferred": True, "seat_id": dst["seat_id"],
                "license": self._issue_license(acc, to_fingerprint),
                "seats_used": len(self._active_seats(acc)), "seats_total": acc["total_seats"]}

    # ── Seat management ─────────────────────────────────────────────────────────
    def seats(self, key: str) -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")
        active = self._active_seats(acc)
        return {
            "key": key, "edition": acc["edition"],
            "total_seats": acc["total_seats"], "seats_used": len(active),
            "seats_available": acc["total_seats"] - len(active),
            "active_seats": [{"seat_id": s["seat_id"], "fingerprint": s["fingerprint"],
                              "machine_name": s["machine_name"], "activated_at": s["activated_at"]}
                             for s in active],
            "transfer_count": len(acc["transfers"]),
        }

    def set_seats(self, key: str, total_seats: int) -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")
        total_seats = int(total_seats)
        used = len(self._active_seats(acc))
        if total_seats < used:
            raise SeatError(f"cannot reduce to {total_seats} seats — {used} are in use "
                            f"(deactivate machines first)")
        acc["total_seats"] = max(1, total_seats)
        self._save(acc)
        return self.seats(key)

    def add_seats(self, key: str, count: int) -> dict:
        acc = self._load(key)
        if not acc:
            raise SeatError(f"license '{key}' not found")
        return self.set_seats(key, acc["total_seats"] + max(0, int(count)))

    def available_seats(self, key: str) -> int:
        return self.seats(key)["seats_available"]

    # ── Public projection (no internal-only fields) ─────────────────────────────
    @staticmethod
    def _public(acc: dict) -> dict:
        return {
            "key": acc["key"], "edition": acc["edition"],
            "user_name": acc["user_name"], "company_name": acc["company_name"],
            "total_seats": acc["total_seats"],
            "seats_used": len([s for s in acc["seats"] if s.get("active")]),
            "transfer_count": len(acc["transfers"]),
            "created_at": acc["created_at"],
        }


# ── Singleton ──────────────────────────────────────────────────────────────────
_portal: Optional[LicensePortal] = None


def get_license_portal() -> LicensePortal:
    global _portal
    if _portal is None:
        _portal = LicensePortal(Path.home() / ".aquaflow" / "license-portal")
    return _portal

"""
validate_license_portal.py — AQ-S4-004 verification

Verifies the online license portal:
  1. online activation (bind a machine to a seat, issue a signed license, enforce the
     seat limit, idempotent re-activation),
  2. license transfer (move an activation between machines, record history),
  3. seat management (list/add/set seats, deactivate; never below active count).

Run:  python backend/validate_license_portal.py   (from the aquaflow/ dir)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from pathlib import Path
from services.license_portal import LicensePortal, SeatError
from license.license_engine import validate_license, EDITIONS

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


EDITION = "STUDIO" if "STUDIO" in EDITIONS else EDITIONS[0]
portal = LicensePortal(Path(tempfile.mkdtemp()) / "portal")
portal.create_account("LUX-KEY-001", EDITION, total_seats=2,
                      user_name="Ops Team", company_name="Dubai Mall")

print("== 1. online activation ==")
a1 = portal.activate("LUX-KEY-001", "machine-A", "Studio PC A")
check("machine A activated", a1["activated"] and not a1["already_active"])
check("seat count 1/2 used", a1["seats_used"] == 1 and a1["seats_total"] == 2)
# The issued license is a real, signed, fingerprint-bound license.
check("issued license validates for machine A",
      validate_license(a1["license"], "machine-A")["status"] == "VALID")
check("issued license is bound to machine A (rejected elsewhere)",
      validate_license(a1["license"], "machine-Z")["status"] == "INVALID_HW")

a1b = portal.activate("LUX-KEY-001", "machine-A")
check("re-activating machine A is idempotent (same seat)",
      a1b["already_active"] and a1b["seat_id"] == a1["seat_id"] and a1b["seats_used"] == 1)

portal.activate("LUX-KEY-001", "machine-B", "Studio PC B")
check("both seats used (2/2)", portal.available_seats("LUX-KEY-001") == 0)
try:
    portal.activate("LUX-KEY-001", "machine-C")
    check("third activation blocked when no seats", False)
except SeatError as e:
    check("third activation blocked when no seats", "no seats" in str(e).lower())

print("== 2. license transfer ==")
t = portal.transfer("LUX-KEY-001", "machine-A", "machine-C", "New PC C")
check("transfer succeeded", t["transferred"])
check("seat count still 2/2 (A freed, C bound)", t["seats_used"] == 2)
check("transferred license validates for machine C",
      validate_license(t["license"], "machine-C")["status"] == "VALID")
seats = portal.seats("LUX-KEY-001")
fps = {s["fingerprint"] for s in seats["active_seats"]}
check("machine A no longer active", "machine-A" not in fps)
check("machine C now active", "machine-C" in fps)
check("transfer recorded in history", seats["transfer_count"] == 1)
try:
    portal.transfer("LUX-KEY-001", "machine-A", "machine-D")
    check("transfer from an inactive machine blocked", False)
except SeatError:
    check("transfer from an inactive machine blocked", True)

print("== 3. seat management ==")
check("seats listed with used/available", seats["total_seats"] == 2 and seats["seats_used"] == 2)
d = portal.deactivate("LUX-KEY-001", "machine-B")
check("deactivate frees a seat", d["deactivated"] and portal.available_seats("LUX-KEY-001") == 1)
added = portal.add_seats("LUX-KEY-001", 3)
check("add_seats grows the pool to 5", added["total_seats"] == 5)
check("available reflects the growth", added["seats_available"] == 4, str(added["seats_available"]))
try:
    portal.set_seats("LUX-KEY-001", 0)   # 1 active seat (machine-C) remains
    check("cannot set seats below active count", False)
except SeatError:
    check("cannot set seats below active count", True)
# now that a seat is free again, machine-C-freed... deactivate C then a new machine fits
portal.activate("LUX-KEY-001", "machine-E")
check("a freed/added seat can be re-activated", portal.seats("LUX-KEY-001")["seats_used"] == 2)

print("== 4. errors ==")
try:
    portal.activate("NO-SUCH-KEY", "m")
    check("activation on unknown license errors", False)
except SeatError:
    check("activation on unknown license errors", True)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)

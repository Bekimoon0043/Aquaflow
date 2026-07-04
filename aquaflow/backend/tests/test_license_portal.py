"""
Contract tests for the Online License Portal (AQ-S4-004).

Asserts the three acceptance criteria:
  1. online activation supported (bind to a seat, issue a signed license, seat limit),
  2. license transfer supported (move an activation, record history),
  3. seat management supported (list/add/set/deactivate; never below active count).
"""
import pytest

from services.license_portal import LicensePortal, SeatError
from license.license_engine import validate_license, EDITIONS

EDITION = "STUDIO" if "STUDIO" in EDITIONS else EDITIONS[0]


@pytest.fixture
def portal(tmp_path):
    p = LicensePortal(tmp_path / "portal")
    p.create_account("K1", EDITION, total_seats=2, user_name="Ops", company_name="Co")
    return p


# ── 1. online activation ──────────────────────────────────────────────────────

def test_activation_binds_seat_and_issues_signed_license(portal):
    a = portal.activate("K1", "machine-A", "PC A")
    assert a["activated"] and not a["already_active"]
    assert a["seats_used"] == 1 and a["seats_total"] == 2
    assert validate_license(a["license"], "machine-A")["status"] == "VALID"
    assert validate_license(a["license"], "machine-Z")["status"] == "INVALID_HW"


def test_reactivation_is_idempotent(portal):
    a = portal.activate("K1", "machine-A")
    b = portal.activate("K1", "machine-A")
    assert b["already_active"] is True
    assert b["seat_id"] == a["seat_id"]
    assert portal.seats("K1")["seats_used"] == 1


def test_seat_limit_enforced(portal):
    portal.activate("K1", "m1")
    portal.activate("K1", "m2")
    assert portal.available_seats("K1") == 0
    with pytest.raises(SeatError, match="no seats"):
        portal.activate("K1", "m3")


def test_activation_unknown_license_errors(portal):
    with pytest.raises(SeatError):
        portal.activate("NOPE", "m")


# ── 2. license transfer ───────────────────────────────────────────────────────

def test_transfer_moves_activation(portal):
    portal.activate("K1", "m1", "PC1")
    t = portal.transfer("K1", "m1", "m2", "PC2")
    assert t["transferred"] and t["seats_used"] == 1
    assert validate_license(t["license"], "m2")["status"] == "VALID"
    active = {s["fingerprint"] for s in portal.seats("K1")["active_seats"]}
    assert "m1" not in active and "m2" in active
    assert portal.seats("K1")["transfer_count"] == 1


def test_transfer_from_inactive_machine_errors(portal):
    portal.activate("K1", "m1")
    with pytest.raises(SeatError):
        portal.transfer("K1", "ghost", "m2")


def test_transfer_to_same_machine_errors(portal):
    portal.activate("K1", "m1")
    with pytest.raises(SeatError):
        portal.transfer("K1", "m1", "m1")


# ── 3. seat management ────────────────────────────────────────────────────────

def test_seats_listing(portal):
    portal.activate("K1", "m1", "PC1")
    s = portal.seats("K1")
    assert s["total_seats"] == 2 and s["seats_used"] == 1 and s["seats_available"] == 1
    assert s["active_seats"][0]["machine_name"] == "PC1"


def test_deactivate_frees_seat(portal):
    portal.activate("K1", "m1")
    d = portal.deactivate("K1", "m1")
    assert d["deactivated"] and portal.available_seats("K1") == 2


def test_add_and_set_seats(portal):
    assert portal.add_seats("K1", 3)["total_seats"] == 5
    assert portal.set_seats("K1", 2)["total_seats"] == 2


def test_cannot_reduce_seats_below_active(portal):
    portal.activate("K1", "m1")
    portal.activate("K1", "m2")
    with pytest.raises(SeatError):
        portal.set_seats("K1", 1)


def test_create_duplicate_account_errors(portal):
    with pytest.raises(SeatError):
        portal.create_account("K1", EDITION)


def test_account_persists_across_instances(tmp_path):
    p1 = LicensePortal(tmp_path / "p")
    p1.create_account("K", EDITION, total_seats=3)
    p1.activate("K", "m1")
    p2 = LicensePortal(tmp_path / "p")            # fresh instance, same dir
    assert p2.get_account("K")["seats_used"] == 1
    assert p2.available_seats("K") == 2

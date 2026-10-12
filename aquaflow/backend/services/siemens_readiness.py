"""Read-only commissioning review; never equate a network handshake with safe equipment."""
import re
from engine.siemens_hardware import supported_s7_identifier


def unsupported_input_bindings(site):
    """Inputs not implemented by the current v2 PLC generator must not be ignored."""
    issues = []
    for channel in site["channels"]:
        if channel["kind"] != "pump" and channel.get("fault_input"):
            issues.append(f"{channel['name']}: fault input is unsupported by this PLC runtime; use a reviewed PLC interlock.")
        if channel["kind"] == "light" and channel.get("feedback_input"):
            issues.append(f"{channel['name']}: light feedback input is unsupported; RGB feedback reports applied commands only.")
    return issues


def commissioning_readiness(site):
    checks = []

    def add(code, state, title, detail):
        checks.append(dict(code=code, state=state, title=title, detail=detail))

    identifier = site.get("tia", {}).get("cpu_type_identifier", "")
    hardware = site.get("hardware") or {}
    if not identifier and hardware.get("cpu"):
        from engine.siemens_devices import CATALOG
        cpu = CATALOG.get(hardware["cpu"])
        if cpu:
            identifier = f"OrderNumber:{cpu['order_number']}/{hardware.get('firmware', '')}"
    standard = supported_s7_identifier(identifier)
    add("cpu", "review" if standard else "blocked", "Exact CPU and firmware",
        "Supported generator target (S7-1200 G1, S7-1500 or ET 200SP CPU). Compile against the exact installed CPU/firmware; physical compatibility is unverified."
        if standard else "Choose the exact CPU in the Hardware step (or enter its TIA TypeIdentifier). S7-1200 G2, fail-safe, redundant and other families are not validated by this generator.")
    channels = site["channels"]
    missing = [c["name"] for c in channels if not c.get("output") or (c["kind"] == "pump" and not c.get("enable_output"))]
    add("outputs", "blocked" if missing else "review", "Output hardware and addresses",
        "Unmapped: " + ", ".join(missing) if missing else
        "Address syntax is valid, not hardware proof. Check every terminal, module address, analog scaling and drive interface in TIA.")
    missing_inputs = [key for key, address in site["inputs"].items() if not address]
    add("interlocks", "blocked" if missing_inputs else "review", "Local interlocks",
        "Unmapped: " + ", ".join(missing_inputs) if missing_inputs else
        "Healthy-high inputs mapped. Prove each trip on the actual installation; ordinary PLC/AquaFlow logic is not a safety-rated E-stop.")
    issues = unsupported_input_bindings(site)
    add("input_support", "blocked" if issues else "passed", "Feedback/fault mapping support",
        " ".join(issues) if issues else "No ignored input bindings. Without wired feedback, displayed state is PLC-applied, not measured equipment state.")
    observed = all(c.get("commissioned") and c.get("observation", "").strip()
                   and "plcsim" not in c.get("observation", "").lower() for c in channels)
    if site["mode"] == "plcsim":
        add("observations", "passed", "PLCSIM-only target",
            "Network writes are allowed only as a simulator bench result; they do not commission real equipment.")
    else:
        add("observations", "recorded" if observed and site["mode"] == "physical" else "blocked", "Physical commissioning observations",
            "Operator observations recorded; verify against the installed cabinet." if observed and site["mode"] == "physical" else
            "Physical response observations are required. Simulation results do not commission real equipment.")
    add("show", "passed" if site.get("show") else "blocked", "Compiled AquaFlow show",
        "Show compiled for this saved site." if site.get("show") else "Compile a show after saving the mapping. This is not Siemens PLC compilation.")
    planned = site.get("starter_profile", {}).get("cpu", "")
    if re.search(r"6ES7\s*212-", identifier, re.I) or "1212" in planned:
        add("1212c_analog", "review", "CPU 1212C pump-speed hardware",
            "Classic CPU 1212C DC/DC/DC has 8 digital inputs, 6 digital outputs, 2 analog inputs and no integrated analog output. The %QW pump-speed interface needs a compatible AO module/board and configured drive. Starter %QW64 is virtual, not a terminal assignment.")
    if any(c["kind"] == "light" for c in channels):
        add("lights", "review", "RGB interface",
            "Three %QB bytes are process-image commands, not a DMX or DALI driver. Confirm compatible lighting hardware and protocol conversion.")
    add("hardware_test", "unverified", "On-equipment acceptance",
        "Still required: TIA zero-error compile/download, isolated output tests, independent protection tests, network-loss watchdog, STOP/CPU restart, feedback and no-auto-resume tests. Never force protective inputs on real hardware.")
    return {
        "site_id": site["id"], "revision": site["revision"], "mode": site["mode"],
        "status": "BLOCKED" if any(c["state"] == "blocked" for c in checks) else "HARDWARE_VALIDATION_REQUIRED",
        "checks": checks,
        "support_matrix": [
            {"family": "Standard S7-1200 G1", "status": "Current generator target; exact CPU compilation and commissioning required"},
            {"family": "S7-1500 / ET 200SP CPU", "status": "Generator target since 1.2.28 (same DB100 contract, OB200 cyclic); not yet proven on PLCSIM Advanced or hardware"},
            {"family": "S7-1200 G2", "status": "Not validated; needs the planned OPC UA transport or a PUT/GET verification"},
            {"family": "TIA-supported S7-300 / S7-400 / WinAC", "status": "Not supported by current generator; legacy SCL/DB/OB adapter required"},
            {"family": "Fail-safe / technology / software controllers", "status": "No safety-program generation or blanket compatibility claim"},
        ],
    }

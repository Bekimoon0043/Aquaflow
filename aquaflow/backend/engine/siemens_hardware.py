"""Conservative catalog gate, not a claim of Siemens-certified compatibility."""
import re


# 1211C/1212C are -1xE40, 1214C/1215C are -1xG40, 1217C is -1AG40. A loose '21x' prefix
# would also admit G2 (-x50) and fail-safe (-1xF40) CPUs. Unknown revisions need review.
_CLASSIC_CPU = re.compile(
    r"^OrderNumber:6ES7\s*(?:21[12]-1(?:AE|BE|HE)40|21[45]-1(?:AG|BG|HG)40|217-1AG40)"
    r"-0XB0/V4\.\d+(?:\.\d+)?$", re.IGNORECASE)


# S7-1500 standard (1AL/1AM...), compact (1CL/1CM) and ET 200SP (1DK) CPUs on the same S7comm
# contract. F/TF (fail-safe) and R/H (redundant) variants are excluded.
_S7_1500_CPU = re.compile(r"6ES7\s*51\d-\d[ACD][A-Z]\d\d-0AB0", re.IGNORECASE)
_S7_1500_ID = re.compile(r"^OrderNumber:6ES7\s*51\d-\d[ACD][A-Z]\d\d-0AB0/V(?:2\.[89]|3\.\d|4\.\d)(?:\.\d+)?$",
                         re.IGNORECASE)


def supported_s7_1200_identifier(value):
    """Classic S7-1200 G1 TIA TypeIdentifier."""
    return bool(_CLASSIC_CPU.fullmatch(str(value or "").strip()))


def supported_s7_identifier(value):
    """Any CPU the AquaFlow S7comm contract targets: S7-1200 G1, S7-1500, ET 200SP CPU."""
    text = str(value or "").strip()
    return supported_s7_1200_identifier(text) or bool(_S7_1500_ID.fullmatch(text))


# S7-1200 generations differ by the order number, NOT the firmware: G2 CPUs ship
# firmware V4.1+ too (6ES7 21x-1xx50-0XB0). Siemens discontinues G1 (announced
# 1 Nov 2026; new G1 parts orderable until 1 Oct 2027).
_G2_CPU = re.compile(r"6ES7\s*21\d-1[A-Z]{2}50-0XB0", re.IGNORECASE)
_F_CPU = re.compile(r"6ES7\s*21\d-1[A-Z]F\d0-0XB0", re.IGNORECASE)
_G1_CPU = re.compile(r"6ES7\s*(?:21[12]-1(?:AE|BE|HE)40|21[45]-1(?:AG|BG|HG)40|217-1AG40)-0XB0", re.IGNORECASE)


def classify_s7_1200(order_number):
    """Plain-language verdict for an S7-1200 order number (identity or TIA TypeIdentifier)."""
    text = str(order_number or "").replace("OrderNumber:", "").strip()
    if not text:
        return {"generation": "unknown", "supported": False,
                "message": "The CPU did not report its order number; Verify still checks the AquaFlow program."}
    if _F_CPU.search(text):
        return {"generation": "F", "supported": False,
                "message": f"{text} is a fail-safe (F) CPU. AquaFlow does not support F-CPUs; safety stays hardwired."}
    if _G2_CPU.search(text):
        return {"generation": "G2", "supported": False,
                "message": (f"{text} is an S7-1200 G2 CPU. AquaFlow does not support G2 yet. "
                            "G2 firmware V4.1 looks like G1 firmware; only the order number tells them apart. "
                            "Use a classic G1 CPU (order number ending -x40-0XB0).")}
    if re.search(r"6ES7\s*51\d-\d[FU][A-Z]\d\d", text, re.IGNORECASE):
        return {"generation": "F", "supported": False,
                "message": f"{text} is a fail-safe (F/TF) S7-1500 CPU. AquaFlow does not support F-CPUs; safety stays hardwired."}
    if re.search(r"6ES7\s*51\d-\d[RH][A-Z]\d\d", text, re.IGNORECASE):
        return {"generation": "R/H", "supported": False,
                "message": f"{text} is a redundant (R/H) S7-1500 CPU, which AquaFlow has not validated."}
    if _S7_1500_CPU.search(text):
        family = "ET 200SP CPU" if re.search(r"-\dD", text) else "S7-1500"
        return {"generation": family, "supported": True,
                "message": (f"{text} is an {family} — supported on the same AquaFlow PLC program (PUT/GET, "
                            "non-optimized DB, rack 0 / slot 1). Not yet proven on real hardware or PLCSIM Advanced.")}
    if _G1_CPU.search(text):
        return {"generation": "G1", "supported": True,
                "message": (f"{text} is a classic S7-1200 G1 CPU — supported. Siemens discontinues G1 "
                            "(announced 1 Nov 2026, new units orderable until 1 Oct 2027).")}
    return {"generation": "unknown", "supported": False,
            "message": f"{text} is not a CPU AquaFlow has validated."}

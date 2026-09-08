# PROFINET DCP discovery on Windows (AF-DISC)

AquaFlow finds PROFINET PLCs (Siemens S7-1200/1500 and any other PROFINET device)
on the **selected physical Ethernet adapter** with a single **DCP Identify-All**
frame — including a PLC that has **no IP address yet** or an IP on a **foreign
subnet**, which an IP sweep can never find.

Code: `engine/profinet_dcp.py` (codec + providers), wired into
`engine/controller_identify.py` (Device Discovery → Controllers).

## What is sent, and what is never sent

| Frame | Sent by AquaFlow? |
| --- | --- |
| DCP **Identify-All** (service 0x05, request, option/suboption 0xFF/0xFF) to `01:0E:CF:00:00:00`, EtherType `0x8892` | **Yes — exactly one per scan**, from the selected adapter's MAC |
| DCP Set (IP / station name / reset-to-factory), Get, Hello, Signal (LED flash) | **Never.** No builder for these services exists in the module; a test (`test_no_dcp_set_or_other_writing_service_exists`) fails if one appears. |

Replies are accepted only when they are a DCP Identify **response** carrying
**our transaction id**, addressed to **our MAC** (or broadcast), with block
lengths that fit the frame. Everything else is counted as rejected with a reason.
Duplicate replies from one MAC collapse to one device. The listen window has a
deadline and honours the discovery job's cancel button.

Evidence preserved per device: adapter name, device MAC, station name, IP, mask,
gateway, vendor id/name, device id, role, device family (type-of-station text).
The **order number** is *not* carried by DCP; it is read afterwards by the
read-only S7comm SZL query (`engine/s7_identify.py`) when the PLC's IP is
reachable.

## Runtime dependency: Npcap (Windows only)

Sending a raw Ethernet frame on Windows needs a packet driver. AquaFlow uses the
**Npcap** runtime (`wpcap.dll`) through `ctypes` — no Python package, no scapy, no
Wireshark GUI, nothing to `pip install`.

| Item | Detail |
| --- | --- |
| What to install | Npcap from <https://npcap.com>. The free/demo edition currently permits installation on up to five systems, with limited exceptions; deployments must follow the current Npcap licence. |
| Installer options | Keep **"Restrict Npcap driver's access to Administrators only" UNTICKED**, or run AquaFlow as Administrator. "WinPcap API-compatible mode" is **not** required. "Support loopback traffic" is not required. |
| Why it is not bundled | The free/demo edition does not permit redistribution. **Redistributing** Npcap inside AquaFlow requires an Npcap OEM redistribution licence; larger internal deployments require the applicable OEM internal-use licence. AquaFlow therefore does **not** ship or silently install it. The release should link to Npcap's download and current licence terms in the commissioning notes. |
| Packaging (Electron / PyInstaller) | Nothing to add to `aquaflow-engine.spec`: the provider is pure `ctypes` and loads `wpcap.dll` at runtime from `%SystemRoot%\System32\Npcap` (added to the DLL search path) or `System32`. No hidden imports, no binaries. |
| When Npcap is absent | Discovery **fails closed**: the DCP stage reports `available: false` with an install hint, the Controllers tab shows it as a warning, and the S7comm/Modbus identification of the **selected subnet only** still runs. No other subnet is scanned as a "fallback". |
| Adapter binding | The capture device is resolved from the selected adapter's **IPv4 address** first, then its exact description — never "the first interface". Wi-Fi, VPN and virtual adapters are excluded from auto-selection and can only be used by explicit choice. |
| Linux | `AF_PACKET` raw socket (root or `CAP_NET_RAW`); no extra runtime. |

TIA Portal or PRONETA are **not** required and are not used.

### Direct cable with no DHCP (169.254.x.x)

Windows gives a directly connected USB Ethernet adapter an automatic `169.254.x.x/16`
address when no DHCP server is present. AquaFlow keeps that adapter selectable and runs
DCP on it, but deliberately does not sweep the 65,534-address link-local range. The scan
is marked DCP-only until the PC has a static address on the controller subnet. This is
enough to identify an unconfigured PROFINET device by MAC and station name; S7comm,
Modbus TCP and I-CAN need a correctly configured IPv4 subnet before they can be tested.

## PLC with a foreign IP

When DCP reports a PLC whose IP is outside the selected subnet, the Controllers
tab lists it with its DCP evidence and a warning, and makes **one** direct S7comm
attempt at that address (a single host, not a sweep). If the PLC is routable the
S7 handshake/SZL confirms it; if not, the operator sees the DCP identity and can
fix the addressing in TIA Portal. AquaFlow never assigns IPs.

## Testing

Automated tests never touch a real NIC: `FakeEthernetProvider` records the
transmitted frame and feeds constructed replies (`tests/test_profinet_dcp_windows.py`,
`tests/test_profinet_dcp.py`). The real Npcap provider is only checked for
honest availability reporting on the build machine.

# Siemens TIA Portal Project Files — Reverse-Engineering Research Dossier

**Status:** Research deliverable (no production code changed). **Date:** 2026-09-23
**Scope:** What AquaFlow can extract from TIA Portal project folders / archives / exports *without* running TIA Portal, how, what is missing, and which experiments come next.
**Companion docs:** `SIEMENS-ZERO-TIA-ARCHITECTURE-DECISION.md`, `SIEMENS-TIA-OPENNESS-INTEGRATION.md`, `../tools/tia-openness-bridge/README.md`, `../../SIEMENS-INDEPENDENT-PROGRAMMING-FEASIBILITY-AUDIT.md`.
**Research artifacts (not for commit):** `tmp/tia-research/` — scripts `inspect.py`, `deep.py`, `carve.py`, `show.py`, `hunt.py`, `v11.py`, `aux.py`, outputs `*_out.txt`, carved streams in `carved/` (V18) and `carved_v11/` (V11), plus shallow clones of the repos listed in §5. `tmp/` is **not** in `.gitignore`; the clones contain third-party code with mixed licenses — do not commit them.

---

## Executive Summary

1. **A TIA Portal project is a folder, not a file.** The `.apXX` file is a ~7 KB XML stub (icon + `ProjectVersion`). All engineering content lives in `System/PEData.plf` (+ `PEData.idx`). Confirmed on two independent real projects: V18 (`sployal/TIA_portalV18_projects`, S7-1500) and V11 (`luismigueldurandiaz/modbus_1200_1200`, S7-1200), and corroborated by NVISO's forensic series (V15.1).
2. **`PEData.plf` is not encrypted; it is an append-only object store whose payloads are zlib-compressed blobs.** We carved 184 zlib streams from the V18 file (47 XML, 137 binary) and 277 from the V11 file (220 XML, 57 binary) with a 60-line Python script. Plain zlib inflate — no key material needed. This contradicts the common forum claim that "TIA projects are encrypted"; that claim is unsupported by evidence for V11 and V18 (see §4 and §6 for the nuance about password hashes and know-how-protected blocks).
3. **Hardware identity is recoverable from the PLF today, without a schema.** From the V18 PLF we recovered: CPU type name (`CPU 1512C-1 PN`), order numbers (`6ES7 512-1CK00-0AB0`, `6ES7 523-1BL00-0AA0`, `6ES7591-1AA00-0AA0`), module display names (`DI 16x24VDC / DQ 16x24VDC/0.5A BA`), station name, PROFINET interface/port names, MRP domain, a firmware-looking attribute (`Value="V1.8"`), and the CPU IP/mask/gateway as raw bytes (`c0a80001 ffffff00 c0a80001` = 192.168.0.1/24, gw 192.168.0.1) inside a TLV-like binary record next to the string `Network Parameters`. From the V11 PLF: `CPU 1214C AC/DC/Rly`, `6ES7 214-1BE30-0XB0`, `6ES7 232-4HA30-0XB0` (SB AO), the device-description paths (`S71200\CPU\CPU_1214C\MDD_6ES7214-1BE30-0XB0_2.2`), and the full block-interface XML for every block (member names, types, bit offsets).
4. **Program logic is the hard part.** Block *interfaces* (V11: `BlockInterface/Source/V11_01.xsd` XML — fully readable) and V18 LAD network XML (`FunctionLadderDiagram` namespace) are present as XML. Compiled code and most object *relationships* are in undocumented binary records. Only one library on the market parses them fully (jfk-solutions `TiaFileFormat`, V10.5–V20) and it is **closed-source / commercial**. No open-source parser of the V14+ PLF object model exists.
5. **Exports are the stable, documented path.** Openness/VCI SimaticML XML (blocks, tags, UDTs), `.scl/.db/.udt` sources, and CAx AutomationML (`.aml`) hardware exports are plain XML/text and are what every open-source tool actually consumes. But they require TIA Portal to be produced, and SimaticML is version-specific (namespace `…/SW/Interface/v3` vs `v4`, etc.).
6. **Engineering data ≠ PLC communication.** Discovering a CPU, reading its order number/firmware, reading/writing tags, browsing symbols, listing DBs, and start/stop are all achievable via PROFINET DCP + S7CommPlus (open-source `S7CommPlusDriver`, LGPL) with no project file at all. Downloading hardware configuration or compiled blocks to an S7-1200/1500 is **not** available in any open-source stack; that remains TIA Portal (or SIMATIC AX for S7-1500 / S7-1200 G2).

**Bottom line for AquaFlow:** Build (a) a *read-only* PLF "inventory extractor" (hardware, network, block list, tag names) — feasible now, medium effort; (b) a SimaticML/AML *export* parser — feasible now, low effort, high fidelity; (c) keep deployment on the Openness bridge / SIMATIC AX path. Do **not** plan on *generating* a PLF: there is no evidence anyone outside Siemens has written a PLF that TIA accepts.

## Evidence Legend

| Tag | Meaning |
|---|---|
| **[E-V18]** | Directly observed in the V18 sample `Conveyor belt_7` (this research, scripts in `tmp/tia-research/`). |
| **[E-V11]** | Directly observed in the V11 sample `MODBUS_1200_1200` (this research). |
| **[E-SRC]** | Read in third-party source code (repo + file named). |
| **[E-DOC]** | Vendor/technical documentation. |
| **[E-COMM]** | Community report by a practitioner (not independently reproduced here). |
| **[SPEC]** | Speculation / inference — not evidence. |

---

## 1. File Formats

| File / Extension | Purpose | Format | Readable without TIA? | Confidence / Evidence |
|---|---|---|---|---|
| `<Project>.ap11 … .ap20` (`.ap15_1`) | Project "entry" file. Contains only `<Data><Icon>base64 PNG</Icon><ProjectVersion>18.0.1.0</ProjectVersion></Data>`. ~7.6 KB. | UTF-8 XML (V18: no BOM, V11: BOM) | Yes — trivially | **Confirmed** [E-V18][E-V11]; NVISO confirms same for `.ap15_1` |
| `System/PEData.plf` | The actual project database. Append-only log of typed object records; payloads zlib-compressed. 1.3 MB (tiny V18 project) / 2.5 MB (V11). | Proprietary binary container, magic `40 00 01 00 01 00 00 00` + 16-byte GUID; contents = zlib streams (`78 9C`/`78 DA`/`78 5E`) | Partially — zlib payloads inflate; record framing undocumented | **Confirmed** zlib, not encrypted [E-V18][E-V11]; append-only [E-COMM NVISO, V15.1] |
| `System/PEData.idx` | Index over PLF. Magic `80 00 01 00 01 00 00 00` + same GUID as PLF. 51 KB / 96 KB. | Binary | Unknown framing | **High** it is an index (same GUID) [E-V18][E-V11]; layout **UNKNOWN** |
| `System/PEData.plf1, .plf2 …` | Overflow PLF segments for large projects | same as PLF | same | [E-SRC] jfk `TiaDatabaseFile` "wraps one or more PLF files" |
| `System/PEData/Meta/ChangeList{Consumer,Provider}/*.xml` | Change-list declarations (`ClMetaConsumer`, packages `HmiBase`, `Iecpl`, `Siemens.Automation.DomainModel`) | XML | Yes | **Confirmed** [E-V11]; absent in V18 sample |
| `IM/SearchIndex/_h*.fdt .fdx .fnm .frq .prx .tii .tis .tvd .tvf .tvx .cfs .del segments_*` | **Apache Lucene (2.x/3.x codec) full-text index** of project objects. Stored fields `Name`, `DisplayName`, `Comment`, `Datatype`, `Value`; doc IDs are base64 object refs. | Lucene binary (open format) | Yes — Lucene.NET / PyLucene legacy codec | **Confirmed** [E-V18] |
| `IM/SPL/options` | Editor project options | zlib → .NET `BinaryFormatter` graph (`Siemens.Simatic.Lang.Code.Services.ProjectOptions.Impl.ProjectOptionEntry`) | Yes | **Confirmed** [E-V18] |
| `Vci/Vci.db` | Version Control Interface bookkeeping: `ExportRecord(counter,fileHash,fileHashDescription)`, `FingerprintRecord(name,value)`. Empty unless VCI used. | SQLite 3 | Yes | **Confirmed** [E-V18] |
| `AdditionalFiles/PLCM/plcmArchive.pma[15_0]` | PLC Manager archive marker; 4 zero bytes | stub | n/a | **Confirmed** [E-V18][E-V11] |
| `Logs/ TMP/ UserFiles/ XRef/` | Standard project folders (UserFiles = user attachments; XRef = cross-ref caches) | mixed | UserFiles yes | [E-DOC][E-COMM]; not present in the small samples |
| `.zap11 … .zap20` (`.zap15_1`) | Project archive = whole folder above, **ZIP** (7-Zip opens it). `.zal` = library archive | ZIP | Yes → same folder | **High** [E-COMM many; E-SRC jfk uses SharpCompress]; not sampled |
| `.al11 … .al20` + folder | Global library (same PLF structure) | as project | same | [E-SRC] jfk `RootObject.StoreObjectIds["Library"]` |
| `.xml` (SimaticML) | Openness/VCI export of blocks, tag tables, UDTs, HMI. Namespaces `…/Openness/SW/Interface/v5`, `…/SW/NetworkSource/FlgNet/v5` … | XML | Yes | **Confirmed** [E-DOC]; consumed by tools in §7 |
| `.scl .db .udt .awl/.stl` | "Generate source from blocks" | Text | Yes | **Confirmed** [E-DOC] |
| `.aml` (CAx AutomationML) | Openness `CaxProvider` hardware/network export (devices, modules, order numbers, FW, IPs, PN names) | AutomationML/CAEX XML | Yes | **Confirmed** [E-DOC]; not sampled |
| `.xlsx` | Tag-table import/export | OOXML | Yes | **Confirmed** [E-DOC] |
| `.gsd/.gsdml`, HSP | Device descriptions | text / XML | Yes | **Confirmed** [E-DOC] |
| `.zapc`, `.zapx` | `.zapc` = archive w/o compilation info; `.zapx` = multiuser project archive (V17+) | ZIP | Yes | [E-COMM] — verify |
| `.s7p` + `*.dbf` | **STEP 7 Classic V5.x**, not TIA. FoxPro DBF; fully parsed by DotNetSiemensPLCToolBoxLibrary | dBase | Yes | **Confirmed** [E-SRC] |
| `.ald` | Appears only in user lists; no sample found | – | – | **UNKNOWN** |

Internal object-frame XML namespaces observed inside the PLF (usable as magic strings for stream classification) [E-V18][E-V11]:

- `…/Automation/2004/04/ObjectFrame/Meta` (`MetaInfo`) — V11 & V18
- `…/Automation/2010/01/ObjectFrame.MetaInfo/ObjectFrame/MetaInfo` (`StorageMetaInfoXML`) — V11; 200 KB–6 MB per stream; **class/attribute catalogue of the object model**
- `schemas.siemens.com/Simatic/ES/11/BlockInterface/Source/V11_01.xsd` (`Root`, `Member`) — V11 block interfaces
- `…/ES/11/BlockInterface/ExternalTypes/V11_01.xsd` (`ExternalTypes`) — V11 referenced system FBs (T_CON, T_DISCON… with VersionGuid/LibReference)
- `OffsetData Version="3.0"`, `OffsetSpecification="NENA_PLEASE"|"TRUE_CLASSIC"` — V11 memory layouts (optimized vs. standard)
- `…/automation/2010/IECPL` (`PlcArray`, `Target Name="S71200"`, `BlockReference Code="MB_CLIENT" Data="InstanceDB"`) — V11 call references
- `…/automation/2015/FunctionLadderDiagram` — V18 LAD network XML (7 streams)
- `…/ES/14/IdentManager/IdentXmlPart.xsd`, `ICFilcMetaPayload.xsd` — V18 identity manager
- `www.Siemens.com/DebugInfoV1_0.xsd` — V18 compiler debug info (5 streams)
- `<LibraryVersions StorageVersion="V1.1"><Library LibGuid=… DisplayVersion=…>` — library manifest
- V18 XML streams are consistently preceded by `00 10 DE AD BE EF 01 00 …` (18/47 XML streams) — candidate record-header signature [E-V18].

---

## 2. Project Structure (reconstructed)

```
<ProjectName>/                                # the project folder (= content of a .zapNN)
├── <ProjectName>.ap18                        # XML stub: icon + ProjectVersion          [E-V18]
├── System/
│   ├── PEData.plf                            # object store (zlib blobs, append-only)   [E-V18][E-V11]
│   ├── PEData.idx                            # offset index, same GUID                  [E-V18][E-V11]
│   ├── PEData.plf1…                          # overflow segments (large projects)       [E-SRC jfk]
│   └── PEData/Meta/ChangeList{Consumer,Provider}/*.xml     # seen in V11 only          [E-V11]
├── IM/
│   ├── SearchIndex/                          # Lucene: Name/DisplayName/Comment/Datatype/Value  [E-V18]
│   └── SPL/options                           # zlib + .NET BinaryFormatter editor options       [E-V18]
├── Vci/Vci.db                                # SQLite VCI bookkeeping                   [E-V18]
├── AdditionalFiles/PLCM/plcmArchive.pma15_0  # 4-byte stub                              [E-V18][E-V11]
├── UserFiles/                                # arbitrary user attachments               [E-DOC]
└── Logs/  TMP/  XRef/                        # logs, temp, cross-reference caches       [E-COMM]
```

Logical object model inside `PEData.plf` — *existence* of each element is proven by strings/XML; the *containment* arrows are inferred from TIA's UI model and the V11 `HW.…` path strings:

```
Project (name, author, comment, created/modified "31/05/2025 9:12:01 AM")              [E-V18 strings]
└── Device "S7-1500/ET200MP station_1"                                                    [E-V18]
    ├── Rack (V11: S71200\RACK\MDD_6ES7290-1xxx0-0AA0_1.0)                                [E-V11]
    ├── CPU "Brain" = CPU 1512C-1 PN, 6ES7 512-1CK00-0AB0, FW attribute "V1.8"           [E-V18]
    │   ├── sub-modules: CPU display 6ES7591-1AA00-0AA0, CPU exec unit, Card reader/writer_1,
    │   │   HSC, onboard DI16/DQ16 "6ES7 523-1BL00-0AA0"                                  [E-V18]
    │   ├── PROFINET interface_1 → Port_1, Port_2, mrpdomain-1                            [E-V18]
    │   │   └── "Network Parameters": IP 192.168.0.1 / 255.255.255.0 / GW 192.168.0.1     [E-V18 binary TLV]
    │   ├── PLC tag tables ("Default tag table", Tag_1…) → Lucene Name/Datatype/Value      [E-V18]
    │   ├── Program blocks (OB Main, FB, FC, DB)  — V18 LAD XML; V11 BlockInterface XML    [E-V18][E-V11]
    │   │   └── per block: InterfaceGuid, BlockObjectID "{2101318-1437}", LibReference GUID:Name:Ver,
    │   │       Members (ID, Name, RID, Type, LID, MFlags, bit offsets), OffsetData         [E-V11]
    │   ├── PLC data types (UDT) — same Member XML family                                   [E-V11]
    │   ├── Alarm classes, Supervision settings, Text lists (virtual folders in Lucene)     [E-V18]
    │   └── DownloadLog / DownloadTimeStamp records (≤4 kept)                              [E-COMM NVISO][E-V18 strings]
├── Subnet PN/IE_1 (V11: HW.SubnetIE, NetDefaultSubnetIE, NodeIPSubnetMask, PnStationNumber) [E-V11]
├── Referenced libraries (LibGuid + DisplayVersion, e.g. 134BE666-…:V2.0 Modbus)            [E-V11]
└── HMI / WinCC (HmiBase namespace registered; no HMI configured in samples)                [E-V11]
```

**Identifiers.** V11 block XML exposes three ID systems — `InterfaceGuid` (GUID per interface version), `BlockObjectID="{2101318-1437}"` (object-store ID pair), `LibReference="<LibGuid>:<Name>:<Ver>"` — plus member-level `ID`, `RID` (type RID: `0x02000001`=Bool, `0x02000004`=Word, `0x02000034`=USInt, `0x02000035`=UInt, `0x0200003F`=Variant), `LID`. V18 uses base64 object references in Lucene and `#144115188075855873="14.0.0.0"` attribute maps. **Cross-file mapping of these IDs has NOT been demonstrated here** — that is what jfk's `StorageObject` graph does and what an AquaFlow prototype would have to reproduce.

---

## 3. Version Differences

| TIA version | Project entry / archive | Storage generation (jfk-solutions claim, cross-checked where possible) | Export formats | Differences relevant to parsing |
|---|---|---|---|---|
| V10.5 | `.ap10_5` | Gen-1 PLF | — | Oldest; only jfk claims support |
| **V11** | `.ap11` / `.zap11` | Gen-2 PLF — **220 of 277 streams are XML** [E-V11]; block interfaces fully XML; `PEData/Meta/ChangeList*` present | STL/SCL sources | **Most transparent**; `V11_01.xsd` namespaces |
| V12 | `.ap12` | Gen-2 | + first Openness (limited) | — |
| **V13 / SP1** | `.ap13` | Gen-2 | Openness block XML (SimaticML v1) | DotNetSiemensPLCToolBoxLibrary `TIAV13` loads projects **through Siemens' own DLLs** (TIA must be installed) [E-SRC] |
| **V14 / SP1** | `.ap14` | **Gen-3 PLF** (jfk); our V18 sample carries `ES/14/IdentManager` namespaces, consistent with a V14 object-model reset [E-V18] | Openness v2; CAx AML (V14 SP1+) | Object model moved largely to binary attribute records |
| V15 / **V15.1** | `.ap15` / `.ap15_1` / `.zap15_1` | Gen-3 | Openness v3/v4; CAx | NVISO forensics (V15.1): append-only, `DownloadLog`, `##CLOSE##` [E-COMM] |
| **V16** | `.ap16` | Gen-3 | Openness; **VCI add-in introduced** | `Vci/Vci.db` appears in project folder |
| **V17** | `.ap17`, `.zapx` (multiuser) | Gen-3 | Openness v5; VCI; CAx | Secure PG/PC comms (TLS) for S7-1200 FW≥4.5 / S7-1500 FW≥2.9 — affects online tooling, not the file |
| **V18** | `.ap18` / `.zap18` | Gen-3 — **137 of 184 streams binary, 47 XML** [E-V18]; Lucene `IM/SearchIndex`; `Vci.db`; `IM/SPL/options` | Openness; VCI; CAx | Hardware/network = binary TLV; LAD networks still XML |
| V19 | `.ap19` | Gen-3 | Openness; VCI; CAx | "same files, more objects" [E-SRC jfk README] |
| V20 | `.ap20` | Gen-3 | Openness; VCI; CAx | S7-1200 G2; jfk claims support through V20 |

Observations:
- **Newer ≠ encrypted.** V18 is *more binary* than V11 (≈25 % XML streams vs ≈80 %) but still plain zlib. RE gets harder because the object model moved from XML to binary attribute records, not because of cryptography [E-V18][E-V11].
- **Openness SimaticML is not version-stable** — namespace versions increment (`Interface/v1…v5`, `FlgNet/v1…v5`) and TIA rejects XML of the wrong version; every open-source Openness tool pins a version [E-SRC `tools/tia-openness-bridge/README.md`; E-DOC].
- **Migration is one-way**: a `.zap15_1` opens in V18 via upgrade; never downward [E-DOC][E-COMM].

---

## 4. Reverse-Engineering Findings (with evidence)

### 4.1 `PEData.plf` container
- Header: `40 00 01 00 01 00 00 00` + 16-byte GUID (V18 `9ea04091-e1b5-c449…`, V11 `ae31c25d-2acc-314f…`). `PEData.idx` header is `80 00 01 00 01 00 00 00` + the **same** GUID → idx belongs to plf [E-V18][E-V11].
- Entropy 5.28 (V18) / 6.23 (V11): far below the ~7.99 of encrypted data; consistent with zlib blobs + plaintext headers [E-V18][E-V11].
- Carving by scanning for zlib headers (`78 9C/DA/5E/01`) and inflating with `zlib.decompressobj()` yields 184 (V18) / 277 (V11) valid streams, compressed→raw ratios up to 1:30 [E-V18][E-V11]. Script: `tmp/tia-research/carve.py`.
- NVISO (V15.1): every edit **appends**; earlier bytes are never rewritten; sessions end with `##CLOSE##`; `DownloadLog`/`DownloadTimeStamp` entries record downloads (max 4 unique observed) [E-COMM]. `DownloadLog` strings also occur in our V18 file [E-V18].
- **Not found:** any AES/RSA signature, salted header or high-entropy region without a zlib header. Conclusion: **the PLF is obfuscated by structure, not encrypted.** What *is* protected per Siemens docs: know-how-protected block *sources* (interface stays visible) and project/user password hashes — unverified here because neither sample uses protection [E-DOC].

### 4.2 Hardware & network (V18)
- Uncompressed PLF region holds a device-tree string table (1-byte length-prefixed ASCII): `S7-1500/ET200MP station_1`, `Brain`, `Card reader/writer_1`, `CPU display_1`, `CPU exec unit_1`, `PROFINET interface_1`, `.Port_1`, `.Port_2`, then an order-number table `6ES7 512-1CK00-0AB0 / Siemens / CPU general`, `6ES7591-1AA00-0AA0 / Siemens / CPU display`, `6ES7 523-1BL00-0AA0 / Siemens / DI 16x24VDC / DQ 16x24VDC/0.5A BA` [E-V18 `hunt_out.txt`].
- A decompressed stream contains a typed attribute list: `<Attribute Name="InvariantTypeName" Type="String" Value="CPU 1512C-1 PN" /><Attribute Name="OrderNumber" …` with an adjacent `Value="V1.8"` → **firmware version stored as a typed attribute record** [E-V18].
- IP: in a decompressed stream, directly after ASCII `Network Parameters`, the TLV run `a0 01 00 14 30 00 00 10 01 00 00 00 c0 a8 00 01 ff ff ff 00 c0 a8 00 01 a0 04 00 14 …` = IP 192.168.0.1 / mask 255.255.255.0 / router 192.168.0.1; nearby `brain` (PROFINET device name = lower-cased station name), `mrpdomain-1` [E-V18]. Tags of the form `a0 xx 00 14` / `a3 xx xx 00 14` recur → 0x14 looks like a kind/length marker. **Framing not decoded.**
- The raw PLF also contains other `c0 a8 …` byte pairs (192.168.126.128, 192.168.46.59 …) — all inside compressed regions → false positives. Rule: **inflate first, then pattern-match** [E-V18].

### 4.3 Hardware & network (V11)
- Device-description paths, uncompressed: `S71200\CPU\CPU_1214C\MDD_6ES7214-1BE30-0XB0_2.2`, `S71200\RACK\MDD_6ES7290-1xxx0-0AA0_1.0`, `S71200\SB\Analog\AO\MDD_6ES7232-4HA30-0XB0_1.0`, `S71200\SUBMODULES\CPU\OnboardIO\MDD_Simatic-CPU1214-Sub-OnboardDigitalIO_2.0` = **catalog path + order number + catalog/FW family version** [E-V11].
- Network parameter *names* are plain strings (`NodeIPSubnetMask`, `NetLastUsedIPSubnetMask`, `NetLastUsedIPDefaultRouterAddress`, `PnStationNumber`, `NetDefaultSubnetIE`, `PN/IE_1`, `Interfaz PROFINET`), but **no `c0 a8` bytes exist in the V11 decompressed streams** → V11 stores the IP in a stream our carver missed or in another encoding. **OPEN ITEM.**

### 4.4 Program blocks
- **V11:** every block/UDT/instance-DB interface is XML (`Root`/`Member` in `BlockInterface/Source/V11_01.xsd`) with `Name`, `Type`, `RID`, `ID`, `LID`, bit offsets (`ClassicBitoffset`, `NenaBitoffset`, `RelativeBitoffset`, `PaddedBitsize`) and HMI/S7 visibility tokens. `OffsetData` gives both optimized (`NENA_PLEASE`) and standard (`TRUE_CLASSIC`) layouts. `ExternalTypes` names the system FBs (T_CON, T_DISCON, TSEND, TRCV…) with `LibReference GUID:Name:Version`. `IECPL PlcArray/BlockReference` shows which blocks call which (MB_CLIENT/MB_SERVER → InstanceDB) [E-V11].
- **V18:** 7 streams in the `FunctionLadderDiagram` namespace = LAD network bodies as XML; 5 `DebugInfoV1_0` streams; block/tag *names* live in the Lucene index and in the uncompressed string table (`Main`, `OB1`… were **not** found as UTF-8/UTF-16 in the decompressed streams by our simple scan — they are in Lucene and probably in length-prefixed form) [E-V18].
- **Compiled MC7+/machine code:** not identified in either sample. jfk's Openness-AML exporter re-derives blocks from the *source-level* objects, not from compiled code [E-SRC README].

### 4.5 Side files
- `IM/SearchIndex` is a Lucene 2.x/3.x index (`segments_79`, `.cfs` compound files, `.fdt` stored fields). Field names `Name`, `DisplayName`, `Comment`, `Datatype`, `Value`; documents keyed by base64 refs that decode to `Siemens.Simatic.AlarmClassesVirtualFolder`, `Siemens.Automation.TargetTextListsVirtualFolder`, etc. → a **cheap way to enumerate object names/types without parsing the PLF**, using Lucene.NET 3.0.3 or a hand-written `.fdt/.fdx` reader [E-V18].
- `IM/SPL/options` → zlib → .NET BinaryFormatter (`Siemens.Simatic.Lang.BlockEditorFrame, Version=1800.100.4201.1`) → yields exact TIA build (1800.100.4201.1 = V18 Upd?) [E-V18].
- `Vci/Vci.db` SQLite schema confirms VCI exports are tracked by `fileHash` fingerprints; empty in the sample [E-V18].

### 4.6 What was **not** achieved here
- PLF record framing (how object type IDs, parent links and attribute lists are laid out) — only jfk-solutions has this, closed source.
- Mapping V18 base64 object refs → PLF records.
- Any write/round-trip.

---

## 5. GitHub Research

### 5.1 `sployal/TIA_portalV18_projects` — reference dataset (inspected on disk)
- **URL:** https://github.com/sployal/TIA_portalV18_projects · **Purpose:** author's TIA V18 examples; README is a generic V18 style guide, not a format description.
- **Content:** one complete, uncompressed project folder `Conveyor belt_7/` (31 files, 1.5 MB): `.ap18`, `System/PEData.plf|.idx`, `IM/SearchIndex/*` (28 Lucene files), `IM/SPL/options`, `Vci/Vci.db`, `AdditionalFiles/PLCM/plcmArchive.pma15_0`, `init.md`. No `.zap18`, no exports.
- **Device:** S7-1500 **CPU 1512C-1 PN** (`6ES7 512-1CK00-0AB0`), station "Brain", IP 192.168.0.1/24, FW attribute V1.8, onboard DI16/DQ16, MRP domain. Program: LAD (7 network XML streams); `ProjectVersion 18.0.1.0`; timestamps 31/05/2025.
- **Answers to the brief:** text/XML = `.ap18`, `Vci.db`, Lucene stored fields; binary = PLF/idx/options; compressed = PLF payloads + `options` (zlib). PLC device ✔, CPU ✔, IP/device name ✔, modules + order numbers ✔, firmware ✔ (attribute), rack/slot ✘ (slot numbers surely sit in the TLV records but were not isolated), module ordering ✘, DB/UDT/tag *names* ✔ (Lucene), tag datatypes/values ✔ (Lucene fields), relationships ✘ (needs record framing).
- **Relevance:** good V18 baseline; small enough for byte-level diffing. Limitation: single project, no differential pairs, no S7-1200.

### 5.2 `luismigueldurandiaz/modbus_1200_1200` — second dataset (V11, S7-1200)
- Complete `.ap11` project (CPU 1214C AC/DC/Rly, SB AO 6ES7 232-4HA30, Modbus TCP client/server). ≈80 % of PLF payloads are XML → **best sample for learning the object model**, since the same objects that are binary in V18 are XML here.

### 5.3 `jfk-solutions/TiaFileFormat` + `TiaProjectBrowser` + `TiaFileFormatLowLevelSample`
- **URLs:** https://github.com/jfk-solutions/TiaFileFormat (README + licences only — **closed NuGet, commercial licence**), https://github.com/jfk-solutions/TiaProjectBrowser (MIT GUI; cloned to `tmp/tia-research/tpb`; depends on the closed NuGet), https://github.com/jfk-solutions/TiaFileFormatLowLevelSample (MIT, 6 commits).
- **Claims (README):** reads PLF V10.5–V20 directly or from `.zap`; three storage generations (V10.5, V11, V14+); exports program blocks to AutomationML; extracts images; hardware-info wrapper "planned"; cross-platform; **no TIA needed**. Dependencies `BouncyCastle.Cryptography`, `SharpCompress`, `zlib.net` — BouncyCastle implies *some* content is cryptographically protected (know-how protection / passwords); README doesn't say what.
- **Source read (TiaProjectBrowser):** `Views/MainView.axaml.cs` walks `TiaDatabaseFile.RootObject.StoreObjectIds` ("Project"/"Library") → tree of `StorageBusinessObject`s with typed attribute dictionaries; `StoreObjectView.axaml.cs` renders attributes, relations and XML payloads; `OnlineHelper.cs`/`IpSelector` add online functions. This `StorageObject → StorageSystemObject | StorageBusinessObject` model with attributes + `Relations` is the **best public description of the PLF record model** — but the parser itself is not public.
- **Relevance:** proves full parsing is *possible* for all versions; a viable *commercial* shortcut for AquaFlow. Not usable as an open-source component.

### 5.4 `dotnetprojects/DotNetSiemensPLCToolBoxLibrary` (cloned `tmp/tia-research/dnspt`)
- Classic .NET toolbox: LibNoDave wrapper + complete **STEP 7 V5.x `.s7p`/DBF parser** + TIA glue (`…TIAV13` … `…TIAV18`).
- **Source read:** `Step7ProjectV11.cs` implements TIA support by **loading Siemens' own assemblies** (ObjectFrame / PEData storage DLLs) via reflection; `Documentation/TIA CRC.txt` names `Siemens.Automation.DomainServices.StructureProviderSupport.TypesafeAddressCRCProvider` (CRC for optimized-DB symbolic addresses). ⇒ **Requires an installed TIA Portal**; not a file-format parser.
- **Relevance:** template for DB/UDT/SCL data-type modelling; evidence that Siemens' ObjectFrame DLLs are the "real" parser.

### 5.5 `thomas-v2/S7CommPlusDriver` (cloned `tmp/tia-research/s7cp`) — communication, not files
- LGPL-3.0 C#; S7CommPlus over TLS for S7-1200 FW≥4.3 / S7-1500 FW≥2.9 (must be projected with TIA ≥V17). Public API in `S7CommPlusConnection.cs`: `Connect(address, password, username)`, `Disconnect`, `ReadValues`, `WriteValues`, `SetPlcOperatingState`, `Browse` (symbolic tag list), `GetListOfDatablocks`, `GetTypeInformation`, `getTypeInfoByRelId`, `getPlcTagBySymbol`, `GetCommentsXml`. Core folder: `Explore*`, `GetMultiVariables*`, `SetMultiVariables*`, `CreateObject*`, `DeleteObject*`, `GetVarSubstreamed*`, `BlobDecompressor`, `Alarming`, `Subscriptions`. **No block download/upload, no hardware configuration** (absent from API).
- **Relevance:** covers "read/write variables, list DBs, browse symbols, start/stop" with no project file at all.

### 5.6 Other repositories (surveyed, not cloned)
| Repo / family | What it is | TIA dependency | Note for AquaFlow |
|---|---|---|---|
| Siemens `tia-portal-openness-*`, community `TiaOpennessSamples`, `Openness-Export-Import` | C#/.NET Openness scripts: export blocks/tags/UDT/HMI to SimaticML, import, compile, download | **Yes** (Openness runs inside TIA) | Same approach as this repo's `tools/tia-openness-bridge` |
| `simatic-ax/*` (Siemens) | SIMATIC AX: VS Code + `apax` ST compiler, `apax sld` download to S7-1500 / PLCSIM Adv / S7-1200 G2 | No TIA; Siemens licence + toolchain | Already covered in `SIEMENS-ZERO-TIA-ARCHITECTURE-DECISION.md`; **S7-1200 G1 unsupported** |
| `gijzelaerr/python-snap7`, `SCADACS/snap7` | S7comm classic client: DB read/write, PLC status, `list_blocks`; block `upload` only on 300/400; 1200/1500 need PUT/GET + non-optimized DBs | No | AquaFlow's existing runtime layer |
| `thomas-v2` Wireshark `s7comm_plus` dissector | Protocol RE; object IDs documented in dissector / `Ids.cs` | No | Reference for CPU identification objects |
| `fbarresi/Sharp7`, `S7NetPlus` | S7comm libs | No | runtime only |
| VCI workspaces on GitHub (search `"SW.Blocks.FB"` `"Openness/SW/Interface"`) | Git-tracked SimaticML XML exported by VCI | Yes to produce | **Real SimaticML samples V16–V19 = test data for an export parser** |
| `awl2scl`, `scl-parser`, tree-sitter `structured-text` | SCL/ST grammars | No | Basis for generating SCL text from AquaFlow models |
| `pnio_dcp` (python-profinet-dcp), `profinet-dcp-rs`, ProfinetTools | PROFINET DCP identify / set IP / set name | No | Discovery layer (see `PROFINET_DCP_WINDOWS.md`) |
| NVISO "Investigating an engineering workstation" parts 1–4 (blog) | PLF forensics V15.1 with `xxd`/`colordiff`/`strings` | No | The only public *differential* PLF experiment |

**GitHub code-search conclusion:** no open-source project parses TIA V14+ `PEData.plf` semantically. Hits for "TIA Portal parser/converter/decompiler" are (a) Openness wrappers, (b) SimaticML processors, (c) S7 protocol clients, or (d) the closed jfk library.

---

## 6. Reddit / Community Research

Sources: r/PLC, PLCS.net, Siemens Industry Online Support forum, mrplc, NVISO blog. Reddit's search endpoint is not machine-readable (returned an empty shell), so thread-level claims below are the recurring answers seen across forums, labelled by category.

| Claim (as commonly stated) | Category | Assessment |
|---|---|---|
| "You cannot open a TIA project without TIA Portal; there is no viewer." | Personal experience | **True for editing/compiling.** For *reading*, jfk `TiaProjectBrowser` disproves it (closed lib). |
| "The `.zap` is just a zip — extract with 7-Zip." | Widely verified; consistent with jfk using SharpCompress | **High confidence**; not re-verified here (our samples were already folders). |
| "TIA project files are encrypted, nothing is recoverable." | Speculation / incorrect | **Incorrect as stated.** PLF is zlib; strings, XML, order numbers, IPs recoverable [E-V18][E-V11]. Correct part: framing undocumented. |
| "Export XML with Openness/VCI for Git; the project itself is useless in Git." | Personal experience | **True**; PLF is append-only binary → every save diffs. Confirms export-first strategy. |
| "Upload from a 1200/1500 needs TIA; comments lost unless downloaded with symbols." | Experience + docs | **True**; no third-party tool uploads 1200/1500 projects. |
| "Downgrading a project (V18→V17) is impossible." | Experience / docs | **True** [E-DOC]. |
| "Corrupted project: restore from `.zap` or upload from PLC; Siemens support can sometimes repair the PLF." | Experience | Plausible; no third-party PLF repair tool found. |
| "HMI vendors (Weintek, Pro-face…) import PLC tags directly from `.ap` files." | Experience | **Unverified**; Weintek doc fetch returned 404. Vendors are documented to accept TIA **exports** (`.xlsx`, `.db`, `.scl`, `.xml`), not the PLF. |
| "The `.ap` file contains the project." | Incorrect | It is a 7 KB icon + version stub [E-V18][E-V11]. |
| NVISO: "changes are appended; DownloadLog reveals downloads; `##CLOSE##` ends sessions." | **Verified experiment (V15.1)** | Independent and reproducible; consistent with our V18 strings. |

---

## 7. Existing Open-Source Tools

| Tool | Language | Input → Processing → Output | TIA dependency | AquaFlow use |
|---|---|---|---|---|
| zlib carver (this research, `tmp/tia-research/carve.py`) | Python | PLF → zlib-header scan + inflate → streams classified XML/bin | None | Seed of a PLF inventory extractor (60 lines, works on V11 & V18) |
| Lucene.NET 3.0.3 / PyLucene (legacy codecs) | C# / Python | `IM/SearchIndex` → index reader → object Name/DisplayName/Datatype/Value | None | Fast enumeration of tags, blocks, folders |
| `sqlite3` | any | `Vci/Vci.db` → rows | None | Detect VCI export history |
| jfk-solutions `TiaFileFormat` | C# (closed NuGet) | PLF/.zap → full object graph → AML blocks, images | None (commercial licence) | Only complete parser; buy-vs-build |
| `TiaProjectBrowser` | C# Avalonia (MIT shell) | GUI over the above | None | Reference for object-model naming |
| Openness bridge (`tools/tia-openness-bridge`) | C# + Python | AquaFlow model → SimaticML/SCL → TIA import/compile/download | **TIA required** | Current deployment path |
| SimaticML readers (`lxml`, .NET `XDocument`; community `TiaXmlParser`, `SimaticML.NET`) | Python / C# | Openness XML → blocks, interfaces, networks, tags, UDTs | None to read (TIA to produce) | Import of customer-supplied exports |
| AutomationML libs (`AutomationML.Engine`, Python `aml`) | C# / Python | CAx `.aml` → devices, modules, order numbers, IPs, PN names | None to read | Hardware-model import |
| `python-snap7` / Snap7 | Python / C++ | S7comm → DB read/write, CPU state, block list (300/400) | None | Runtime I/O (already in AquaFlow) |
| `S7CommPlusDriver` | C# | S7CommPlus/TLS → symbolic browse, DB list, read/write, run/stop | None | Symbolic runtime + PLC identification (1200/1500) |
| `pnio_dcp` / `profinet-dcp-rs` | Python / Rust | L2 DCP → identify, set IP, set name, blink | None | Discovery + network config |
| GSDML parsers (`gsdml-parser`, `p-net`) | Python / C | GSDML → module catalog, submodule IDs | None | Validate module order numbers against a catalog |
| SIMATIC AX (`apax`) | Siemens toolchain | ST → compile → download to S7-1500 / 1200 G2 | No TIA; Siemens licence | Alternative deploy path (not S7-1200 G1) |

---

## 8. What AquaFlow Can Potentially Parse

**CONFIRMED (demonstrated on real files in this research)**
- `.apXX` → `ProjectVersion` (exact TIA version/update) [E-V18][E-V11].
- `.zapXX` → ZIP → project folder (community-verified; jfk source-confirmed).
- `PEData.plf` → zlib streams → XML + binary payloads (184 / 277 streams) [E-V18][E-V11].
- CPU type name, order numbers of CPU and modules, module display names, station name, PROFINET interface/port names, MRP domain (V18, string tables) [E-V18].
- CPU IP / subnet mask / gateway as raw bytes in a decompressed TLV record (V18) [E-V18].
- CPU catalog path incl. order number + catalog version, rack and signal-board order numbers (V11) [E-V11].
- Block/UDT/DB interfaces incl. member names, data types, bit offsets, optimized vs standard layout, referenced system FBs with library GUID/version (V11 XML) [E-V11].
- LAD network XML presence (V18) — content parse not attempted [E-V18].
- Object names/types/datatypes/values from the Lucene search index (V18) [E-V18].
- Exact TIA build from `IM/SPL/options` [E-V18].
- VCI export fingerprints from `Vci/Vci.db` [E-V18].
- Openness SimaticML / SCL / CAx-AML exports: everything they contain (documented, widely parsed).

**HIGH CONFIDENCE (strong evidence, not fully demonstrated)**
- Firmware version of CPU (V18 `Value="V1.8"` attribute adjacent to `InvariantTypeName`; V11 `_2.2` suffix) — needs a second sample to confirm attribute name.
- PROFINET device name = lower-cased station name (`brain`) — standard TIA behaviour, seen in stream.
- Block names, tag names, DB numbers via Lucene + string tables for V14+.
- Full V11 project reconstruction (hardware + blocks) from XML streams.
- `.zapc`/`.zapx` open as ZIP like `.zap`.

**POSSIBLE (plausible, needs experiments)**
- Rack/slot numbers and module order (must be in the HW TLV records; differential experiment §9-E2).
- PLF record framing (type ID, parent ref, attribute list) → object graph, by aligning V11 XML objects with V18 binary equivalents.
- Decoding V18 LAD XML into a call graph / IO mapping.
- Extracting DB initial values for V14+ (Lucene `Value` field suggests yes).
- Reading know-how-protected block *interfaces* (Siemens says interface stays visible).

**UNKNOWN**
- `PEData.idx` layout.
- Where V11 stores IP bytes.
- HMI/WinCC screen data structure (no sample).
- Safety (F-) configuration representation.
- Behaviour of multiuser/`.zapx` projects and `.plf1+` segmentation.

**NOT CURRENTLY FEASIBLE**
- **Generating** a PLF that TIA Portal opens (no public evidence anyone has done it; append-only log with undocumented framing, CRCs such as `TypesafeAddressCRCProvider`, and probable integrity checks).
- Recovering compiled code / know-how-protected sources.
- Downloading hardware config or blocks to S7-1200/1500 from parsed data without TIA (or SIMATIC AX for S7-1500).

---

## 9. Engineering Data vs. PLC Communication — task matrix

| AquaFlow task | Needs TIA project data? | Achievable without TIA via | Evidence level |
|---|---|---|---|
| 1. Discover a Siemens PLC | No | PROFINET DCP Identify-All (L2) → MAC, IP, device name, vendor/device ID | Confirmed (`pnio_dcp`; `PROFINET_DCP_WINDOWS.md`) |
| 2. Identify CPU (order no., serial) | No | S7comm SZL 0x0011/0x001C (Snap7 `get_order_code`/`get_cpu_info`), also on 1200/1500; S7CommPlus attributes | Confirmed |
| 3. Identify firmware | No | SZL 0x0011; S7CommPlus | Confirmed |
| 4. Hardware configuration (modules) | Partly | Offline: PLF string tables (§4.2) or CAx AML. Online: SZL 0x0091/0x0191 gives slot status, not order numbers | Offline confirmed; online partial |
| 5. Rack/slot | Partly | Offline: TLV decode (Possible). Online: SZL 0x0091 | Possible |
| 6. Configure networking | No | DCP Set-IP / Set-Name (blocked if HW config says "IP set in project" and CPU enforces it) | Confirmed with caveat |
| 7. Upload/download engineering data | **Yes** | Only TIA (Openness) or SIMATIC AX (S7-1500 / 1200 G2); S7CommPlusDriver has no block transfer | Not feasible OSS |
| 8. Read/write PLC variables | No | Snap7 (absolute, PUT/GET, non-optimized DB) or S7CommPlus (symbolic, optimized, TLS) | Confirmed |
| 9. Compile PLC programs | TIA or AX | Openness `Compile()`; AX `apax build` | Confirmed (Siemens software) |
| 10. Start/stop CPU | No | Snap7 `plc_hot_start/plc_stop`; S7CommPlusDriver `SetPlcOperatingState` (password if protected) | Confirmed |
| 11. Deploy fountain program | Yes | Openness bridge (existing) or AX | Confirmed (Siemens software) |

---

## 10. Reverse-Engineering Roadmap (prioritised experiments)

**E0 — Freeze the toolkit (½ day).** Promote `carve.py`/`inspect.py` into a research-only package `tools/research/tia-plf-lab/` (Python 3.11, stdlib). Add: stream index writer, per-stream SHA-256, string-table extractor (1-byte-length-prefixed ASCII + UTF-16LE), TLV pretty-printer for `a0/a3 xx 00 14` patterns. Keep `tmp/tia-research/` out of git.

**E1 — Noise floor (1 day; needs one TIA V18/V19 seat).** `Base` = empty S7-1214C project, save, close. Reopen/save unchanged → diff PLFs to learn the noise (timestamps, session records, `##CLOSE##`). Confirm NVISO's append-only finding on V18/19.

**E2 — Hardware/network deltas (2 days).** One change per project from `Base`: IP .10→.11, station name, CPU 1214C→1215C, FW V4.5→V4.6, +SM1221 DI8, +SM1222 DQ8, +SM1231 AI4, slot swap, +ET 200SP IO device, mask /16. Extract appended region (`dd skip=<old size>`), inflate, diff. Deliverable: table *field → stream namespace → byte pattern*. Resolves rack/slot, module order, firmware attribute name, V11-vs-V18 IP encoding.

**E3 — Software deltas (2 days).** 1 Bool tag; mixed-type tags; UDT; standard DB; optimized DB; FB (SCL) + instance DB; FC (LAD); OB30; OB1→FB→FC call graph. Correlate with Lucene docs and `FunctionLadderDiagram` streams. Determine whether SCL *source text* is stored plainly (expected yes, zlib stream).

**E4 — Record framing (3–5 days, hardest).** Use the V11 sample as Rosetta stone: for each V11 XML object (e.g. `Root BlockObjectID="{2101318-1437}"`) locate the equivalent V18 binary record; infer header (type ID, object-ID pair, parent ref, attribute count). Use jfk's free `TiaProjectBrowser` demo as an *oracle* for object names (don't redistribute).

**E5 — Lucene reader (1 day).** Read `IM/SearchIndex` with Lucene.NET 3.0.3 or a hand `.fdx/.fdt` decoder; dump all docs; map base64 IDs to object types; cross-check counts with E3.

**E6 — Export-parser prototype (2 days, parallel, no RE).** Parse SimaticML v5 (V17–V19) + CAx AML into the AquaFlow normalized model; test with GitHub VCI workspaces and with exports from E2/E3. Low-risk import path.

**E7 — Generator decision gate.** Only after E4: attempt the smallest write (append one PLC-tag record) and open in TIA. Expect failure. **No roadmap time for PLF generation before E4 completes.**

**E8 — Validation.** Compare every prototype-extracted field with the Openness export of the same project (ground truth). Coverage matrix = release criterion for a read-only "TIA Project Inspector".

---

## 11. Recommended Test Dataset

| ID | Project (TIA V18 unless noted) | Purpose |
|---|---|---|
| D01 | Empty project, no device | Container / noise baseline |
| D02 | S7-1214C DC/DC/DC, defaults | Hardware baseline (AquaFlow's target family) |
| D03 / D04 | D02 + IP 192.168.1.10 / .11 | IP encoding, 1-byte delta |
| D05 | D02 + station name "Fountain01" | Station / PN name |
| D06 | D02 with CPU 1215C | CPU type record |
| D07 | D02 with FW V4.6 vs V4.5 | Firmware attribute |
| D08 / D09 / D10 | D02 + SM 1221 DI8 / SM 1222 DQ8 / SM 1231 AI4 (slot 2) | DI / DO / AI module records |
| D11 | D08+D09 in slots (2,3) and swapped (3,2) | Slot / order encoding |
| D12 | D02 + ET 200SP IM155-6 PN IO device | PROFINET device, GSDML reference |
| D13 | D02 + 1 Bool tag; + 10 mixed-type tags | Tag table |
| D14 | D02 + UDT_Pump (Bool, Int, Real, String) | UDT |
| D15 | D02 + DB_Std (non-optimized) and DB_Opt | DB layouts (CLASSIC vs NENA) |
| D16 | D02 + FB_Pump (SCL) + instance DB | FB + SCL source |
| D17 | D02 + FC_Scale (LAD) | FC + LAD XML |
| D18 | D02 + OB30 cyclic 100 ms | OB |
| D19 | D16+D17 called from OB1 | Call graph |
| D20 | D19 saved as `.zap18` and `.zapc18` | Archive variants |
| D21 | D19 opened/saved in V19; same content rebuilt in V17 | Version matrix |
| D22 | D19 exported: Openness XML (blocks, tags, UDT), SCL sources, CAx AML | Ground truth for E8 |
| D23 | D19 with one know-how-protected FB | Protection representation |
| D24 | S7-1512C-1 PN variant of D19 | Cross-check vs public `Conveyor belt_7` |

Store under `tests/fixtures/tia/<ID>/` (folder + `.zap`) with a `manifest.json` of expected values (device, IP, FW, modules, blocks).

---

## 12. AquaFlow Architecture Implications

```
TIA project folder / .zap / exports
        │
        ▼
[A] AquaFlow TIA Project Inspector (read-only)          ── CONFIRMED feasible (partial fidelity)
    ├─ .ap → version            ├─ .zap → unzip
    ├─ PLF → zlib carve → XML + string tables + TLV      ── hardware/network CONFIRMED (V18); rack/slot POSSIBLE
    ├─ Lucene index → object names/types/values          ── HIGH CONFIDENCE
    └─ SimaticML / SCL / AML export parser               ── CONFIRMED (documented; TIA needed to produce)
        │
        ▼
[B] Normalized Engineering Model (AquaFlow-owned schema) ── design work only
        ├─▶ [C] Hardware Model (CPU, FW, modules, order nos., IPs, PN names)  ── CONFIRMED from exports; PARTIAL from PLF
        ├─▶ [D] PLC Program Model (tags, UDTs, DBs, interfaces, call graph)   ── CONFIRMED from exports; V11 PLF yes; V14+ PLF POSSIBLE
        └─▶ [E] Network Model (subnets, IPs, PN names, IO devices)            ── CONFIRMED from AML; PARTIAL from PLF
        │
        ▼
[F] Compiler / Generator
    ├─ → SCL + SimaticML for Openness import                ── CONFIRMED (existing bridge; TIA required)
    ├─ → ST for SIMATIC AX (S7-1500 / 1200 G2 only)         ── HIGH CONFIDENCE (Siemens toolchain)
    └─ → native PLF                                         ── NOT CURRENTLY FEASIBLE
        │
        ▼
[G] Siemens Communication Layer
    ├─ DCP discovery / set IP + name                        ── CONFIRMED (no TIA)
    ├─ S7comm (Snap7): CPU/FW identify, DB I/O, run/stop    ── CONFIRMED (no TIA)
    ├─ S7CommPlus (TLS): symbolic browse / DB list / I/O    ── CONFIRMED via S7CommPlusDriver (no TIA; .NET)
    └─ block / HW download                                  ── TIA (Openness) or AX only
        │
        ▼
PLC (S7-1200 G1 for fountains; S7-1500 optional)
```

Consequences:
1. Keep the **Openness bridge** as the only *write* path for S7-1200 G1; SIMATIC AX helps only for S7-1500 / 1200 G2 (consistent with `SIEMENS-ZERO-TIA-ARCHITECTURE-DECISION.md`).
2. Add a **read-only inspector**: given a customer `.zap`/folder → TIA version, CPUs, order numbers, FW, IPs, PN names, module list, tag/block names. Achievable with stdlib Python (string tables + TLV) plus Lucene.NET for names. Value: site surveys, migration checks, "does this project match the discovered PLC" validation.
3. For **full fidelity** without TIA: (a) license jfk `TiaFileFormat`, or (b) run E1–E4 (~2 weeks) for an in-house hardware+tags parser. Program-logic reconstruction from V14+ PLF is research, not a feature.
4. Never depend on **PLF generation**. Offline project creation must emit SimaticML + SCL + CAx AML for TIA/Openness import.

---

## 13. Security & Legal Boundary (as applied)

- Only public GitHub files and open-source code were used; no PLC was contacted; nothing protected or licensed was decrypted or bypassed; jfk's closed binary was **not** executed or disassembled — only its MIT GUI source and README were read.
- Cloned third-party repos live in `tmp/tia-research/` (mixed licences: MIT, LGPL-3.0, GPL for DotNetSiemensPLCToolBoxLibrary). Do not commit or vendor them into AquaFlow without a licence review.
- Interoperability research on legitimately obtained files is generally lawful; get counsel before shipping a PLF reader commercially, and never ship anything that defeats know-how protection or access passwords.

---

## 14. Source Index

1. **Actual project files:** `sployal/TIA_portalV18_projects` (V18, S7-1512C-1 PN); `luismigueldurandiaz/modbus_1200_1200` (V11, S7-1214C).
2. **Actual source code read:** `jfk-solutions/TiaProjectBrowser` (`MainView.axaml.cs`, `StoreObjectView.axaml.cs`, `OnlineHelper.cs`, `IpSelector.axaml.cs`, `TreeItemNameConverter.cs`, `.csproj`); `dotnetprojects/DotNetSiemensPLCToolBoxLibrary` (`Step7ProjectV11.cs`, `Documentation/TIA CRC.txt`); `thomas-v2/S7CommPlusDriver` (`S7CommPlusConnection.cs`, `ClientApi/`, `Core/`); AquaFlow `tools/tia-openness-bridge/README.md`.
3. **Reproducible experiments:** `tmp/tia-research/{inspect,deep,carve,show,hunt,v11,aux}.py` with outputs `deep_out.txt`, `show_out.txt`, `hunt_out.txt`, `carve_out.txt`, `carve_v11_out.txt`, `v11_out.txt`; carved streams in `carved/`, `carved_v11/`.
4. **Technical write-ups:** NVISO Labs, "Investigating an engineering workstation – Part 3" (2022-04-20; V15.1 PLF diffing, DownloadLog); jfk-solutions `TiaFileFormat` README (format generations, dependencies, V10.5–V20 claim).
5. **Vendor documentation (background):** TIA Portal Openness manuals (SimaticML, CAx export), Siemens FAQs on `.zap` archiving / migration, SIMATIC AX product notes.
6. **Community:** r/PLC, PLCS.net, Siemens Industry Online Support forum recurring threads (classified in §6).

*End of dossier.*











# Fountain PLC Discovery, Retrofit, and Programming Research for AquaFlow

**Research date:** 2026-10-13
**Scope:** Discovering controllers and field devices in an existing operating fountain, recovering their control structure, mapping PLC I/O to physical equipment, and generating projects for new PLCs. The recommendations are deliberately focused on controller families and protocols already represented in AquaFlow.

## Executive conclusion

AquaFlow can become a practical fountain retrofit and commissioning tool, but “detect the PLC and all connected fountain devices” is not one technical operation. It is four linked problems:

1. **Network discovery** — find controllers, remote I/O, gateways, lighting nodes, and intelligent devices.
2. **Project recovery** — retrieve the PLC program and hardware configuration through the manufacturer's authorized engineering software when access permits it.
3. **Logical I/O reconstruction** — determine which PLC tags, module channels, registers, and lighting addresses represent pumps, valves, sensors, nozzles, and lights.
4. **Physical correlation** — prove which real device moves when a logical output changes.

The first two layers can often be highly automated. The third can be partially automated. The fourth cannot be inferred reliably from an Ethernet scan when equipment is connected through ordinary relay or analog wiring. AquaFlow should therefore build an **evidence-driven Fountain Discovery & Retrofit Wizard**, not a one-click “magic scanner.” It should combine passive discovery, authorized project import, read-only observation, operator annotation, and a tightly controlled one-channel-at-a-time commissioning procedure.

The strongest first implementation target is **Siemens S7-1200/S7-1500 with PROFINET**, followed by **Rockwell ControlLogix/CompactLogix over EtherNet/IP**, then profile-based **Modbus TCP**, **OPC UA**, and **Art-Net** discovery. This aligns with AquaFlow's current protocol code and with realistic engineering workflows.

## What AquaFlow already supports

The current codebase is not starting from zero. It already contains several useful, conservatively designed discovery paths.

| Family or protocol | Current AquaFlow capability | Present limitation |
|---|---|---|
| Siemens S7-1200/1500/300/400 | PROFINET DCP discovery, S7 identity/SZL checks, S7 runtime driver | Physical S7-1200 commissioning and TIA Openness generation still require real-hardware validation |
| Modbus TCP | FC 43/14 device identification, validated reads, selected writes, runtime driver | A device identity does not describe its vendor-specific register meanings |
| Allen-Bradley Logix/Micro800 | EtherNet/IP ListIdentity and a `pycomm3` runtime driver | No Studio 5000/L5X project generator or field commissioning proof yet |
| OPC UA | Runtime client support | Network discovery, trust onboarding, structured address-space import, and mapping workflow are incomplete |
| Art-Net and sACN | Lighting runtime support | ArtPoll/node inventory and physical DMX fixture correlation are not yet part of the discovery wizard |
| I-CAN fountain gateway | Safe identification probe and a proven site-specific path | It is not a universal PLC/device discovery protocol |
| Delta, Schneider, WAGO, Advantech, Moxa | Can be approached through explicit Modbus TCP profiles where the actual model supports Modbus | Native vendor project recovery/programming is not implemented |
| Mitsubishi, Omron, Beckhoff | Listed in the catalog | Native MELSEC, FINS, and ADS support is gated or unsupported |
| OASE WECS III, Safe-Rain DMX | Listed in the catalog | Proprietary integration is not verified; do not imply compatibility without vendor documentation and tests |

The existing discovery engine already uses an appropriate evidence progression:

`host_seen → port_open → protocol_confirmed → identity_confirmed → data_access_verified → configured → commissioned`

That progression should remain central. A device found on the network must never be displayed as “commissioned.”

## What can actually be detected

### 1. Siemens PROFINET and S7

PROFINET DCP is the most useful local discovery mechanism for a new or poorly documented Siemens installation. An Identify request can find devices on the selected Layer-2 network even when their IP address is unknown or on a different IP subnet. Depending on the response, AquaFlow can collect:

- MAC address and current IP parameters;
- PROFINET station name;
- vendor and device identifiers;
- device role and protocol evidence.

LLDP information from managed switches and PROFINET devices can then help reconstruct which device is connected to which switch port. The device's GSDML file describes its identity, modular structure, cyclic process data, parameters, and diagnostics. The GSDML describes the *type of device and its data layout*; it does not reveal which real fountain nozzle an installer wired to channel Q0.3.

A strict S7comm identity exchange can additionally reveal CPU family, order number, firmware, and station/module names when the controller permits access. The Siemens web server can provide identity, module, communication, and diagnostic information when it has been enabled and the user's access level permits it.

For recovery of an existing program, AquaFlow should hand off to **TIA Portal** rather than attempt to reverse engineer proprietary blocks. TIA Portal supports uploading an entire device as a new station or uploading software, subject to CPU access protection, project compatibility, know-how protection, and engineering credentials. It also supports online/offline comparison and diagnostics. Individual block upload can omit related tags or dependencies, so a whole-station upload or a matching offline project is preferable.

Useful official references: [PRONETA Basic documentation](https://cache.industry.siemens.com/dl/files/624/67460624/att_1347024/v1/PRONETA_Documentation_V3_9_en.pdf), [Siemens S7-1200 system manual](https://support.industry.siemens.com/cs/attachments/109977302/s71200_system_manual_en-US.pdf), [TIA Portal loading and upload overview](https://docs.tia.siemens.cloud/r/en-us/v20/editing-project-data/compiling-and-loading-project-data/loading-project-data/general-information-on-loading), and [uploading S7-1200/1500 blocks](https://docs.tia.siemens.cloud/r/en-us/v20/compiling-and-downloading-plc-programs/downloading-blocks-for-s7-1200/1500-s7-1200-s7-1500/uploading-blocks-from-device-s7-1200-s7-1500).

### 2. Allen-Bradley EtherNet/IP

EtherNet/IP ListIdentity is a safe, standard way to identify compatible devices. It can return:

- vendor ID and device type;
- product code, revision, and serial number;
- product name and status;
- network endpoint information.

For Logix controllers, an authenticated/authorized online session can browse tags and read values. That is valuable for passive correlation: AquaFlow can record which tags change while an existing show plays. It still cannot know that `Local:3:O.Data.7` operates “north ring nozzle 12” unless the project naming, electrical documentation, feedback, or a physical test establishes that fact.

Studio 5000 can upload a controller project, and Logix controllers retain tag names. However, some offline documentation and project metadata may not be stored in the controller. A matching original project remains the best source. AquaFlow should import an exported L5X/CSV artifact after the authorized upload instead of implementing a proprietary upload client.

Useful official references: [Studio 5000 upload from controller](https://www.rockwellautomation.com/en-us/docs/studio-5000-logix-designer/37-02/studio5000mainenu-ditamap/what-is-st5k-/upload-from-ctrler-terminal-dialog.html), [what an upload contains](https://www.rockwellautomation.com/en-cz/docs/studio-5000-logix-designer/38-03/contents-ditamap/studio-5000-logix-designer/about-the-controller-project-status-tray/about-upload.html), and [Logix tag information](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm094_-en-p.pdf).

### 3. Modbus TCP devices

Modbus Read Device Identification, function 43/14, can provide mandatory objects such as `VendorName`, `ProductCode`, and `MajorMinorRevision`, plus optional vendor objects. This is enough to identify many VFDs, remote-I/O couplers, meters, and gateways without writing to them.

Modbus itself does **not** standardize what arbitrary coils and registers mean. The same address may be a pump start command on one device and a configuration parameter on another. Safe integration therefore requires a versioned **device profile** based on the exact manufacturer manual, including:

- model and supported firmware range;
- unit ID behavior;
- function code, address base, width, byte/word order, type, scale, and unit;
- read/write permissions and safe value range;
- polling rate and timeout;
- interlocks and commissioning procedure.

AquaFlow must not probe broad register ranges or issue test writes to an unknown Modbus device. The authoritative protocol reference is the [Modbus Application Protocol specification](https://modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf).

### 4. OPC UA

OPC UA can provide the richest vendor-neutral logical model when a fountain controller exposes a well-designed server. AquaFlow can use `FindServers` and `GetEndpoints`, then establish a trusted secure session and browse nodes, data types, engineering units, alarms, and relationships.

Discovery is not guaranteed: local discovery, multicast discovery, or the server itself may be disabled, segmented by a router, or blocked by a firewall. AquaFlow therefore needs both automatic discovery and manual endpoint entry. Discovery responses do not eliminate certificate validation or authentication requirements.

Official references: [OPC UA Discovery model](https://reference.opcfoundation.org/specs/OPC-10000-12/4), [discovery concepts](https://reference.opcfoundation.org/specs/OPC-10000-12/5), [FindServers and GetEndpoints services](https://reference.opcfoundation.org/specs/OPC-10000-4/5.5), and [OPC UA security model](https://reference.opcfoundation.org/specs/OPC-10000-2/full).

### 5. Art-Net, sACN, DMX, and RDM

ArtPoll can locate Art-Net nodes and ArtPollReply can expose node identity, capabilities, ports, and addressing. This discovers the Ethernet-to-DMX node, not every conventional DMX fixture connected downstream. RDM-capable fixtures can expose device identity and parameters when the whole path supports RDM; otherwise the patch sheet, fixture labels, and observed tests remain necessary.

sACN universe traffic can be passively observed to learn active universes, source names, priorities, and channel changes. Passive traffic does not establish the fixture type or physical location.

Official reference: [Art-Net 4 protocol](https://art-net.org.uk/downloads/art-net.pdf).

### 6. IO-Link and intelligent field devices

IO-Link is especially useful for future fountains because each compatible sensor or actuator can expose vendor, device, and serial identity together with structured process data, parameters, and diagnostics. The IODD provides the machine-readable device description. If an IO-Link master is connected over PROFINET, EtherNet/IP, Modbus TCP, or OPC UA, AquaFlow can inventory devices below the PLC much more accurately than it can inventory plain wired outputs.

Official references: [IO-Link IODD description](https://io-link.com/technology/iodd) and [IO-Link downloads](https://io-link.com/downloads).

## The important limit: a PLC cannot describe undocumented field wiring

The following information cannot normally be obtained from network discovery alone:

- which physical valve or nozzle is wired to a bare digital output;
- the meaning of an undocumented Modbus register;
- passwords, protected source logic, or know-how-protected blocks;
- whether a commanded actuator actually moved when no feedback sensor exists;
- non-networked devices located behind relays, contactors, analog isolators, or VFD terminals;
- hydraulic relationships such as which pump supplies which manifold unless the project, drawings, or a test establishes them.

AquaFlow should represent uncertainty explicitly rather than guess. For example:

| Evidence | Example confidence state |
|---|---|
| EtherNet/IP response says a device is a CompactLogix | **Identified** |
| Imported project maps `Pump_01_Run` to output module channel 2 | **Configured** |
| That tag changes whenever the east jet group operates | **Observed** |
| An attended isolated test proves channel 2 starts pump 01 and feedback agrees | **Physically verified** |
| All interlocks, limits, and failure cases have passed the signed test plan | **Commissioned** |

## Proposed AquaFlow Fountain Discovery & Retrofit Wizard

### Phase A — prepare a read-only discovery session

The operator selects a network adapter and explicitly defines the permitted subnet/site. AquaFlow records the operator, time, adapter, local addresses, and scan policy. The initial policy permits only identity and read operations. No PLC mode change, download, register write, DCP rename, or IP assignment is permitted.

Before discovery, the application should warn that production fountains contain motors, high-pressure water, submerged electrical equipment, and public-space hazards. Network discovery can be done while running only if the site operator approves it; physical-output tests require a controlled maintenance state.

### Phase B — build the network inventory

Run protocols in a bounded order:

1. PROFINET DCP Identify on the selected adapter.
2. EtherNet/IP ListIdentity.
3. ArtPoll and passive sACN source observation.
4. Targeted S7 identity, Modbus 43/14, OPC UA endpoint discovery, and I-CAN identification only against discovered or operator-selected addresses.
5. Optional read-only LLDP/SNMP topology collection from explicitly authorized switches.

Merge responses by strong identifiers such as MAC address, PLC serial number, PROFINET station identity, or EtherNet/IP serial number. An IP address alone is not a durable device identity.

### Phase C — recover and import engineering evidence

AquaFlow should guide the operator through the manufacturer-supported workflow:

- **Siemens:** use TIA Portal to upload the device as a new station or open the original project; compare online/offline; export hardware, tags, blocks, and relevant XML/CSV artifacts.
- **Rockwell:** use Studio 5000 to upload or open the matching ACD project; export controller/program tags, modules, routines/AOIs as L5X or CSV where supported.
- **Modbus:** select an AquaFlow device profile matching exact model and firmware, and attach the manufacturer's register manual.
- **OPC UA:** save endpoint, application URI, server certificate fingerprint, namespace metadata, and a browsed node snapshot.
- **Lighting:** import universe/channel patch sheets and node configuration exports.

Imported artifacts must be hashed, timestamped, marked with tool/version, and preserved as read-only evidence. Importing an online project must create an `ObservedSite`; it must never immediately overwrite the active AquaFlow engineering model.

### Phase D — construct the logical map

Create an evidence graph rather than one flat device list:

```text
Controller
  └─ rack / bus / remote station
      └─ module
          └─ channel, tag, register, or DMX slot
              └─ terminal / cable / circuit (when known)
                  └─ physical pump, VFD, valve, sensor, nozzle, or light
```

Every edge carries source, timestamp, confidence, and reviewer. Examples are “from TIA hardware export,” “from electrical drawing E-17,” “inferred from correlated runtime changes,” or “verified by attended pulse test.” Conflicting assertions are shown as a conflict, not silently merged.

### Phase E — passive correlation while the existing show runs

This is the safest way to learn an unfamiliar fountain:

1. Read a selected, rate-limited set of tags/registers or observe lighting traffic.
2. Record timestamped value changes.
3. Let an operator mark visible events such as “center jet rose,” “pump 2 started,” or “west RGB group turned blue.”
4. Correlate repeated transitions and score candidates.
5. Present suggestions for confirmation; never convert correlation into a verified mapping automatically.

A future computer-vision assistant could correlate video motion and color changes with PLC/DMX events, but it should remain supporting evidence. Reflections, pump delays, shared manifolds, wind, and overlapping effects make video-only identification unreliable.

### Phase F — controlled physical identification

Only after the operator explicitly enters commissioning mode should AquaFlow allow channel tests. The workflow should require:

- authorized person and site permit;
- confirmed emergency stop and safe public exclusion zone;
- pumps/VFDs in a known permitted state;
- pressure, level, thermal, dry-run, and motor interlocks retained in the PLC;
- selection of exactly one bounded test action;
- maximum pulse duration and safe analog limit;
- operator observation and a separate confirmation step;
- automatic return to safe state on timeout, disconnect, watchdog failure, or application exit;
- immutable audit record.

For a valve, the test may be a short output pulse with the supply pump disabled, followed later by a hydraulically supervised test. For a VFD or pump, a generic “toggle output” is unacceptable; the test must use a vendor/site-specific commissioning recipe and retain all hardwired and PLC interlocks.

## Programming a new PLC from AquaFlow

### Recommended architecture

AquaFlow should be the design and generation layer, while the manufacturer's engineering environment remains the compiler, hardware catalog, downloader, and final online commissioning authority.

```text
AquaFlow fountain design
        ↓
Validated control model and I/O schedule
        ↓
Vendor generator
  ├─ Siemens: SCL/DB/tag tables + TIA Openness project automation
  ├─ Rockwell: L5X tags/AOIs/routines for Studio 5000
  └─ Modbus device profiles and gateway configuration packages
        ↓
Vendor compiler and engineering review
        ↓
Download in STOP / Program mode
        ↓
Attended I/O and hydraulic commissioning
        ↓
AquaFlow runtime contract enabled
```

### Siemens first: S7-1200/S7-1500

This should be the first supported project generator because AquaFlow already has DCP/S7 foundations and a documented Siemens runtime contract.

1. The designer selects the exact CPU, firmware/catalog version, signal modules, remote I/O, VFDs, network names, and addressing.
2. AquaFlow validates channel counts, electrical signal types, scan timing, and safety ownership.
3. It generates:
   - data blocks and stable command/feedback structures;
   - SCL function blocks for pumps, valves, proportional jets, sensors, alarms, watchdogs, and show-command arbitration;
   - symbolic tag tables and an I/O schedule;
   - a cyclic organization-block call structure;
   - a human-readable cause/effect and interlock report.
4. A TIA Portal Openness adapter creates or updates a project using exact catalog identifiers, imports source, connects blocks, and compiles hardware and software.
5. AquaFlow captures compiler messages and blocks release on errors. Warnings require review.
6. A qualified engineer reviews the project and downloads it with the CPU in a safe state. Initial automation should leave the CPU in STOP rather than starting an unknown installation automatically.
7. Commissioning proves inputs, outputs, feedback, safe states, watchdog behavior, communication loss, and emergency behavior before shows can be armed.

TIA Openness officially exposes project compilation and import/export functions: [compiling a project](https://docs.tia.siemens.cloud/r/en-us/v20/tia-portal-openness-api-for-automation-of-engineering-workflows/tia-portal-openness-api/functions-for-projects-and-project-data/compiling-a-project) and [import/export principles](https://docs.tia.siemens.cloud/r/en-us/v20/tia-portal-openness-api-for-automation-of-engineering-workflows/export/import/overview/basic-principles-of-importing/exporting).

The current AquaFlow Siemens architecture is conceptually correct, but it must not be marketed as production-ready until the generated project has been compiled with an installed supported TIA version and commissioned against the target S7-1200/S7-1500 hardware.

### Allen-Bradley second

Create a separate Rockwell generator that emits reviewable L5X content rather than treating the runtime driver as a project programmer. The generated package should include:

- controller/program tags and user-defined types;
- Add-On Instructions or routines for standard fountain device types;
- I/O aliases and rack/module/channel schedule;
- produced/consumed or message definitions only when explicitly designed;
- controller watchdog and command acknowledgement contract;
- import and commissioning report.

Studio 5000 remains responsible for catalog validation, compilation, download, controller-mode handling, and online verification. Rockwell documents that downloading requires the appropriate Program/Remote Program state: [Studio 5000 download workflow](https://www.rockwellautomation.com/en-gb/docs/studio-5000-logix-designer/38-03/contents-ditamap/quick-start-steps/download.html).

### Modbus devices and small PLCs

There is no universal “Modbus program.” AquaFlow should support these devices through vendor/model profiles and, where useful, vendor-specific exporters. For a Modbus remote-I/O block or VFD, AquaFlow can generate:

- register/coil map and typed runtime contract;
- scaling and byte-order rules;
- commissioning test sheet;
- polling groups and timeout/retry policy;
- read/write allowlist;
- safe limits and alarm behavior.

Programming a Schneider M221, Delta DVP, or WAGO controller requires a distinct generator and the vendor's engineering tool. These should be added only when a real customer target and hardware test bench justify them.

## Proposed internal data model

```text
DiscoverySession
  id, site, adapter, allowed_scope, mode, operator, timestamps

ControllerIdentity
  stable_id, vendor, family, model, firmware, serial, mac, addresses

DiscoveryEvidence
  protocol, raw_fingerprint, source, timestamp, parser_version, confidence

NetworkNode / NetworkPort / NetworkEdge
  device relationships, switch port, LLDP source, VLAN/subnet

IOEndpoint
  controller, station, module, channel, tag/register/node/slot,
  signal_type, direction, engineering_type, writable, safe_range

PhysicalDevice
  kind, site_location, hydraulic_group, electrical_circuit, capabilities

MappingAssertion
  io_endpoint → physical_device, evidence_source, confidence,
  status, reviewer, timestamp, conflict_state

ProjectArtifact
  vendor, engineering_tool, version, file_hash, import_parser,
  protection/compatibility notes, provenance

CommissioningObservation
  requested_action, bounded_value, duration, feedback, operator_result,
  interlock_state, audit_timestamp
```

The generated/active engineering model and the observed/live model must remain separate until a human accepts a diff.

## Security and safety boundaries

- Never attempt to bypass PLC passwords, source protection, certificates, access levels, or safety signatures.
- Never broadcast write requests during discovery.
- Never scan arbitrary Modbus registers merely to “see what happens.”
- Never infer that TCP port 102, 44818, 502, or 4840 alone proves a PLC protocol.
- Never download to an existing controller automatically after discovery or import.
- Never replace or weaken hardwired safety functions, safety PLC logic, overloads, pressure relief, dry-run protection, or emergency stops.
- Bind every active operation to an explicit device identity, site, session, operator, scope, and timeout.
- Use certificate trust and least-privilege credentials for OPC UA.
- Store credentials using the operating system credential vault, not in AquaFlow project files.
- Treat vendor project files as sensitive operational technology data.
- Separate office/cloud connectivity from the control network; remote access should pass through an approved industrial security architecture.

## Implementation roadmap

### Release 1 — trustworthy inventory

1. **AF-PLC-DISC-001: Discovery session persistence**
   Save scan scope, adapter, raw evidence, parser version, and identity confidence. Acceptance: reopening a session reproduces the same inventory without treating it as commissioned.

2. **AF-PLC-DISC-002: Normalize existing discovery results**
   Merge DCP, S7, Modbus, EtherNet/IP, and I-CAN evidence into stable controller identities. Correct stale source comments that still describe Allen-Bradley as identify-only now that a runtime driver exists.

3. **AF-PLC-DISC-003: Art-Net and OPC UA discovery**
   Add ArtPoll/Reply inventory and OPC UA FindServers/GetEndpoints with manual endpoint fallback. No automatic trust of server certificates.

4. **AF-PLC-DISC-004: Network topology graph**
   Add authorized LLDP/SNMP observations and display switch/port/device relationships with provenance.

### Release 2 — understand the existing project

5. **AF-PLC-IMPORT-001: Siemens evidence importer**
   Import exported TIA hardware/tag artifacts and map rack/module/channel/tag relationships. Include version/protection warnings and file hashes.

6. **AF-PLC-IMPORT-002: Rockwell L5X/CSV importer**
   Import modules, tags, aliases, routines/AOI references, and I/O relationships without pretending an incomplete export is a complete controller project.

7. **AF-PLC-IMPORT-003: Versioned Modbus profile registry**
   Profiles require exact models, firmware ranges, primary manual references, typed points, safe ranges, and tests.

8. **AF-PLC-MAP-001: Evidence graph and diff UI**
   Show controller → module → endpoint → physical-device mapping, sources, confidence, conflicts, and proposed changes before merging into the engineering model.

### Release 3 — observe and verify

9. **AF-PLC-OBS-001: Read-only tag and point browser**
   Siemens/project-derived points, Logix tags, OPC UA nodes, and profile-approved Modbus points. Enforce bounded rates and point counts.

10. **AF-PLC-OBS-002: Timeline correlation recorder**
    Record point changes alongside AquaFlow timeline timecode and operator annotations. Produce ranked mapping candidates without automatic verification.

11. **AF-PLC-COMM-001: Controlled channel identification**
    Add explicit maintenance state, permit checklist, one-action selection, duration/amplitude limits, feedback capture, watchdog, audit, and forced safe return.

12. **AF-PLC-COMM-002: Commissioning report**
    Generate signed I/O, feedback, interlock, communication-loss, and safe-state evidence for each mapped fountain device.

### Release 4 — generate new PLC projects

13. **AF-PLC-GEN-001: Vendor-neutral control model**
    Define pumps, VFDs, valves, proportional jets, sensors, RGB/RGBW fixtures, interlocks, groups, timing requirements, command ownership, and feedback.

14. **AF-PLC-GEN-002: Siemens TIA Openness generator**
    Generate project/source/tags/hardware, compile, collect diagnostics, and produce a review package. Download and RUN transition remain explicit supervised actions.

15. **AF-PLC-GEN-003: Physical Siemens validation**
    Test supported TIA versions and selected S7-1200/1500 CPU/module combinations on a bench, including power loss, cable loss, stale heartbeat, invalid commands, and retentive-value behavior.

16. **AF-PLC-GEN-004: Rockwell L5X generator**
    Begin only after the vendor-neutral model and Siemens safety/commissioning model are stable.

17. **AF-PLC-IOLINK-001: IO-Link inventory adapter**
    Import master/port/device/IODD information through selected masters to improve downstream physical-device identity in future installations.

## Recommended first product slice

The smallest useful, safe release is not PLC auto-programming. It is:

1. discover Siemens, EtherNet/IP, Modbus, OPC UA, Art-Net, and I-CAN endpoints;
2. preserve raw identity evidence;
3. import TIA tag/hardware exports and Rockwell L5X/CSV;
4. display a controller/module/channel/tag graph;
5. record selected values against the AquaFlow show timeline;
6. let the operator assign likely fountain devices with a confidence level;
7. export an I/O verification sheet.

This creates immediate value for retrofit work without placing the fountain at risk. Controlled output testing and automatic project generation should follow only after this read-only workflow is reliable.

## Final recommendation

AquaFlow should position the feature as **discover, recover, correlate, verify, then generate**:

- **Discover** network-capable controllers and devices with standard read-only protocols.
- **Recover** existing engineering data through TIA Portal, Studio 5000, profiles, and project exports.
- **Correlate** live read-only changes with the existing fountain's visible behavior and timeline.
- **Verify** ambiguous wiring through an attended, bounded commissioning procedure.
- **Generate** new PLC projects using vendor-specific toolchains, with human review and physical validation.

That model is technically achievable, honest about uncertainty, and much safer than promising automatic detection of undocumented hardwired equipment. It also gives AquaFlow a meaningful advantage: the same evidence graph can connect CAD/design objects, the show timeline, PLC code, controller addresses, and the real commissioned fountain.

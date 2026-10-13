// articles.js — AquaFlow Documentation Center content (AQ-S4-006)
//
// The documentation is bundled with the app (no network required) so the help center
// works fully offline. Each article has a category, search tags, and `context` keys
// that map it to the UI panel it explains (for context-sensitive help).

function a(id, title, category, tags, context, body) {
  return { id, title, category, tags, context, body };
}

export const ARTICLES = [
  a("getting-started", "Getting Started", "Basics",
    ["intro", "overview", "start", "workspace"], ["nodes", "preview"],
    "AquaFlow Studio lets you design, program and run water-fountain shows. The workspace " +
    "has a node editor, a 3D preview, a timeline, and side panels grouped in the top bar " +
    "under Design, Devices, Runtime and AI. Start by designing a pool and placing fixtures, " +
    "then program a show on the timeline and preview it in 3D."),
  a("fixtures", "Fixtures & Devices", "Design",
    ["fixture", "device", "jet", "nozzle", "light", "pump", "valve", "address"], ["nodes", "devices", "dependencies"],
    "Fixtures are the physical devices in a design: water jets, RGB lights, pumps and valves. " +
    "Each fixture has a type, a position, and engineering metadata — a DMX address for lighting/" +
    "fog/laser, or a PLC/Modbus register for jets/pumps/valves — which is how a designed show " +
    "reaches real hardware. Use auto DMX assignment to avoid address conflicts."),
  a("timeline", "The Timeline", "Design",
    ["timeline", "track", "clip", "playback", "playhead"], ["nodes", "show_programmer"],
    "The timeline is the show's time axis. Tracks hold clips; a clip drives a device between a " +
    "start and end time at a given intensity. During playback a playhead advances and evaluates " +
    "the active clips, emitting them to the output path."),
  a("cue-stacks", "Cue Stacks & Scene Recall", "Programming",
    ["cue", "scene", "recall", "crossfade", "go"], ["show_programmer"],
    "A cue stack is an ordered list of scenes (looks) you GO through with smooth crossfades. " +
    "Recalling a cue fades the output to that scene over its fade time. Multiple cue stacks can " +
    "run independently."),
  a("dmx-artnet", "DMX & Art-Net Output", "Hardware",
    ["dmx", "artnet", "sacn", "universe", "channel", "output", "hardware"], ["devices", "plc"],
    "DMX512 carries 512 channels per universe; Art-Net and sACN tunnel DMX over the network. " +
    "Output must not exceed 44 Hz per universe (the DMX512 physical frame floor is ~22.7 ms). " +
    "The hardware verification tool confirms the exact bytes leaving the socket against a " +
    "simulated node."),
  a("safety", "Safety System", "Hardware",
    ["safety", "estop", "permit", "interlock", "gate"], ["safety", "operator"],
    "Every hardware emit passes the output-path safety gate: without a master permit ALL channels " +
    "are forced to zero, and an emergency stop hard-inhibits output immediately. The safety kernel " +
    "runs a 50 Hz interlock state machine (E-stop, water level, pressure, thermal, flame/laser " +
    "permits) that the show engine checks before every frame."),
  a("hydraulics", "Hydraulic Design", "Engineering",
    ["hydraulic", "pipe", "flow", "pressure", "hazen", "darcy", "solver"], ["engtools"],
    "The hydraulic solver computes flow and pressure at every node of a pipe network using real " +
    "Hazen-Williams / Darcy-Weisbach head-loss formulas (the Global Gradient Algorithm). Pair it " +
    "with pipe sizing to check velocities and suggest standard diameters."),
  a("pumps", "Pump Curves", "Engineering",
    ["pump", "curve", "operating point", "affinity", "head"], ["engtools"],
    "A pump's operating point is where its head–flow (H–Q) curve meets the system curve " +
    "(H = static + k·Q²). Pumps in parallel add flow at equal head; in series they add head at " +
    "equal flow. Variable speed follows the affinity laws (Q∝N, H∝N²)."),
  a("valves", "Valve Authority", "Engineering",
    ["valve", "authority", "kv", "flow control"], ["engtools"],
    "Valve authority β = ΔP_valve / (ΔP_valve + ΔP_rest) at design flow. Good modulating control " +
    "needs β ≥ 0.5; a low-authority (oversized) valve acts nearly on/off. Reduce Kv to raise " +
    "authority."),
  a("wind-drift", "Wind Drift Safety", "Safety",
    ["wind", "drift", "spray", "keep-clear", "outdoor"], ["wind"],
    "For outdoor fountains, wind carries the spray downwind. The wind-drift engine computes how far " +
    "each jet's spray drifts from live weather, updates the keep-clear/exclusion zone in real time, " +
    "and raises operator warnings when the drift breaches the keep-clear perimeter or a barrier."),
  a("validation", "Live Validation", "Runtime",
    ["validation", "errors", "conflicts", "real-time"], ["validation"],
    "The live validation panel re-checks the design on every change — duplicate/invalid addresses, " +
    "dependency conflicts, out-of-range values and safety issues — and highlights each error against " +
    "the offending fixture, within a 100 ms latency budget."),
  a("dependencies", "Equipment Dependencies", "Design",
    ["dependency", "graph", "controller", "spof", "conflict"], ["dependencies"],
    "The dependency graph shows fixtures, their control groups, and controllers (PLC hosts / DMX " +
    "universes), flagging duplicate addresses, circular dependencies, single points of failure and " +
    "orphaned equipment."),
  a("beat-detection", "Beat Detection", "Programming",
    ["beat", "bpm", "tempo", "music", "sync"], ["ai", "audio"],
    "The beat detection engine estimates BPM and beat times from audio — recorded or live — so a " +
    "show can be synchronised to music. Live detection runs under a 50 ms latency budget."),
  a("licensing", "Licensing & Activation", "Account",
    ["license", "activation", "seat", "transfer", "portal"], [],
    "Activate the app online to bind a machine to a license seat; the portal supports transferring " +
    "an activation between machines and managing seats. A license is bound to the machine's hardware " +
    "fingerprint and validated on start-up (with a grace period)."),
  a("training", "Training Academy", "Account",
    ["training", "academy", "lesson", "certificate", "learn"], ["academy"],
    "The Training Academy has interactive courses with quizzes. Complete every lesson above the " +
    "course pass threshold to earn a verifiable certificate. Your progress is tracked per course."),
  a("engineering-package", "Engineering Package Export", "Engineering",
    ["export", "package", "pdf", "dxf", "bom", "cad"], ["engtools"],
    "Export a full engineering package as one ZIP: a cover PDF, the CAD layout (DXF), the Bill of " +
    "Materials (XLSX), the P&ID drawing (SVG), and the dependency/hydraulics JSON — each verified by " +
    "a manifest with checksums."),
  // AF-NEXT-014: linked from the Commission / Operate workspace guidance.
  a("safe-commissioning", "Safe Commissioning Procedure", "Hardware",
    ["commissioning", "plcsim", "sign-off", "procedure", "checklist", "interlock"], ["plc", "devices", "fountain", "operator"],
    "AquaFlow never arms, starts or pulses physical equipment from its guidance, checklists or " +
    "diagnostics — those only open the responsible screen. The safe order is: (1) design and program " +
    "the show, then run Preflight with zero errors; (2) create the Siemens site from the design and " +
    "prove the program on the PLCSIM test PLC (Siemens Setup → Connect: 'Test PLC: PLCSIM on this PC', " +
    "then Verify and Test there) — test fixtures and any software or PLCSIM result are NOT evidence " +
    "that an installation is commissioned; (3) on site, the approved commissioning engineer follows " +
    "HARDWARE_COMMISSIONING_CHECKLIST.md in the AquaFlow repository: pre-flight with the hardware " +
    "E-stop tested cold, the simulated host output self-test, real per-protocol transmission, the " +
    "per-fixture address and channel map, safety verification on real hardware (all must pass), " +
    "output timing on the wire and a full-show dress run; (4) the results are recorded in " +
    "AF-HUB-011_COMMISSIONING_RECORD.md and signed off. Only then is the hardware-commissioned flag " +
    "set; until it is, every screen shows 'simulated output only'. Follow site lockout/tagout and PPE " +
    "rules, keep an E-stop within reach and do not continue past any failed check."),
];

export const CATEGORIES = [...new Set(ARTICLES.map((x) => x.category))];

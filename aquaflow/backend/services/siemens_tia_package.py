"""Generate reviewable TIA sources for the AquaFlow Siemens runtime contract."""
import csv
import io
import json
import re
import zipfile

from engine.siemens_contract import (
    APPLIED_AT_OFFSET, BUFFER_CAPACITY, BUFFER_CAPACITY_OFFSET, BUFFER_READ_OFFSET,
    BUFFER_STATUS_OFFSET, BUFFER_WRITE_OFFSET, COMMAND_SIZE, CONTRACT_VERSION, CYCLE_MS, DB_SIZE,
    FEEDBACK_SIZE, HEADER_SIZE, LAST_LATE_OFFSET, LEGACY_CONTRACT_VERSION,
    LIGHT_ACTIVE_OFFSET, LIGHT_CAPACITY, LIGHT_COMMAND_OFFSET, LIGHT_FEEDBACK_OFFSET,
    MAGIC, PROGRAM_VERSION, PUMP_CAPACITY, PUMP_COMMAND_OFFSET, PUMP_FAULT_OFFSET,
    PUMP_FEEDBACK_OFFSET, PUMP_MODE_OFFSET, PUMP_RUNNING_OFFSET, RING_OFFSET, SHOW_CLOCK_OFFSET,
    SLOT_SIZE, STREAM_KEEPALIVE_OFFSET, UNDERRUN_LIMIT_MS, VALID_UNTIL_OFFSET, VALVE_CAPACITY,
    VALVE_COMMAND_OFFSET, VALVE_FEEDBACK_OFFSET, WATCHDOG_MS, WORST_LATE_OFFSET,
)
from engine.siemens_site import CONTRACT, signature
from services.siemens_readiness import commissioning_readiness, unsupported_input_bindings


CYCLIC_OB_REQUIREMENT = {
    "name": "AquaFlowCycle", "event": "CyclicInterrupt", "minimum_ob_number": 200,
    "cycle_us": CYCLE_MS * 1000, "phase_us": 0, "language": "SCL",
    "required_instance_call": "AquaFlowSiteControlInstance", "automatic_generation": True,
    "generation_method": (
        "Generate SCL through the selected TIA release, export that OB as version-native "
        "SimaticML, set Number and SecondaryType, reimport through Openness, then read back "
        "and verify the CPU-specific event and timing before compilation."
    ),
}


def _bit_set_scl(array: str, index: int, condition: str) -> str:
    byte, mask = index // 8, 1 << (index % 8)
    return (f"   IF {condition} THEN {array}[{byte}] := {array}[{byte}] OR B#16#{mask:02X}; END_IF;")


def site_sync_text(sync):
    """Plain-language Site sync sheet for site staff (sound ↔ fountain timing)."""
    if not sync.get("enabled"):
        return ("AquaFlow Site sync was OFF when this show was compiled.\n"
                "Cue times in ShowTimeline.csv are exactly as programmed. Start the music together with the PLC show.\n")
    lines = [
        "AquaFlow Site sync — sound and fountain timing",
        "",
        f"START THE MUSIC {sync['audioStartMs']:.0f} ms AFTER THE PLC SHOW STARTS.",
        "",
        "The cue times in ShowTimeline.csv / AquaFlowShow.json already fire every output early by its own",
        "delay (PLC frame and cycle, network, valve or VFD, water rise, DMX) minus the music's delay to the",
        "audience (player, processor, amplifier and the sound's travel through the air).",
        f"Recommended music start: {sync['recommendedAudioStartMs']:.0f} ms.",
    ]
    if sync.get("byKind"):
        lines += ["", "Shift applied per output (negative = earlier than programmed):"]
        for kind, row in sync["byKind"].items():
            lines.append(f"  {kind:<8} {row['clips']:>6} cues  {row['minShiftMs']:+.0f} … {row['maxShiftMs']:+.0f} ms")
    if sync.get("trimmed") or sync.get("dropped"):
        lines += ["", f"{sync.get('trimmed', 0)} cue(s) were shortened and {sync.get('dropped', 0)} dropped because they would have had to start before the show."]
    lines += ["", "On site: run the Sync test (Show Studio → Site sync) from the audience position and save the",
              "measured correction before the first public show. Recompile and export this package again afterwards."]
    return "\n".join(lines) + "\n"


def build_tia_package(site):
    issues = unsupported_input_bindings(site)
    if issues:
        raise ValueError(" ".join(issues))
    stamp = signature(site)
    db = f'''DATA_BLOCK "AquaFlowSiteIO"
{{ S7_Optimized_Access := 'FALSE' }}
VERSION : 3.0
   STRUCT
      Magic : Word := W#16#{MAGIC:04X}; // byte 0, PLC-owned
      ContractVersion : UInt := {CONTRACT_VERSION}; // byte 2
      HeaderSize : UInt := {HEADER_SIZE}; // byte 4
      Status : Word; // byte 6
      SiteSignature : DWord := DW#16#{stamp:08X}; // byte 8
      ProgramVersion : DWord := DW#16#{PROGRAM_VERSION:08X}; // byte 12
      PlcHeartbeat : UInt; // byte 16
      AquaFlowHeartbeat : UInt; // byte 18, PC-owned
      Permit : Word; // byte 20
      FaultCode : UInt; // byte 22
      AckSequence : UInt; // byte 24
      CommandSequence : UInt; // byte 26, PC commits last
      CommandFlags : Word; // byte 28, RUN=bit0 RESET=bit1 STAGING=bit15
      RejectedReason : UInt; // byte 30
      FeedbackSequence : UInt; // byte 32
      CycleMs : UInt := {CYCLE_MS}; // byte 34, fast cyclic OB period
      PumpCapacity : UInt := {PUMP_CAPACITY}; // byte 36
      ValveCapacity : UInt := {VALVE_CAPACITY}; // byte 38
      LightCapacity : UInt := {LIGHT_CAPACITY}; // byte 40
      LastLateMs : UInt; // byte {LAST_LATE_OFFSET}, PLC-owned: ms between a bank's AtMs and its application
      LastCommandAgeMs : UDInt; // byte 44
      ShowClockMs : UDInt; // byte {SHOW_CLOCK_OFFSET}, PLC show clock: ms since the buffered RUN was accepted
      BufferReadIndex : UInt; // byte {BUFFER_READ_OFFSET}, PLC-owned ring read counter
      BufferCapacity : UInt := {BUFFER_CAPACITY}; // byte {BUFFER_CAPACITY_OFFSET}
      WorstLateMs : UInt; // byte {WORST_LATE_OFFSET}, since RUN
      BufferStatus : Word; // byte {BUFFER_STATUS_OFFSET}, bit0 buffered RUN, bit1 underrun hold, bit2 late bank
      AppliedAtMs : UDInt; // byte {APPLIED_AT_OFFSET}, AtMs of the last applied bank
      PumpSpeed : Array[0..15] of UInt; // bytes 64..95, PC-owned
      PumpMode : Array[0..15] of Byte; // bytes 96..111, 0=off 1=automatic
      ValveBits : Array[0..63] of Byte; // bytes 112..175
      LightRGB : Array[0..95] of Byte; // bytes 176..271
      PumpApplied : Array[0..15] of UInt; // bytes 272..303, PLC-owned
      PumpRunningBits : Array[0..1] of Byte; // bytes 304..305
      PumpFaultBits : Array[0..1] of Byte; // bytes 306..307
      ValveFeedbackBits : Array[0..63] of Byte; // bytes 308..371
      LightAppliedRGB : Array[0..95] of Byte; // bytes 372..467
      LightActiveBits : Array[0..3] of Byte; // bytes 468..471
      BufferWriteIndex : UInt; // byte {BUFFER_WRITE_OFFSET}, PC-owned: commits ring slots
      StreamKeepalive : UInt; // byte {STREAM_KEEPALIVE_OFFSET}, PC-owned: changes on every refill
      ValidUntilMs : UDInt; // byte {VALID_UNTIL_OFFSET}, PC-owned: the ring holds every bank up to this show time
      ReservedStream : Array[0..7] of Byte; // bytes 480..487
      Ring : Array[0..{BUFFER_CAPACITY - 1}] of Struct // bytes {RING_OFFSET}..{DB_SIZE - 1}, {SLOT_SIZE} bytes per slot, PC-owned
         AtMs : UDInt; // show time to apply this bank
         PumpSpeed : Array[0..15] of UInt;
         PumpMode : Array[0..15] of Byte;
         ValveBits : Array[0..63] of Byte;
         LightRGB : Array[0..95] of Byte;
      END_STRUCT;
   END_STRUCT;
BEGIN
END_DATA_BLOCK
'''

    outlet_logic, output_logic, feedback_logic, light_logic = [], [], [], []
    mapped_valves = {c["index"] for c in site["channels"] if c["kind"] == "valve" and c.get("output")}
    for channel in site["channels"]:
        index = channel["index"]
        if channel["kind"] == "valve":
            # Minimum on/off times in ms: the age counts CycleMs per fast-OB execution.
            on_ms = int(channel["min_on_ms"])
            off_ms = int(channel["min_off_ms"])
            outlet_logic.append(f'''   #Wanted := #Running AND ((#ValveSnapshot[{index // 8}] AND B#16#{1 << (index % 8):02X}) <> B#16#00);
   IF NOT #Running THEN
      #ValveOpen[{index}] := FALSE;
      #ValveAgeMs[{index}] := 0;
   ELSE
      IF #ValveAgeMs[{index}] < 30000 THEN #ValveAgeMs[{index}] := #ValveAgeMs[{index}] + {CYCLE_MS}; END_IF;
      IF (#Wanted <> #ValveOpen[{index}]) AND
         ((#ValveOpen[{index}] AND (#ValveAgeMs[{index}] >= {on_ms})) OR
          (NOT #ValveOpen[{index}] AND (#ValveAgeMs[{index}] >= {off_ms}))) THEN
         #ValveOpen[{index}] := #Wanted;
         #ValveAgeMs[{index}] := 0;
      END_IF;
   END_IF;''')
            if channel.get("output"):
                output_logic.append(f"   {channel['output']} := #Running AND #ValveOpen[{index}];")
            valve_feedback = channel.get("feedback_input") or f"#ValveOpen[{index}]"
            feedback_logic.append(_bit_set_scl('"AquaFlowSiteIO".ValveFeedbackBits', index, valve_feedback))

        elif channel["kind"] == "pump":
            outlets = [c["index"] for c in site["channels"]
                       if c.get("pump_id") == channel["id"] and c["index"] in mapped_valves]
            open_expression = " OR ".join(f"#ValveOpen[{v}]" for v in outlets) or "FALSE"
            maximum = round(channel["max_percent"] * 27648 / 100)
            fault = channel.get("fault_input") or "FALSE"
            output_logic.append(f'''   #PumpAllowed := #Running AND ({open_expression}) AND NOT ({fault});
   IF #Running AND (#PumpSnapshot[{index}] > 0) AND NOT ({open_expression}) THEN
      "AquaFlowSiteIO".RejectedReason := 4;
   END_IF;
   #PumpTarget := 0;
   IF #PumpAllowed THEN
      IF #PumpSnapshot[{index}] > {maximum} THEN #PumpTarget := {maximum};
      ELSE #PumpTarget := UINT_TO_INT(#PumpSnapshot[{index}]); END_IF;
   END_IF;
   "AquaFlowSiteIO".PumpApplied[{index}] := INT_TO_UINT(#PumpTarget);''')
            if channel.get("output"):
                output_logic.append(f"   {channel['output']} := INT_TO_WORD(#PumpTarget);")
            if channel.get("enable_output"):
                output_logic.append(f"   {channel['enable_output']} := #PumpAllowed AND (#PumpTarget > 0);")
            running = channel.get("feedback_input") or "(#PumpAllowed AND (#PumpTarget > 0))"
            feedback_logic.append(_bit_set_scl('"AquaFlowSiteIO".PumpRunningBits', index, running))
            feedback_logic.append(_bit_set_scl('"AquaFlowSiteIO".PumpFaultBits', index, fault))
            if channel.get("fault_input"):
                feedback_logic.append(f"   IF {fault} THEN #AnyPumpFault := TRUE; END_IF;")

        else:
            base = index * 3
            for component in range(3):
                light_logic.append(
                    f'   IF #Running THEN "AquaFlowSiteIO".LightAppliedRGB[{base + component}] := #LightSnapshot[{base + component}]; '
                    f'ELSE "AquaFlowSiteIO".LightAppliedRGB[{base + component}] := B#16#00; END_IF;')
                if channel.get("output"):
                    qbyte = int(re.fullmatch(r"%QB(\d+)", channel["output"])[1]) + component
                    light_logic.append(f'   %QB{qbyte} := "AquaFlowSiteIO".LightAppliedRGB[{base + component}];')
            active = " OR ".join(
                f'("AquaFlowSiteIO".LightAppliedRGB[{base + component}] <> B#16#00)' for component in range(3))
            light_logic.append(_bit_set_scl('"AquaFlowSiteIO".LightActiveBits', index, f"({active})"))

    ring_copy = "\n".join([
        '         FOR #i := 0 TO 15 DO #PumpSnapshot[#i] := "AquaFlowSiteIO".Ring[#Slot].PumpSpeed[#i]; END_FOR;',
        '         FOR #i := 0 TO 63 DO #ValveSnapshot[#i] := "AquaFlowSiteIO".Ring[#Slot].ValveBits[#i]; END_FOR;',
        '         FOR #i := 0 TO 95 DO #LightSnapshot[#i] := "AquaFlowSiteIO".Ring[#Slot].LightRGB[#i]; END_FOR;',
    ])
    fb = f'''FUNCTION_BLOCK "AquaFlowSiteControl"
{{ S7_Optimized_Access := 'TRUE' }}
VERSION : 3.0
   VAR_INPUT
      EstopOK : Bool;
      LevelOK : Bool;
      ThermalOK : Bool;
      DriveOK : Bool;
      PressureOK : Bool;
   END_VAR
   VAR
      LastSequence : UInt;
      CommandAgeMs : Int := {WATCHDOG_MS}; // not healthy until the first OFF handshake
      Ready : Bool;
      Running : Bool;
      Buffered : Bool; // RUN from the timestamped ring on the PLC show clock
      ShowClock : UDInt;
      LastKeepalive : UInt;
      StreamFault : UInt; // 4 invalid ring, 5 underrun; latched until the next OFF handshake
      LateSeen : Bool;
      PumpSnapshot : Array[0..15] of UInt;
      ValveSnapshot : Array[0..63] of Byte;
      LightSnapshot : Array[0..95] of Byte;
      ValveOpen : Array[0..511] of Bool;
      ValveAgeMs : Array[0..511] of Int;
   END_VAR
   VAR_TEMP
      LocalPermit : Bool;
      Seq : UInt;
      Flags : Word;
      i : Int;
      k : Int;
      Slot : Int;
      Wanted : Bool;
      PumpAllowed : Bool;
      PumpTarget : Int;
      AnyPumpFault : Bool;
      WasRunning : Bool;
      Started : Bool;
      WantBuffered : Bool;
      Underrun : Bool;
      Invalid : Bool;
      WriteIndex : UInt;
      ValidUntil : UDInt;
      Pending : DInt;
      Late : UDInt;
      PumpCandidate : Array[0..15] of UInt;
      ValveCandidate : Array[0..63] of Byte;
      LightCandidate : Array[0..95] of Byte;
   END_VAR
BEGIN
   // Execute exactly once from the {CYCLE_MS}-ms cyclic interrupt OB (AquaFlowCycle, OB200).
   "AquaFlowSiteIO".Magic := W#16#{MAGIC:04X};
   "AquaFlowSiteIO".ContractVersion := {CONTRACT_VERSION};
   "AquaFlowSiteIO".HeaderSize := {HEADER_SIZE};
   "AquaFlowSiteIO".SiteSignature := DW#16#{stamp:08X};
   "AquaFlowSiteIO".ProgramVersion := DW#16#{PROGRAM_VERSION:08X};
   "AquaFlowSiteIO".CycleMs := {CYCLE_MS};
   "AquaFlowSiteIO".PumpCapacity := {PUMP_CAPACITY};
   "AquaFlowSiteIO".ValveCapacity := {VALVE_CAPACITY};
   "AquaFlowSiteIO".LightCapacity := {LIGHT_CAPACITY};
   "AquaFlowSiteIO".BufferCapacity := {BUFFER_CAPACITY};
   IF "AquaFlowSiteIO".PlcHeartbeat = 65535 THEN "AquaFlowSiteIO".PlcHeartbeat := 0;
   ELSE "AquaFlowSiteIO".PlcHeartbeat := "AquaFlowSiteIO".PlcHeartbeat + 1; END_IF;

   #LocalPermit := #EstopOK AND #LevelOK AND #ThermalOK AND #DriveOK AND #PressureOK;
   "AquaFlowSiteIO".Permit := W#16#0000;
   IF #LocalPermit THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0001; END_IF;
   IF #EstopOK THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0002; END_IF;
   IF #LevelOK THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0004; END_IF;
   IF #ThermalOK THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0008; END_IF;
   IF #DriveOK THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0010; END_IF;
   IF #PressureOK THEN "AquaFlowSiteIO".Permit := "AquaFlowSiteIO".Permit OR W#16#0020; END_IF;

   #WasRunning := #Running;
   #Started := FALSE;
   IF #CommandAgeMs < 30000 THEN #CommandAgeMs := #CommandAgeMs + {CYCLE_MS}; END_IF;
   #Seq := "AquaFlowSiteIO".CommandSequence;
   #Flags := "AquaFlowSiteIO".CommandFlags;
   IF (#Seq <> #LastSequence) AND ((#Flags AND W#16#8000) = W#16#0000) THEN
      "AquaFlowSiteIO".RejectedReason := 0;
      FOR #i := 0 TO 15 DO #PumpCandidate[#i] := "AquaFlowSiteIO".PumpSpeed[#i]; END_FOR;
      FOR #i := 0 TO 63 DO #ValveCandidate[#i] := "AquaFlowSiteIO".ValveBits[#i]; END_FOR;
      FOR #i := 0 TO 95 DO #LightCandidate[#i] := "AquaFlowSiteIO".LightRGB[#i]; END_FOR;
      IF (#Seq = "AquaFlowSiteIO".CommandSequence) AND (#Flags = "AquaFlowSiteIO".CommandFlags) THEN
         #LastSequence := #Seq;
         #CommandAgeMs := 0;
         #WantBuffered := (#Flags AND W#16#0004) <> W#16#0000;
         // A RUN+BUFFERED commit during buffered RUN is only a keepalive: the ring owns the outputs.
         IF NOT (#WantBuffered AND ((#Flags AND W#16#0001) <> W#16#0000) AND #Running AND #Buffered) THEN
            FOR #i := 0 TO 15 DO #PumpSnapshot[#i] := #PumpCandidate[#i]; END_FOR;
            FOR #i := 0 TO 63 DO #ValveSnapshot[#i] := #ValveCandidate[#i]; END_FOR;
            FOR #i := 0 TO 95 DO #LightSnapshot[#i] := #LightCandidate[#i]; END_FOR;
            IF (#Flags AND W#16#0002) <> W#16#0000 THEN #Ready := FALSE; #Running := FALSE; END_IF;
            IF (#Flags AND W#16#0001) = W#16#0000 THEN
               #Running := FALSE; #Ready := #LocalPermit; #StreamFault := 0;
            ELSIF #Running AND (#Buffered <> #WantBuffered) THEN
               // Never switch between streamed and buffered while outputs run.
               #Running := FALSE; #Ready := FALSE;
               "AquaFlowSiteIO".RejectedReason := 5;
            ELSE
               IF NOT #Running THEN #Buffered := #WantBuffered; END_IF;
               #Running := #Ready AND #LocalPermit;
               IF NOT #LocalPermit THEN "AquaFlowSiteIO".RejectedReason := 1;
               ELSIF NOT #Ready THEN "AquaFlowSiteIO".RejectedReason := 2; END_IF;
               #Started := #Running AND #Buffered AND NOT #WasRunning;
            END_IF;
         END_IF;
      ELSE "AquaFlowSiteIO".RejectedReason := 3;
      END_IF;
   END_IF;
   IF #Started THEN #LastKeepalive := "AquaFlowSiteIO".StreamKeepalive; END_IF;
   // While buffered, every refill changes StreamKeepalive: that is the command watchdog's food.
   IF #Running AND #Buffered AND ("AquaFlowSiteIO".StreamKeepalive <> #LastKeepalive) THEN
      #LastKeepalive := "AquaFlowSiteIO".StreamKeepalive;
      #CommandAgeMs := 0;
   END_IF;
   IF NOT #LocalPermit OR (#CommandAgeMs >= {WATCHDOG_MS}) THEN
      #Running := FALSE;
      #Ready := FALSE; // Fresh OFF handshake is required; never auto-restart.
   END_IF;
   "AquaFlowSiteIO".LastCommandAgeMs := INT_TO_UDINT(#CommandAgeMs);

   // Frame-accurate playback: apply every ring bank whose AtMs has come on the PLC show clock.
   #Underrun := FALSE;
   #Invalid := FALSE;
   IF #Running AND #Buffered THEN
      IF #Started THEN
         #ShowClock := 0;
         #LateSeen := FALSE;
         "AquaFlowSiteIO".LastLateMs := 0;
         "AquaFlowSiteIO".WorstLateMs := 0;
         "AquaFlowSiteIO".AppliedAtMs := 0;
      ELSE
         #ShowClock := #ShowClock + {CYCLE_MS};
      END_IF;
      #WriteIndex := "AquaFlowSiteIO".BufferWriteIndex;
      #ValidUntil := "AquaFlowSiteIO".ValidUntilMs;
      FOR #k := 1 TO {BUFFER_CAPACITY} DO
         #Pending := UINT_TO_DINT(#WriteIndex) - UINT_TO_DINT("AquaFlowSiteIO".BufferReadIndex);
         IF #Pending < 0 THEN #Pending := #Pending + 65536; END_IF;
         IF #Pending = 0 THEN EXIT; END_IF;
         IF #Pending > {BUFFER_CAPACITY} THEN #Invalid := TRUE; EXIT; END_IF;
         #Slot := UINT_TO_INT("AquaFlowSiteIO".BufferReadIndex MOD {BUFFER_CAPACITY});
         IF "AquaFlowSiteIO".Ring[#Slot].AtMs > #ShowClock THEN EXIT; END_IF;
         IF "AquaFlowSiteIO".Ring[#Slot].AtMs < "AquaFlowSiteIO".AppliedAtMs THEN #Invalid := TRUE; EXIT; END_IF;
{ring_copy}
         #Late := #ShowClock - "AquaFlowSiteIO".Ring[#Slot].AtMs;
         IF #Late > 65535 THEN #Late := 65535; END_IF;
         "AquaFlowSiteIO".LastLateMs := UDINT_TO_UINT(#Late);
         IF "AquaFlowSiteIO".LastLateMs > "AquaFlowSiteIO".WorstLateMs THEN "AquaFlowSiteIO".WorstLateMs := "AquaFlowSiteIO".LastLateMs; END_IF;
         IF #Late >= {CYCLE_MS} THEN #LateSeen := TRUE; END_IF;
         "AquaFlowSiteIO".AppliedAtMs := "AquaFlowSiteIO".Ring[#Slot].AtMs;
         IF "AquaFlowSiteIO".BufferReadIndex = 65535 THEN "AquaFlowSiteIO".BufferReadIndex := 0;
         ELSE "AquaFlowSiteIO".BufferReadIndex := "AquaFlowSiteIO".BufferReadIndex + 1; END_IF;
      END_FOR;
      // Ring ran dry: hold the last bank (as a stalled stream did before), then stop.
      IF #ShowClock > #ValidUntil THEN
         #Underrun := TRUE;
         IF (#ShowClock - #ValidUntil) >= {UNDERRUN_LIMIT_MS} THEN #StreamFault := 5; #Running := FALSE; #Ready := FALSE; END_IF;
      END_IF;
      IF #Invalid THEN #StreamFault := 4; #Running := FALSE; #Ready := FALSE; END_IF;
   END_IF;
   IF #Buffered AND NOT #Running THEN
      // Leaving buffered RUN (Stop, watchdog, permit, underrun, invalid ring): flush the ring.
      "AquaFlowSiteIO".BufferReadIndex := "AquaFlowSiteIO".BufferWriteIndex;
      #Buffered := FALSE;
      #ShowClock := 0;
   END_IF;
   "AquaFlowSiteIO".ShowClockMs := #ShowClock;
   "AquaFlowSiteIO".BufferStatus := W#16#0000;
   IF #Running AND #Buffered THEN "AquaFlowSiteIO".BufferStatus := "AquaFlowSiteIO".BufferStatus OR W#16#0001; END_IF;
   IF #Underrun THEN "AquaFlowSiteIO".BufferStatus := "AquaFlowSiteIO".BufferStatus OR W#16#0002; END_IF;
   IF #LateSeen THEN "AquaFlowSiteIO".BufferStatus := "AquaFlowSiteIO".BufferStatus OR W#16#0004; END_IF;

   FOR #i := 0 TO 15 DO "AquaFlowSiteIO".PumpApplied[#i] := 0; END_FOR;
   FOR #i := 0 TO 1 DO "AquaFlowSiteIO".PumpRunningBits[#i] := B#16#00; "AquaFlowSiteIO".PumpFaultBits[#i] := B#16#00; END_FOR;
   FOR #i := 0 TO 63 DO "AquaFlowSiteIO".ValveFeedbackBits[#i] := B#16#00; END_FOR;
   FOR #i := 0 TO 95 DO "AquaFlowSiteIO".LightAppliedRGB[#i] := B#16#00; END_FOR;
   FOR #i := 0 TO 3 DO "AquaFlowSiteIO".LightActiveBits[#i] := B#16#00; END_FOR;
   #AnyPumpFault := FALSE;
{chr(10).join(outlet_logic)}
{chr(10).join(output_logic)}
{chr(10).join(feedback_logic)}
{chr(10).join(light_logic)}

   "AquaFlowSiteIO".FaultCode := 0;
   IF NOT #LocalPermit THEN "AquaFlowSiteIO".FaultCode := 1;
   ELSIF #CommandAgeMs >= {WATCHDOG_MS} THEN "AquaFlowSiteIO".FaultCode := 2;
   ELSIF #StreamFault <> 0 THEN "AquaFlowSiteIO".FaultCode := #StreamFault;
   ELSIF #AnyPumpFault THEN "AquaFlowSiteIO".FaultCode := 3; END_IF;
   "AquaFlowSiteIO".Status := W#16#0000;
   IF #Running THEN "AquaFlowSiteIO".Status := "AquaFlowSiteIO".Status OR W#16#0001; END_IF;
   IF #Ready THEN "AquaFlowSiteIO".Status := "AquaFlowSiteIO".Status OR W#16#0002; END_IF;
   IF #CommandAgeMs < {WATCHDOG_MS} THEN "AquaFlowSiteIO".Status := "AquaFlowSiteIO".Status OR W#16#0004; END_IF;
   IF #LastSequence = "AquaFlowSiteIO".CommandSequence THEN "AquaFlowSiteIO".Status := "AquaFlowSiteIO".Status OR W#16#0008; END_IF;
   IF "AquaFlowSiteIO".FaultCode <> 0 THEN "AquaFlowSiteIO".Status := "AquaFlowSiteIO".Status OR W#16#0010; END_IF;
   // Publish acknowledgement and feedback sequence after outputs and feedback.
   "AquaFlowSiteIO".FeedbackSequence := #LastSequence;
   "AquaFlowSiteIO".AckSequence := #LastSequence;
END_FUNCTION_BLOCK

DATA_BLOCK "AquaFlowSiteControlInstance"
"AquaFlowSiteControl"
BEGIN
END_DATA_BLOCK
'''

    input_args = ",\n".join(f"   {label} := {site['inputs'][key] or 'FALSE'}" for key, label in (
        ("estop_ok", "EstopOK"), ("level_ok", "LevelOK"), ("thermal_ok", "ThermalOK"),
        ("drive_ok", "DriveOK"), ("pressure_ok", "PressureOK")))
    call = f'"AquaFlowSiteControlInstance"(\n{input_args}\n);\n'
    simulator_call = '''// PLCSIM ONLY. Do not use these TRUE constants on a physical fountain.
// A real PLC must use the reviewed healthy-high field safety inputs.
"AquaFlowSiteControlInstance"(
   EstopOK := TRUE,
   LevelOK := TRUE,
   ThermalOK := TRUE,
   DriveOK := TRUE,
   PressureOK := TRUE
);
'''
    cycle_ob = f'''ORGANIZATION_BLOCK "AquaFlowCycle"
{{ S7_Optimized_Access := 'TRUE' }}
VERSION : 3.0
// Cyclic interrupt, {CYCLE_MS} ms, phase 0. The PLC show clock counts these executions.
BEGIN
{call}END_ORGANIZATION_BLOCK
'''

    schedule = io.StringIO()
    writer = csv.writer(schedule)
    writer.writerow(["Name", "Kind", "FixtureID", "CommandAddress", "FeedbackAddress", "PhysicalOutput",
                     "EnableOutput", "PhysicalFeedbackInput", "FaultInput", "SupplyingPump", "MaximumPercent"])
    for channel in site["channels"]:
        index, kind = channel["index"], channel["kind"]
        command = ({"pump": f"DB{site['plc']['db']}.DBW{64 + 2 * index}",
                    "valve": f"DB{site['plc']['db']}.DBX{112 + index // 8}.{index % 8}",
                    "light": f"DB{site['plc']['db']}.DBB{176 + 3 * index}..+2"})[kind]
        feedback = ({"pump": f"DB{site['plc']['db']}.DBW{272 + 2 * index}",
                     "valve": f"DB{site['plc']['db']}.DBX{308 + index // 8}.{index % 8}",
                     "light": f"DB{site['plc']['db']}.DBB{372 + 3 * index}..+2"})[kind]
        writer.writerow([channel["name"], kind, channel["id"], command, feedback, channel["output"],
                         channel["enable_output"], channel.get("feedback_input", ""), channel.get("fault_input", ""),
                         channel.get("pump_id", ""), channel["max_percent"]])

    readme = f'''AquaFlow Siemens runtime package: {site['name']}
Site schema: {CONTRACT}. Wire contract: v{CONTRACT_VERSION}. Signature: 0x{stamp:08X}.
Required non-optimized DB: DB{site['plc']['db']}, {DB_SIZE} bytes.

TIA Portal owns hardware configuration, compilation, download and commissioning. AquaFlow uses
classic S7comm absolute DB access after TIA is closed. Import the DB/FB/OB sources, map every
healthy-high interlock and physical I/O, compile, inspect offsets, download, and test in a secured
commissioning environment. Configure CPU access protection to permit the approved runtime data
connection. Do not call the FB from OB1; call its non-retentive instance once from the {CYCLE_MS}-ms
cyclic interrupt OB (OB200 AquaFlowCycle, phase 0).

FRAME-ACCURATE TIMING (contract v{CONTRACT_VERSION})
The PLC keeps its own show clock (ShowClockMs, +{CYCLE_MS} ms per OB200 execution from the accepted RUN).
AquaFlow keeps a ring of {BUFFER_CAPACITY} timestamped command banks (Ring[], {SLOT_SIZE} bytes each: AtMs + the
same pump/valve/RGB bank as the streamed command) up to ~1.5 s ahead, and the PLC applies each bank
in the OB execution where ShowClockMs reaches its AtMs: cues land within one {CYCLE_MS}-ms cycle,
independent of PC or network jitter. AquaFlow reads ShowClockMs, BufferReadIndex and WorstLateMs back
and shows them as the measured timing. The ring is never an autonomous show: StreamKeepalive must
change at least every {WATCHDOG_MS} ms (otherwise the watchdog drops Ready/Running, as before) and when
ShowClockMs passes ValidUntilMs the PLC holds the last bank for at most {UNDERRUN_LIMIT_MS} ms, then stops
with FaultCode 5. Stop (RUN=0), permit loss, watchdog, underrun or an invalid ring flush the ring.
Valve minimum on/off times are enforced in milliseconds. PLCs still running the contract v{LEGACY_CONTRACT_VERSION}
(100-ms, streamed) program keep working; AquaFlow streams to them and asks for this update.

The DB ownership, offsets, status bits, fault codes, command transaction and commissioning steps are
documented in SIEMENS-PLC-RUNTIME-CONTRACT.md and SIEMENS-RUNTIME-COMMISSIONING.md. Pump speeds are
0..27648. A pump is disabled unless at least one mapped supplied valve is open. Loss of fresh command
sequences (or, while buffered, of StreamKeepalive changes) for {WATCHDOG_MS} ms removes Ready/Running and
requires a new OFF handshake. PLC-applied feedback
is returned for every output; optional digital feedback/fault inputs upgrade pump/valve state to
physical evidence. RGB lights use three consecutive %QB bytes.

This ordinary PLC logic is not a safety program. Keep the hardwired emergency stop, motor protection,
drive trips, level/pressure protection and safe CPU-STOP substitute values independent of AquaFlow.
'''
    contract_manifest = {
        "magic": f"0x{MAGIC:04X}", "contract_version": CONTRACT_VERSION,
        "program_version": f"0x{PROGRAM_VERSION:08X}", "db_size": DB_SIZE,
        "header_size": HEADER_SIZE, "command_size": COMMAND_SIZE, "feedback_size": FEEDBACK_SIZE,
        "cycle_ms": CYCLE_MS, "watchdog_ms": WATCHDOG_MS, "underrun_limit_ms": UNDERRUN_LIMIT_MS,
        "buffer": {"capacity": BUFFER_CAPACITY, "slot_size": SLOT_SIZE, "ring": RING_OFFSET,
                   "slot_layout": {"at_ms": 0, "bank": 4},
                   "show_clock": SHOW_CLOCK_OFFSET, "read_index": BUFFER_READ_OFFSET,
                   "capacity_field": BUFFER_CAPACITY_OFFSET, "worst_late": WORST_LATE_OFFSET,
                   "last_late": LAST_LATE_OFFSET, "status": BUFFER_STATUS_OFFSET,
                   "applied_at": APPLIED_AT_OFFSET, "write_index": BUFFER_WRITE_OFFSET,
                   "keepalive": STREAM_KEEPALIVE_OFFSET, "valid_until": VALID_UNTIL_OFFSET},
        "offsets": {
            "pump_command": PUMP_COMMAND_OFFSET, "pump_mode": PUMP_MODE_OFFSET,
            "valve_command": VALVE_COMMAND_OFFSET, "light_command": LIGHT_COMMAND_OFFSET,
            "pump_feedback": PUMP_FEEDBACK_OFFSET, "pump_running": PUMP_RUNNING_OFFSET,
            "pump_fault": PUMP_FAULT_OFFSET, "valve_feedback": VALVE_FEEDBACK_OFFSET,
            "light_feedback": LIGHT_FEEDBACK_OFFSET, "light_active": LIGHT_ACTIVE_OFFSET,
        },
        "capacities": {"pumps": PUMP_CAPACITY, "valves": VALVE_CAPACITY, "lights": LIGHT_CAPACITY},
        "site_signature": f"0x{stamp:08X}", "db_number": site["plc"]["db"],
    }

    # Keep the show beside the exact PLC contract it was compiled against.  TIA
    # imports the DB/FB/OB sources; AquaFlow remains the show scheduler after
    # commissioning.  Including both JSON and CSV makes the exported package a
    # portable, reviewable hand-off rather than a collection of unexplained SCL
    # files.
    compiled_show = site.get("show")
    show_payload = {
        "format": "aquaflow-siemens-show-v1",
        "included": bool(compiled_show),
        "site_id": site["id"],
        "site_name": site["name"],
        "site_revision": site["revision"],
        "site_signature": f"0x{stamp:08X}",
        "execution_owner": "AquaFlow runtime",
        "note": (
            "TIA commissions the PLC interface. AquaFlow sends this timeline to the commissioned PLC at runtime; "
            "the timeline is not an autonomous PLC-resident show."
        ),
        "show": compiled_show,
        # Site sync: the cue times above already fire each output early (PLC, valve, water rise,
        # DMX) against the music's path to the audience; the music must start at audioStartMs.
        "siteSync": (compiled_show or {}).get("sync"),
    }
    show_schedule = io.StringIO()
    show_writer = csv.writer(show_schedule)
    show_writer.writerow(["Order", "Channel", "Kind", "FixtureID", "Track", "StartSeconds",
                          "DurationSeconds", "ValuePercent", "FadeInSeconds", "FadeOutSeconds"])
    channels_by_id = {channel["id"]: channel for channel in site["channels"]}
    for order, clip in enumerate(sorted((compiled_show or {}).get("clips", []),
                                        key=lambda item: (item["startTime"], item["fixtureId"], item["type"])), 1):
        channel = channels_by_id.get(clip["fixtureId"], {})
        show_writer.writerow([
            order, channel.get("name", clip["fixtureId"]), channel.get("kind", "unknown"),
            clip["fixtureId"], clip["type"], clip["startTime"], clip["duration"], clip["value"],
            clip.get("fadeIn", 0), clip.get("fadeOut", 0),
        ])

    package_manifest = {
        "format": "aquaflow-tia-commissioning-package-v1",
        "site": {"id": site["id"], "name": site["name"], "revision": site["revision"],
                 "signature": f"0x{stamp:08X}"},
        "tia_portal": {"minimum_version": 17, "selected_version": site.get("tia", {}).get("version", 17),
                       "maximum_reviewed_version": 21},
        "plc_interface": {"db": site["plc"]["db"], "optimized_access": False,
                          "cyclic_ob": "AquaFlowCycle", "cycle_ms": CYCLE_MS},
        "import_order": ["AquaFlowSiteIO.db", "AquaFlowSiteControl.scl", "AquaFlowCycle.scl"],
        "manual_v17_import_order": ["AquaFlowSiteIO.db", "AquaFlowSiteControl.scl"],
        "manual_cyclic_ob": {
            "name": "AquaFlowCycle", "number": 200, "event": "CyclicInterrupt",
            "cycle_ms": CYCLE_MS, "phase_ms": 0, "call_file": "cyclic-call.txt",
            "simulator_call_file": "PLCSIM-ONLY-cyclic-call.txt",
        },
        "compiled_pattern": {
            "included": bool(compiled_show),
            "clip_count": len((compiled_show or {}).get("clips", [])),
            "duration_seconds": (compiled_show or {}).get("duration", 0),
        },
    }
    connection_profile = {
        "format": "aquaflow-siemens-connection-v1",
        "site_id": site["id"], "site_name": site["name"],
        "target_ip": site["plc"].get("ip", ""), "port": site["plc"].get("port", 102),
        "rack": site["plc"].get("rack", 0), "slot": site["plc"].get("slot", 1),
        "db": site["plc"]["db"], "site_signature": f"0x{stamp:08X}",
        "target_ip_note": (
            "Use the physical PLC IP, or the Windows bridge IP when standard PLCSIM is exposed through NetToPLCsim."
        ),
    }
    quickstart = f'''AQUAFLOW -> TIA PORTAL V17+ -> PLC -> AQUAFLOW RUNTIME

SITE: {site['name']}
REVISION: {site['revision']}
SIGNATURE: 0x{stamp:08X}
SELECTED TIA VERSION: V{site.get('tia', {}).get('version', 17)}
COMPILED PATTERN: {'YES' if compiled_show else 'NO - compile the AquaFlow timeline before exporting if you want it archived in this package'}

IN TIA PORTAL
1. Create/open the project and add the exact CPU and I/O modules.
2. Configure the CPU IP, device name and PROFINET network.
3. In CPU Protection & Security, permit the approved PUT/GET runtime connection.
4. Add these external sources in this order:
   AquaFlowSiteIO.db
   AquaFlowSiteControl.scl
5. Generate blocks from each source. AquaFlowSiteControl.scl also creates its instance DB.
6. Confirm AquaFlowSiteIO is non-optimized DB{site['plc']['db']}.
7. Create OB200 AquaFlowCycle in TIA as a Cyclic interrupt, {CYCLE_MS} ms, phase 0. Paste cyclic-call.txt.
   (Updating a PLC that ran the older 100-ms program: open OB200 > Properties > Cyclic interrupt and
   change the cycle time from 100 ms to {CYCLE_MS} ms, regenerate all three blocks from these sources,
   compile and download. AquaFlow refuses the new program if OB200 does not run every {CYCLE_MS} ms.)
   AquaFlowCycle.scl is a source reference; never accept a generated OB until TIA confirms its event class and period.
8. Replace every FALSE safety argument with the correct healthy-high field input. Use TRUE only in an isolated simulator.
9. Compile hardware and software. Continue only with zero errors.
10. Download to the intended CPU/PLCSIM, put it in RUN, and confirm the PLC heartbeat changes.
11. Close TIA Portal. TIA does not need to remain open for AquaFlow runtime control.

BACK IN AQUAFLOW
1. Open PLC > Siemens Site and select this site.
2. Set Physical mode and enter the physical PLC IP. For standard PLCSIM + NetToPLCsim, enter the Windows bridge IP.
3. Use port {site['plc'].get('port', 102)}, rack {site['plc'].get('rack', 0)}, slot {site['plc'].get('slot', 1)}, DB {site['plc']['db']}.
4. Save, then click Verify PLC connection. Verify is read-only.
5. Commission one outlet at a time. Record the observed response before full-show arming.
6. Compile/start the saved AquaFlow pattern. AquaFlow schedules the pattern; the PLC owns interlocks, watchdog and physical I/O.
7. The Play-on-PLC status shows "Frame-accurate (PLC clock)": cues fire on the PLC's own {CYCLE_MS}-ms clock.
   "Streamed ... update the PLC program" means the PLC still runs the older 100-ms program.

FILES
- AquaFlowShow.json and ShowTimeline.csv: the compiled pattern and human-readable timeline.
- AquaFlowConnection.json: the exact runtime connection profile.
- package-manifest.json: version, import order and signature.
- runtime-contract.json and IO-schedule.csv: byte contract and physical mapping.

SAFETY
This package is ordinary control logic, not a safety PLC program. Preserve hardwired emergency stop,
motor protection, level/pressure protection, drive trips and safe CPU-STOP substitute values.
'''

    same_pc_guide = f'''AQUAFLOW + TIA PORTAL + PLCSIM ON ONE COMPUTER

SITE: {site['name']}
TIA VERSION SELECTED IN AQUAFLOW: V{site.get('tia', {}).get('version', 17)}
DB: DB{site['plc']['db']} (non-optimized)

1. In TIA Portal create a project and add the exact S7-1200 CPU used by the test or cabinet.
2. In CPU Protection & Security enable the approved PUT/GET runtime connection.
3. Under External source files add and generate, in order:
   a. AquaFlowSiteIO.db
   b. AquaFlowSiteControl.scl
4. Confirm Program blocks contains AquaFlowSiteIO, AquaFlowSiteControl and
   AquaFlowSiteControlInstance. Set AquaFlowSiteIO to non-optimized DB{site['plc']['db']}.
5. Add a new Organization block:
   Name: AquaFlowCycle
   Number: 200
   Event: Cyclic interrupt
   Language: SCL
   Cycle: {CYCLE_MS} ms   (the frame-accurate show clock counts these executions)
   Phase: 0 ms
6. For isolated PLCSIM paste PLCSIM-ONLY-cyclic-call.txt into the OB. For physical hardware,
   paste cyclic-call.txt only after its FALSE values are replaced by reviewed healthy-high inputs.
7. Do not call AquaFlowSiteControlInstance from OB1 or from any second OB.
8. Rebuild hardware and software. Continue only with zero errors.
9. Download to PLCSIM, put the CPU in RUN, and monitor AquaFlowSiteIO.PlcHeartbeat.
10. Standard PLCSIM needs NetToPLCsim (or another verified bridge) for external S7 TCP port 102.
    Start the bridge, select the running PLCSIM instance and listen on this computer's LAN IPv4.
11. In AquaFlow switch this site to Physical, enter the bridge/listener IPv4, port 102,
    rack 0, slot 1 and DB {site['plc']['db']}. Save and use Verify PLC connection.

EXPECTED IDENTITY
Magic: 0x{MAGIC:04X}
Contract version: {CONTRACT_VERSION}
Site signature: 0x{stamp:08X}
PLC heartbeat: changes every {CYCLE_MS} ms while AquaFlowCycle executes
Timing: AquaFlow reports "Frame-accurate (PLC clock)" once Verify finds contract v{CONTRACT_VERSION}

UPDATING A PLCSIM PROJECT FROM THE OLDER 100-MS PROGRAM
Regenerate AquaFlowSiteIO, AquaFlowSiteControl (and its instance) from these sources, change
OB200's cyclic interrupt time from 100 ms to {CYCLE_MS} ms, compile, download and put PLCSIM in RUN.
DB{site['plc']['db']} grows to {DB_SIZE} bytes; keep it non-optimized. Then Verify again in AquaFlow.

PLCSIM-ONLY-cyclic-call.txt deliberately forces the five logical permits TRUE. Never transfer
that simulator call into a physical fountain project. Physical safety inputs and independent
electrical protection must be commissioned before output testing.
'''

    lab_profile = site.get("lab_profile")
    lab_guide = ""
    if lab_profile:
        input_lines = "\n".join(f"   {address} = TRUE" for address in lab_profile["inputs_to_force_true"])
        analog_lines = "\n".join(f"   {address}: {label}" for address, label in lab_profile["analog_outputs"].items())
        digital_lines = "\n".join(f"   {address}: {label}" for address, label in lab_profile["digital_outputs"].items())
        lab_guide = f'''CPU 1215C LARGE I/O PLCSIM TEST

TARGET CPU
{lab_profile['cpu']} ({lab_profile['order_number']})
PLCSIM CPU address shown in the supplied screenshot: {lab_profile['simulated_cpu_ip']}

USE THE REAL INPUT-MAPPED CALL
Create OB200 as a {CYCLE_MS} ms Cyclic interrupt and paste cyclic-call.txt. Do not use
PLCSIM-ONLY-cyclic-call.txt for this learning test. In PLCSIM force these healthy-high
inputs TRUE before arming AquaFlow:
{input_lines}

Setting any one of those inputs FALSE must remove Permit and stop every output. This is
the expected input-result test. The logic is ordinary simulation control, not safety logic.

OBSERVE THESE ANALOG OUTPUTS
{analog_lines}

OBSERVE THESE DIGITAL OUTPUTS
{digital_lines}

STRUCTURED DB100 DATA
The four RGB groups use simulated extended process-image bytes %QB100 through %QB111 because
a bare CPU 1215C has no RGB/DMX interface. Monitor those bytes plus AquaFlowSiteIO.LightRGB
and AquaFlowSiteIO.LightAppliedRGB in DB100. These addresses are PLCSIM-only.
Also monitor PlcHeartbeat, AquaFlowHeartbeat, CommandSequence, AckSequence, PumpSpeed,
PumpApplied, ValveBits, ValveFeedbackBits, Status, Permit, FaultCode and RejectedReason.
During a show ShowClockMs counts up in {CYCLE_MS}-ms steps, BufferReadIndex follows BufferWriteIndex,
AppliedAtMs shows the last cue taken from Ring[] and WorstLateMs stays below {CYCLE_MS}.

60-SECOND EXPECTED SEQUENCE
0-32 s: four valve pairs run for eight seconds each.
32-42 s: alternating bank 1 runs.
42-52 s: alternating bank 2 runs.
52-60 s: all eight valves run.
Both pump commands are 25 percent while a supplied valve is open. RGB values change in DB100.

NETWORK TEST
Standard PLCSIM requires NetToPLCsim. NetToPLCsim listens on the Windows adapter IPv4;
AquaFlow connects to that Windows IPv4, port 102, rack 0, slot 1, DB100. The PLCSIM CPU
address and the Windows bridge address are different roles.

Never copy this laboratory address map to a physical cabinet without commissioning every
terminal, drive, valve, feedback, fault input and independent protection circuit.
'''

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        files = {
            "AquaFlowSiteIO.db": db, "AquaFlowSiteControl.scl": fb,
            "AquaFlowCycle.scl": cycle_ob, "cyclic-call.txt": call,
            "PLCSIM-ONLY-cyclic-call.txt": simulator_call,
            "cyclic-ob-requirement.json": json.dumps(CYCLIC_OB_REQUIREMENT, indent=2),
            "IO-schedule.csv": schedule.getvalue(), "site.json": json.dumps(site, indent=2),
            "runtime-contract.json": json.dumps(contract_manifest, indent=2),
            "AquaFlowShow.json": json.dumps(show_payload, indent=2),
            "ShowTimeline.csv": show_schedule.getvalue(),
            "AquaFlowConnection.json": json.dumps(connection_profile, indent=2),
            "package-manifest.json": json.dumps(package_manifest, indent=2),
            "TIA-V17-PLUS-QUICKSTART.txt": quickstart,
            "SAME-PC-PLCSIM-GUIDE.txt": same_pc_guide,
            "README.txt": readme,
            "commissioning-readiness.json": json.dumps(commissioning_readiness(site), indent=2),
        }
        # Device model: TIA PLC tag table (import via PLC tags → Import) and the wiring schedule.
        from engine import siemens_devices
        files["PLC-Tags-for-TIA-import.xlsx"] = siemens_devices.tia_tag_table_xlsx(site)
        files["PLC-Tags.csv"] = siemens_devices.tag_table_csv(site)
        wiring = io.StringIO()
        writer = csv.writer(wiring)
        writer.writerow(["Device", "Tag", "Signal", "Direction", "Address", "Module", "Module channel",
                         "DB100 contract field", "Note"])
        for point in siemens_devices.io_points(site):
            writer.writerow([point["device_name"], point["plc_tag"], point["label"], point["direction"],
                             point["address"] or "NOT WIRED", point["module"],
                             "" if point["module_channel"] is None else point["module_channel"],
                             point["db_address"], point["note"]])
        files["WIRING-SCHEDULE.csv"] = wiring.getvalue()
        site_sync = (compiled_show or {}).get("sync")
        if site_sync:
            files["SITE-SYNC.txt"] = site_sync_text(site_sync)
        if lab_profile:
            files["CPU-1215C-LARGE-IO-PLCSIM-GUIDE.txt"] = lab_guide
            files["lab-profile.json"] = json.dumps(lab_profile, indent=2)
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()

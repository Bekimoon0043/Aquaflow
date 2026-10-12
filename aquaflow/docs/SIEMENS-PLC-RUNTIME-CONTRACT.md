# AquaFlow Siemens PLC runtime contract

Contract version: **2**  
Program version: **2.0** (`0x00020000`)  
Default DB: **DB100**, configurable per saved site  
DB length: **472 bytes**  
Access: **non-optimized, absolute addressing**  
PLC call: **one 100 ms cyclic interrupt**

## Transport

AquaFlow uses ISO-on-TCP/COTP and classic S7comm Read Var/Write Var on TCP port 102. It does not compile or download PLC logic. The CPU must be configured in TIA Portal to permit the approved data connection. Rack/slot defaults are 0/1 and remain configurable.

All UInt, Word, DWord and UDInt values are big-endian on the wire. Bit zero is the least-significant bit of its byte/word.

## DB map

| Bytes | Name | Owner | Meaning |
|---:|---|---|---|
| 0..1 | Magic | PLC | `0xAF03` |
| 2..3 | ContractVersion | PLC | `2` |
| 4..5 | HeaderSize | PLC | `64` |
| 6..7 | Status | PLC | Runtime status bits |
| 8..11 | SiteSignature | PLC | CRC32 of DB number, routing, limits, safety bindings and hardware mapping |
| 12..15 | ProgramVersion | PLC | `0x00020000` |
| 16..17 | PlcHeartbeat | PLC | Increments every 100 ms |
| 18..19 | AquaFlowHeartbeat | AquaFlow | Increments for every committed frame |
| 20..21 | Permit | PLC | Individual local permissives and combined permit |
| 22..23 | FaultCode | PLC | Current contract fault |
| 24..25 | AckSequence | PLC | Last adopted command |
| 26..27 | CommandSequence | AquaFlow | Commit marker, written last |
| 28..29 | CommandFlags | AquaFlow | RUN bit 0, RESET bit 1, STAGING bit 15 |
| 30..31 | RejectedReason | PLC | Why RUN was rejected |
| 32..33 | FeedbackSequence | PLC | Feedback snapshot sequence |
| 34..35 | CycleMs | PLC | Must be 100 |
| 36..41 | capacities | PLC | 16 pumps, 512 valves, 32 lights |
| 42..43 | Reserved0 | — | Zero |
| 44..47 | LastCommandAgeMs | PLC | Age of last adopted sequence |
| 48..63 | ReservedHeader | — | Zero |
| 64..95 | PumpSpeed[16] | AquaFlow | UInt 0..27648 |
| 96..111 | PumpMode[16] | AquaFlow | 0 off, 1 automatic |
| 112..175 | ValveBits[64] | AquaFlow | 512 valve bits |
| 176..271 | LightRGB[96] | AquaFlow | 32 consecutive R,G,B triples, 0..255 |
| 272..303 | PumpApplied[16] | PLC | Applied raw speed |
| 304..305 | PumpRunningBits | PLC | 16 running states |
| 306..307 | PumpFaultBits | PLC | 16 fault states |
| 308..371 | ValveFeedbackBits | PLC | 512 open states |
| 372..467 | LightAppliedRGB | PLC | 32 applied RGB triples |
| 468..471 | LightActiveBits | PLC | 32 active states |

The Python source of truth is `backend/engine/siemens_contract.py`. Runtime code and generated TIA source must import from it; new offsets must not be placed directly in unrelated modules.

## Status and permit bits

Status: bit 0 Running, bit 1 Ready, bit 2 watchdog healthy, bit 3 current command accepted, bit 4 fault present.

Permit: bit 0 combined local permit, bit 1 E-stop healthy, bit 2 level healthy, bit 3 thermal healthy, bit 4 drive healthy, bit 5 pressure healthy.

Fault codes: 0 none, 1 local interlock open, 2 command watchdog expired, 3 pump fault, 4 invalid command.

Rejection codes: 0 none, 1 local permit off, 2 OFF handshake required, 3 unstable command frame, 4 pump has no open outlet.

## Transaction

AquaFlow performs one request at a time:

1. Write `CommandFlags = 0x8000`.
2. Write all 208 command bytes.
3. Write the next AquaFlow heartbeat.
4. Write final flags (`RUN` or zero).
5. Write the next sequence.
6. Poll the header until both `AckSequence` and `FeedbackSequence` equal that sequence.
7. Read the 200-byte feedback bank.

The PLC snapshots the complete command bank only after seeing a stable, new, non-staging sequence. It updates outputs and feedback before acknowledgement. AquaFlow will not send another nonzero frame until the prior frame is acknowledged.

Sequence values wrap at UInt 65535. Only equality with the latest locally reserved sequence is used; AquaFlow never infers success from ordering.

## Feedback quality

When a pump running input or valve position input is mapped in the site, feedback source is `physical`. Without one, source is `plc_applied`: it confirms the PLC's resolved logical/output command, not water flow or mechanical movement. RGB feedback is currently PLC-applied. Customer documentation and UI must preserve this distinction.

## Compatibility handshake

Compatibility requires all of:

- strict S7 connection;
- optional expected order number/firmware match when configured;
- magic `AF03`;
- contract version 2 and 64-byte header;
- saved site signature;
- program version 2.0;
- exact capacities;
- 100 ms cycle;
- moving PLC heartbeat;
- PLC contract not already reporting RUN, and no other armed AquaFlow site in the current server process owns that PLC address.

The contract has no cross-process lease field. Commissioning must ensure that only one AquaFlow server or other S7 write client is authorized to command this DB.

Network discovery alone does not satisfy this handshake.

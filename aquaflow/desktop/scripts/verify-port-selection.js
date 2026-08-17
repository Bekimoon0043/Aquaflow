// verify-port-selection.js — regression check for findFreePort() address-family
// awareness.
//
// WHY THIS EXISTS (live incident, Aug 2026): on an operator machine Docker
// Desktop held [::]:8000 and the WSL relay held [::1]:8000, while the engine
// bound 127.0.0.1:8000. findFreePort() probed ONLY 127.0.0.1, so an IPv6-held
// port looked free and the engine was handed a contested 8000. Anything that
// reached the backend over ::1 — or over the name "localhost", which Chromium
// resolves to ::1 before IPv4 — landed on Docker/WSL instead of the engine.
// Those foreign services send no CORS headers (the browser reports a CORS
// failure) and 403 an unknown path (the /ws 403).
//
// Run: node scripts/verify-port-selection.js      (from aquaflow/desktop/)
// Exits 0 on pass, 1 on failure. No network access, no side effects.

const net = require("net");
const { findFreePort, probePort, PROBE_HOSTS } = require("../launcher");

let failures = 0;

function check(label, ok, detail) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

/** Hold `port` on `host`; resolves null when that family is unavailable here. */
function occupy(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(null));
    srv.once("listening", () => resolve(srv));
    srv.listen(port, host);
  });
}

const close = (srv) =>
  new Promise((resolve) => (srv ? srv.close(resolve) : resolve()));

async function main() {
  const BASE = 18000; // high base: avoids colliding with anything real

  console.log("\n1. IPv6 wildcard [::] occupied — the live-incident case");
  let held = await occupy(BASE, "::");
  if (!held) {
    console.log("  SKIP — no IPv6 on this host");
  } else {
    const got = await findFreePort(BASE, 10);
    check(
      "findFreePort skips a port held on [::]",
      got !== BASE,
      `returned ${got}, must not be ${BASE}`
    );
    await close(held);
  }

  console.log("\n2. IPv6 loopback ::1 occupied — the wslrelay case");
  held = await occupy(BASE + 1, "::1");
  if (!held) {
    console.log("  SKIP — no IPv6 on this host");
  } else {
    const got = await findFreePort(BASE + 1, 10);
    check(
      "findFreePort skips a port held on ::1",
      got !== BASE + 1,
      `returned ${got}, must not be ${BASE + 1}`
    );
    await close(held);
  }

  console.log("\n3. IPv4 loopback occupied — the original behaviour, unchanged");
  held = await occupy(BASE + 2, "127.0.0.1");
  const got3 = await findFreePort(BASE + 2, 10);
  check(
    "findFreePort skips a port held on 127.0.0.1",
    got3 !== BASE + 2,
    `returned ${got3}, must not be ${BASE + 2}`
  );
  await close(held);

  console.log("\n4. Nothing occupied — still returns the requested port");
  const got4 = await findFreePort(BASE + 3, 10);
  check(
    "findFreePort returns the base port when genuinely free",
    got4 === BASE + 3,
    `returned ${got4}`
  );

  console.log("\n5. A usable port is always produced (no false exhaustion)");
  const got5 = await findFreePort(BASE + 4, 10);
  const usable = await occupy(got5, "127.0.0.1");
  check(
    "the returned port is actually bindable",
    usable !== null,
    `port ${got5}`
  );
  await close(usable);

  // ---------------------------------------------------------------------
  // Sections 6-9 drive the SELECTION LOGIC through an injected prober, so the
  // operator's exact IPv6 case is proven even on a host with no IPv6 stack
  // (this CI container has IPv6 compiled out, which is why 1 and 2 skip).
  // ---------------------------------------------------------------------

  console.log("\n6. PROBE_HOSTS covers both families, wildcard and loopback");
  for (const h of ["0.0.0.0", "::", "127.0.0.1", "::1"]) {
    check(`PROBE_HOSTS includes ${h}`, PROBE_HOSTS.includes(h));
  }

  console.log("\n7. SIMULATED live incident: Docker on [::]:8000, WSL on [::1]:8000");
  const heldBy = { 8000: new Set(["::", "::1"]) }; // exactly the operator's machine
  const fakeProbe = async (port, host) => !(heldBy[port] && heldBy[port].has(host));
  const sim = await findFreePort(8000, 50, fakeProbe);
  check(
    "engine is moved OFF the contested port",
    sim === 8001,
    `returned ${sim} (old behaviour returned 8000 and shared the port)`
  );

  console.log("\n8. IPv4-only host: an unavailable family must NOT veto a port");
  // EAFNOSUPPORT-style: probePort resolves true for a family that is absent.
  const v6Absent = await probePort(BASE + 5, "::");
  check(
    "probing :: on a host without IPv6 reports the port usable",
    v6Absent === true,
    `probePort(:: ) -> ${v6Absent}`
  );
  const ipv4Only = await findFreePort(BASE + 5, 10);
  check(
    "findFreePort still returns a port on an IPv4-only host",
    ipv4Only === BASE + 5,
    `returned ${ipv4Only}`
  );

  console.log("\n9. Exhaustion is still reported honestly");
  let threw = false;
  try {
    await findFreePort(9000, 3, async () => false); // everything taken
  } catch (e) {
    threw = /no free port found/.test(e.message);
  }
  check("all-taken rejects with 'no free port found'", threw);

  console.log(
    `\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});

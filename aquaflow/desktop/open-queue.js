// AquaFlow Studio — queue for project files opened from the OS (launch argv, second
// instance, File > Open Show, macOS open-file).
//
// The renderer can only open a project once ProjectRecoveryHost is mounted, and that happens
// after the license gate has let the user in — long after did-finish-load. A path sent
// before then is silently dropped (seen with 1.2.34: double-clicking an .aquapkg launched
// the app but never opened the show). So the main process keeps every path in this queue
// until the renderer explicitly signals "renderer:ready-for-open"; a reload or renderer
// crash puts the queue back into "not ready" until the next signal.

const READY_CHANNEL = "renderer:ready-for-open";
const OPEN_CHANNEL = "open-show";

/**
 * @param {{ send: (filePath: string) => boolean|void, log?: (msg: string) => void }} opts
 *   send — deliver one path to the renderer; return false if it could not be delivered
 *   (e.g. the window is gone), in which case the path stays queued.
 */
function createOpenQueue({ send, log = () => {} } = {}) {
  if (typeof send !== "function") throw new TypeError("createOpenQueue needs a send function");
  let ready = false;
  const pending = [];

  function flush() {
    while (ready && pending.length) {
      const next = pending[0];
      let delivered;
      try { delivered = send(next); } catch (e) { log(`open-queue send failed: ${e && e.message}`); delivered = false; }
      if (delivered === false) return;
      pending.shift();
      log(`open-queue delivered ${next}`);
    }
  }

  return {
    /** Queue a path and deliver it now if the renderer is ready. Only one project can be
     *  open at a time, so while the renderer is not ready the newest request wins. */
    enqueue(filePath) {
      if (!filePath || typeof filePath !== "string") return;
      if (!ready) pending.length = 0;
      if (!pending.includes(filePath)) pending.push(filePath);
      log(`open-queue ${ready ? "deliver" : "hold"} ${filePath}`);
      flush();
    },
    /** The renderer's open handler is mounted. */
    markReady() { ready = true; flush(); },
    /** The renderer navigated/reloaded/crashed: hold paths until it signals again. */
    markNotReady() { ready = false; },
    isReady() { return ready; },
    pending() { return pending.slice(); },
  };
}

module.exports = { createOpenQueue, READY_CHANNEL, OPEN_CHANNEL };

"""
AF-IO-008 — test-only bench helpers.

PymodbusBenchServer wraps pymodbus's OWN TCP server (a test-only dependency) so the
suite can cross-validate engine/modbus_client.py against an implementation that is
not ours. That is the whole value: our ScriptedModbusServer (test_modbus_client.py)
shares no code with the client but could still share a misreading of the spec; a
second, independent implementation cannot.

pymodbus 3.13 note, learned the hard way: the deprecated ModbusDeviceContext shim
serves the hr= block for FC04 and the ir= block for FC03 — swapped. The new
SimData/SimDevice API (used here, block order co/di/hr/ir) maps correctly. Do not
"simplify" this back to the deprecated context.

This module lives in tests/ so pymodbus can never leak into runtime code or the
PyInstaller bundle.
"""
from __future__ import annotations

import asyncio


class PymodbusBenchServer:
    """pymodbus-backed Modbus TCP server on 127.0.0.1:<ephemeral>.

    Stores: 20 coils, 8 discrete inputs, 20 holding registers, 20 input registers,
    all zero unless overridden via the constructor lists.
    """

    def __init__(self, *, di=None, hr=None, ir=None):
        self._di = list(di) if di is not None else [False] * 8
        self._hr = list(hr) if hr is not None else [0] * 20
        self._ir = list(ir) if ir is not None else [0] * 20
        self._server = None
        self._task = None
        self.port = None

    async def start(self):
        from pymodbus.server import ModbusTcpServer
        from pymodbus.simulator import SimData, SimDevice
        from pymodbus.simulator.simdata import DataType

        co = [SimData(0, count=20, values=False, datatype=DataType.BITS)]
        di = [SimData(0, count=len(self._di), values=self._di, datatype=DataType.BITS)]
        hr = [SimData(0, count=len(self._hr), values=self._hr, datatype=DataType.REGISTERS)]
        ir = [SimData(0, count=len(self._ir), values=self._ir, datatype=DataType.REGISTERS)]
        device = SimDevice(id=0, simdata=(co, di, hr, ir))
        self._server = ModbusTcpServer(device, address=("127.0.0.1", 0))
        self._task = asyncio.create_task(self._server.serve_forever())
        # serve_forever binds asynchronously; wait for the transport to appear.
        for _ in range(100):
            transport = getattr(self._server, "transport", None)
            if transport is not None:
                self.port = transport.sockets[0].getsockname()[1]
                return
            await asyncio.sleep(0.05)
        raise RuntimeError("pymodbus server did not bind")

    async def stop(self):
        if self._server is not None:
            await self._server.shutdown()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

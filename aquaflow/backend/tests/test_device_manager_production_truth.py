import asyncio

from engine.device_manager import DeviceManager


def test_device_manager_does_not_seed_fictional_online_devices(monkeypatch):
    monkeypatch.delenv("AQUAFLOW_DEMO_DEVICES", raising=False)
    async def run():
        manager = DeviceManager()
        await manager.start()
        try:
            assert manager.get_all_devices() == []
            assert manager.get_summary() == {"total": 0, "online": 0, "offline": 0, "warn": 0}
        finally:
            await manager.stop()
            await asyncio.sleep(0)
    asyncio.run(run())


def test_demo_devices_require_explicit_environment_flag(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_DEMO_DEVICES", "1")
    async def run():
        manager = DeviceManager()
        await manager.start()
        try:
            assert len(manager.get_all_devices()) > 0
        finally:
            await manager.stop()
            await asyncio.sleep(0)
    asyncio.run(run())


def test_generic_registry_never_claims_an_unrouted_command_was_sent(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_DEMO_DEVICES", "1")

    async def run():
        manager = DeviceManager()
        await manager.start()
        try:
            result = await manager.send_command("pump-01", {"command": "start"})
            assert result["success"] is False
            assert "No verified runtime route" in result["error"]
        finally:
            await manager.stop()
            await asyncio.sleep(0)

    asyncio.run(run())

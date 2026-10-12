"""Official TIA Portal Openness orchestration for Siemens engineering.

This module never substitutes S7 reads/writes for Siemens engineering.  It invokes a
separately built .NET Framework bridge against the matching Siemens.Engineering.dll.
The persisted state makes "source generated", "TIA project generated", "compiled" and
"downloaded" different, reviewable facts.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile

from engine.siemens_site import signature
from engine.siemens_hardware import supported_s7_1200_identifier
from services.siemens_tia_package import build_tia_package


class OpennessError(ValueError):
    pass


def _utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


class OpennessBridge:
    def __init__(self, executable=None, timeout=900):
        self.executable = Path(executable) if executable else self._find_bridge()
        self.timeout = timeout

    @staticmethod
    def _find_bridge():
        candidates = []
        if os.getenv("AQUAFLOW_TIA_BRIDGE"):
            candidates.append(Path(os.environ["AQUAFLOW_TIA_BRIDGE"]))
        roots = [Path(__file__).resolve().parents[2]]
        if getattr(sys, "_MEIPASS", None):
            roots.insert(0, Path(sys._MEIPASS))
        roots += [Path(sys.executable).resolve().parent, Path(sys.executable).resolve().parent.parent]
        for root in roots:
            candidates += [root / "tia-openness-bridge" / "AquaFlow.TiaBridge.exe",
                           root / "tools" / "tia-openness-bridge" / "bin" / "Release" / "AquaFlow.TiaBridge.exe"]
        return next((p for p in candidates if p.is_file()), None)

    @staticmethod
    def installed_public_apis():
        found = []
        for base in (Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
                     Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))):
            automation = base / "Siemens" / "Automation"
            if not automation.is_dir():
                continue
            for dll in automation.glob("Portal V*/PublicAPI/V*/Siemens.Engineering.dll"):
                version = dll.parent.name.lstrip("Vv")
                found.append({"version": version, "assembly": str(dll.resolve())})
        return sorted(found, key=lambda x: x["version"])

    @staticmethod
    def user_in_group():
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(["whoami", "/groups"], capture_output=True, text=True,
                                    timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return "siemens tia openness" in (result.stdout + result.stderr).lower()
        except (OSError, subprocess.SubprocessError):
            return False

    def status(self):
        apis = self.installed_public_apis()
        result = {
            "platform": sys.platform,
            "bridge": str(self.executable) if self.executable else None,
            "bridge_present": bool(self.executable and self.executable.is_file()),
            "public_apis": apis,
            "openness_group_member": self.user_in_group(),
            "available": False,
            "capabilities": {"project": False, "compile": False, "download": False, "diagnostics": False},
            "requirements": [],
        }
        if os.name != "nt":
            result["requirements"].append("TIA Portal Openness is supported on Windows")
        if not apis:
            result["requirements"].append("Install licensed STEP 7/TIA Portal and matching TIA Portal Openness")
        if not result["openness_group_member"]:
            result["requirements"].append("Add this Windows user to the local 'Siemens TIA Openness' group, then sign in again")
        if not result["bridge_present"]:
            result["requirements"].append("Build/install the AquaFlow TIA bridge against the matching Siemens PublicAPI")
        if result["bridge_present"] and apis:
            try:
                bridge = self.run({"operation": "status"}, timeout=30)
                result["bridge_report"] = bridge
                result["capabilities"].update(bridge.get("capabilities", {}))
                result["supported_tia_versions"] = bridge.get("supported_tia_versions", [])
                result["available"] = bool(bridge.get("ok")) and result["openness_group_member"]
            except OpennessError as exc:
                result["requirements"].append(str(exc))
        return result

    def run(self, request, timeout=None):
        if not self.executable or not self.executable.is_file():
            raise OpennessError("AquaFlow TIA bridge is not installed")
        work = Path(tempfile.mkdtemp(prefix="aquaflow-tia-request-"))
        request_file, response_file = work / "request.json", work / "response.json"
        try:
            request_file.write_text(json.dumps(request), encoding="utf-8")
            completed = subprocess.run([str(self.executable), "--request", str(request_file), "--response", str(response_file)],
                                       capture_output=True, text=True, timeout=timeout or self.timeout,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if not response_file.is_file():
                detail = (completed.stderr or completed.stdout or f"exit {completed.returncode}").strip()
                raise OpennessError(f"TIA bridge did not return a result: {detail[:1000]}")
            result = json.loads(response_file.read_text(encoding="utf-8"))
            if completed.returncode or not result.get("ok"):
                raise OpennessError(result.get("error") or "TIA Portal Openness operation failed")
            return result
        except subprocess.TimeoutExpired as exc:
            raise OpennessError("TIA Portal Openness operation timed out") from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise OpennessError(f"TIA bridge failed: {exc}") from exc
        finally:
            shutil.rmtree(work, ignore_errors=True)


class SiemensEngineeringService:
    def __init__(self, site_store, data_dir, bridge=None):
        self.sites = site_store
        self.root = Path(data_dir) / "siemens_engineering"
        self.state_file = self.root / "state.json"
        self.bridge = bridge or OpennessBridge()
        self.lock = threading.Lock()

    def _load(self):
        if not self.state_file.is_file():
            return {"version": 1, "sites": {}}
        return json.loads(self.state_file.read_text(encoding="utf-8"))

    def _save(self, data):
        self.root.mkdir(parents=True, exist_ok=True)
        pending = self.state_file.with_suffix(".pending")
        pending.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(pending, self.state_file)

    def status(self, sid=None):
        result = self.bridge.status()
        if sid:
            site = self.sites.get(sid)
            record = self._load()["sites"].get(sid)
            result["engineering"] = copy.deepcopy(record)
            result["current_signature"] = f"{signature(site):08X}"
            result["current_revision"] = site["revision"]
            result["current"] = bool(record and record.get("source_signature") == result["current_signature"] and
                                     record.get("source_revision") == site["revision"])
            result["cpu_compatibility"] = {
                "supported": supported_s7_1200_identifier(site["tia"]["cpu_type_identifier"]),
                "scope": "classic standard S7-1200 hardware-40 / V4 CPUs; excludes G2, F and unknown catalog revisions",
            }
        return result

    def _require_bridge(self, site, capability):
        status = self.bridge.status()
        if not status.get("available"):
            detail = "; ".join(status.get("requirements", [])) or "TIA Portal Openness is unavailable"
            raise OpennessError(detail)
        if not status.get("capabilities", {}).get(capability):
            raise OpennessError(f"The installed AquaFlow TIA bridge does not support {capability}")
        versions = status.get("supported_tia_versions")
        if versions is None:
            versions = status.get("bridge_report", {}).get("supported_tia_versions", [])
        normalized = {int(version) for version in versions if str(version).isdigit()}
        if normalized and int(site["tia"]["version"]) not in normalized:
            actual = ", ".join(f"V{version}" for version in sorted(normalized))
            raise OpennessError(
                f"Selected TIA Portal V{site['tia']['version']} does not match the bridge PublicAPI ({actual}); "
                "build the bridge against the selected installed TIA release"
            )

    def _workspace(self, sid):
        path = (self.root / "sites" / sid).resolve()
        expected = (self.root / "sites").resolve()
        if expected not in path.parents:
            raise OpennessError("Invalid Siemens site workspace")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _record_result(self, site, stage, result, project_path=None):
        data = self._load()
        previous = data["sites"].get(site["id"], {})
        record = {
            "site_id": site["id"], "source_revision": site["revision"],
            "source_signature": f"{signature(site):08X}", "stage": stage,
            "project_path": project_path or previous.get("project_path"),
            "tia_version": site["tia"]["version"], "updated_at": _utc(),
            "diagnostics": result.get("diagnostics", []), "bridge": result.get("bridge"),
        }
        for key in ("state", "error_count", "warning_count", "program_validation",
                    "pre_download_compile_state", "pre_download_compile_errors"):
            if key in result:
                record[key] = copy.deepcopy(result[key])
        if stage == "compiled":
            record["compiled_at"] = record["updated_at"]
        if stage == "downloaded":
            record["compiled_at"] = previous.get("compiled_at")
            record["downloaded_at"] = record["updated_at"]
            record["target"] = site["plc"]["ip"]
        data["sites"][site["id"]] = record
        self._save(data)
        return record

    def generate_project(self, sid, revision):
        with self.lock:
            site = self.sites.get(sid)
            if site["revision"] != revision:
                raise OpennessError("Site changed; reload before generating the TIA project")
            if not site["tia"]["cpu_type_identifier"]:
                raise OpennessError("Copy the exact CPU TypeIdentifier from the installed TIA hardware catalog first")
            if not supported_s7_1200_identifier(site["tia"]["cpu_type_identifier"]):
                raise OpennessError(
                    "This engineering workflow is limited to standard S7-1200 CPU TypeIdentifiers "
                    "(classic hardware-40 / V4 catalog entries); G2, F and other revisions/families require separate validation"
                )
            self._require_bridge(site, "project")
            workspace = self._workspace(sid)
            sources = workspace / "sources"
            if sources.exists():
                shutil.rmtree(sources)
            sources.mkdir()
            with zipfile.ZipFile(__import__("io").BytesIO(build_tia_package(site))) as package:
                allowed = {"AquaFlowSiteIO.db", "AquaFlowSiteControl.scl", "AquaFlowCycle.scl",
                           "cyclic-call.txt",
                           "cyclic-ob-requirement.json",
                           "IO-schedule.csv", "site.json", "README.txt"}
                for member in package.infolist():
                    if member.filename in allowed:
                        (sources / member.filename).write_bytes(package.read(member))
            project_dir = workspace / f"project-r{site['revision']}-{uuid.uuid4().hex[:8]}"
            request = {"operation": "generate", "tia_version": site["tia"]["version"],
                       "project_dir": str(project_dir), "sources_dir": str(sources),
                       "project_name": site["tia"]["project_name"], "device_name": site["tia"]["device_name"],
                       "cpu_name": site["tia"]["cpu_name"],
                       "cpu_type_identifier": site["tia"]["cpu_type_identifier"],
                       "modules": site["tia"]["modules"], "db_number": site["plc"]["db"]}
            result = self.bridge.run(request)
            return self._record_result(site, "project_generated", result, result.get("project_path"))

    def compile_project(self, sid, revision):
        with self.lock:
            site, record = self._current_record(sid, revision, "project_generated")
            self._require_bridge(site, "compile")
            result = self.bridge.run({"operation": "compile", "tia_version": site["tia"]["version"],
                                       "project_path": record["project_path"],
                                       "device_name": site["tia"]["device_name"], "cpu_name": site["tia"]["cpu_name"],
                                       "cpu_type_identifier": site["tia"]["cpu_type_identifier"],
                                       "db_number": site["plc"]["db"]})
            if int(result.get("error_count", 0)) or "error" in str(result.get("state", "")).lower():
                raise OpennessError(f"TIA compilation returned {result['error_count']} error(s)")
            return self._record_result(site, "compiled", result, record["project_path"])

    def download(self, sid, revision, confirmation, cpu_stop_acknowledged,
                 target_hardware_confirmed=False, memory_reinitialization_confirmed=False, password=""):
        with self.lock:
            site, record = self._current_record(sid, revision, "compiled")
            self._require_bridge(site, "download")
            if site["mode"] != "physical":
                raise OpennessError("Switch the saved site to physical mode before PLC download")
            expected = f"DOWNLOAD {site['name']}"
            if confirmation != expected:
                raise OpennessError(f"Type exactly: {expected}")
            if not cpu_stop_acknowledged:
                raise OpennessError("Confirm that TIA may place the CPU in STOP and outputs are secured")
            if not target_hardware_confirmed:
                raise OpennessError("Confirm the physical CPU order number/firmware and module layout against the cabinet")
            request = {"operation": "download", "tia_version": site["tia"]["version"],
                        "project_path": record["project_path"], "device_name": site["tia"]["device_name"],
                        "cpu_name": site["tia"]["cpu_name"],
                        "cpu_type_identifier": site["tia"]["cpu_type_identifier"],
                        "target_ip": site["plc"]["ip"], "network_interface": site["tia"]["network_interface"],
                        "db_number": site["plc"]["db"],
                       "password": password, "start_after_download": False,
                       "target_hardware_confirmed": target_hardware_confirmed,
                       "memory_reinitialization_confirmed": memory_reinitialization_confirmed,
                       "source_signature": record["source_signature"]}
            result = self.bridge.run(request)
            return self._record_result(site, "downloaded", result, record["project_path"])

    def diagnostics(self, sid, revision):
        site, record = self._current_record(sid, revision, "project_generated")
        self._require_bridge(site, "diagnostics")
        return self.bridge.run({"operation": "diagnostics", "tia_version": site["tia"]["version"],
                                "project_path": record["project_path"],
                                "device_name": site["tia"]["device_name"], "cpu_name": site["tia"]["cpu_name"],
                                "cpu_type_identifier": site["tia"]["cpu_type_identifier"],
                                "target_ip": site["plc"]["ip"],
                                "network_interface": site["tia"]["network_interface"]})

    def _current_record(self, sid, revision, minimum_stage):
        site = self.sites.get(sid)
        if site["revision"] != revision:
            raise OpennessError("Site changed; reload and regenerate before this operation")
        record = self._load()["sites"].get(sid)
        order = {"project_generated": 1, "compiled": 2, "downloaded": 3}
        if (not record or record.get("source_signature") != f"{signature(site):08X}" or
                record.get("source_revision") != revision or order.get(record.get("stage"), 0) < order[minimum_stage]):
            raise OpennessError(f"A current {minimum_stage.replace('_', ' ')} result is required")
        if not record.get("project_path"):
            raise OpennessError("The TIA project path is missing")
        return site, record

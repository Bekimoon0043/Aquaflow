"""Export a new offline starter; never touches saved sites or a PLC connection."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from engine.siemens_site import create_1212c_starter
from services.siemens_tia_package import build_tia_package
from services.siemens_readiness import commissioning_readiness


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New output directory (must not already exist)")
    args = parser.parse_args()
    site = create_1212c_starter()
    package = build_tia_package(site)
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "CPU-1212C-simulation-TIA-package.zip").write_bytes(package)
    (args.output / "commissioning-readiness.json").write_text(
        json.dumps(commissioning_readiness(site), indent=2), encoding="utf-8")
    print(f"Exported simulation-only site {site['id']} to {args.output.resolve()}")


if __name__ == "__main__":
    main()

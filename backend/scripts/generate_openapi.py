"""Generate or verify the checked-in FastAPI OpenAPI contract."""

import argparse
import os
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
OPENAPI_PATH = REPO_ROOT / "docs" / "api" / "openapi.yaml"


def _schema_text() -> str:
    """Build the schema without reading or recovering real runtime sessions."""
    # Import-time stores require an existing directory. Point them at this
    # source-only directory so schema generation cannot recover real tasks.
    isolated_runtime = BACKEND_ROOT / "scripts"
    os.environ["SESSIONS_DIR"] = str(isolated_runtime)
    os.environ["FILE_LIBRARY_DIR"] = str(isolated_runtime)
    os.environ["PROTEIN_DATABASE_DIR"] = str(isolated_runtime)
    os.environ["REPORTS_DIR"] = str(isolated_runtime)
    os.chdir(REPO_ROOT)
    sys.path.insert(0, str(BACKEND_ROOT))

    from app.main import app

    return yaml.safe_dump(
        app.openapi(),
        sort_keys=False,
        allow_unicode=True,
        width=100,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero when the checked-in contract differs from FastAPI.",
    )
    args = parser.parse_args()
    generated = _schema_text()

    if args.check:
        current = OPENAPI_PATH.read_text(encoding="utf-8")
        if current != generated:
            print(
                "OpenAPI contract is stale. Run "
                "`python backend/scripts/generate_openapi.py`.",
                file=sys.stderr,
            )
            return 1
        return 0

    OPENAPI_PATH.write_text(generated, encoding="utf-8", newline="\n")
    print(f"Wrote {OPENAPI_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

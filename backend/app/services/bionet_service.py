"""BioNet service — INDRA subnetwork analysis via MSstatsBioNet."""

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import pandas as pd

from app.core.config import settings

logger = logging.getLogger("proteomics")


class BioNetService:
    """Orchestrates the R subprocess call for MSstatsBioNet INDRA analysis."""

    def __init__(self) -> None:
        self._rscript = settings.r_executable or "Rscript"

    def run_bionet(
        self,
        de_file: Path,
        config: dict,
        nodes_csv: Path,
        edges_csv: Path,
    ) -> tuple[int, int]:
        """
        Run the full BioNet pipeline.

        Returns (node_count, edge_count) on success.
        Raises subprocess.CalledProcessError or RuntimeError on failure.
        """
        # 1. Read DE file
        df = pd.read_csv(de_file, sep="\t")

        # 2. Pre-filter by |logFC|
        logfc_cutoff = config.get("logfc_cutoff", 0.5)
        if "logFC" in df.columns:
            df = df[df["logFC"].abs() > logfc_cutoff]

        if len(df) == 0:
            raise RuntimeError("No proteins pass the |logFC| cutoff")

        if len(df) >= 400:
            raise RuntimeError(
                f"{len(df)} proteins exceed INDRA limit of 400. "
                "Tighten p-value or |logFC| cutoff."
            )

        # 3. Write input TSV and config JSON to temp files
        with tempfile.TemporaryDirectory(prefix="bionet_") as tmpdir:
            tmp = Path(tmpdir)
            input_tsv = tmp / "input.tsv"
            config_json = tmp / "config.json"

            df.to_csv(input_tsv, sep="\t", index=False)
            with open(config_json, "w") as f:
                json.dump(config, f, default=str)

            # 4. Resolve script path
            script = (
                Path(__file__).resolve().parent.parent.parent
                / "scripts" / "bionet_network.R"
            )

            # 5. Run R script
            cmd = [
                self._rscript,
                str(script),
                str(input_tsv),
                str(config_json),
                str(nodes_csv),
                str(edges_csv),
            ]

            env = os.environ.copy()
            env.setdefault(
                "R_LIBS_USER",
                str(Path.home() / "R" / "win-library" / "4.5"),
            )
            env.setdefault("R_LIBS_SITE", "")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=settings.r_script_timeout,
                env=env,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip()
                raise subprocess.CalledProcessError(
                    result.returncode,
                    cmd,
                    output=result.stdout,
                    stderr=result.stderr,
                )

            logger.info("BioNet R script output: %s", result.stdout.strip())

        # 6. Parse nodes CSV to count
        nodes_df = pd.read_csv(nodes_csv)
        edges_df = pd.read_csv(edges_csv)
        return len(nodes_df), len(edges_df)


# Singleton
bionet_service = BioNetService()

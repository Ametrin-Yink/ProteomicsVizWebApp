"""Step 1 (PTM): Prepare PTM enrichment data — validate inputs, detect modification types, generate annotation CSV."""

import csv
import os
import re

from app.db.session_store import SessionStore
from app.services.pipeline_engine import StepContext


async def step_ptm_prepare_data(ctx: StepContext) -> None:
    """Validate PTM enrichment files, auto-detect modification types, generate annotation CSV.

    This is the first step of the PTM pipeline. It ensures all required inputs are
    present and valid, detects which modification types are present in the data,
    and writes the annotation CSV used by downstream MSstatsPTM steps.

    Args:
        ctx: Pipeline step context with config, file_paths, session_id, results_dir.

    Raises:
        ValueError: If required files are missing, CSV columns are invalid, or
            FASTA file cannot be found on disk.
    """
    store = SessionStore()
    session = await store.get(ctx.session_id)

    # --- PTM enrichment files ---
    # ctx.file_paths is a list of Path objects for PTM enrichment CSV files
    ptm_files = list(ctx.file_paths)

    if not ptm_files:
        raise ValueError("At least one PTM enrichment file is required")

    for f in ptm_files:
        if not str(f).lower().endswith(".csv"):
            raise ValueError(f"PTM enrichment file must be a CSV: {f}")

    # --- Auto-detect modification types ---
    # Read the first PTM file and scan the Modifications column for modification
    # patterns like "Phospho [S5]" or "Acetyl [K]; Ubiquitinyl [K]"
    first_file = ptm_files[0]
    detected_mods: set[str] = set()

    with open(str(first_file), newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if "Modifications" not in (reader.fieldnames or []):
            raise ValueError(
                "PTM enrichment file is missing the required 'Modifications' column"
            )
        for row in reader:
            mods = row.get("Modifications", "")
            if mods:
                # Extract modification names before brackets, e.g. "Phospho" from "Phospho [S5]"
                found = re.findall(r"([A-Za-z]+)\s*\[", mods)
                detected_mods.update(found)

    sorted_mods = sorted(detected_mods)
    ctx.step_outputs["detected_mods"] = sorted_mods

    # Determine mod IDs: configured values take priority, fall back to detected,
    # then default to Phospho
    if ctx.config.ptm_mod_ids:
        mod_ids = ctx.config.ptm_mod_ids
    elif sorted_mods:
        mod_ids = [sorted_mods[0]]
    else:
        mod_ids = ["Phospho"]

    # --- Validate FASTA file ---
    # FASTA is loaded from the session's uploaded files
    if not session.files.fasta:
        raise ValueError("FASTA file is required for PTM analysis")
    fasta_path = ctx.uploads_dir / session.files.fasta[0].filename
    if not os.path.exists(str(fasta_path)):
        raise ValueError(f"FASTA file not found on disk: {fasta_path}")

    # --- Validate optional global proteome files ---
    gp_paths: list = []
    for f_info in session.files.global_proteome:
        gp_path = ctx.uploads_dir / f_info.filename
        if not os.path.exists(str(gp_path)):
            raise ValueError(f"Global proteome file not found on disk: {gp_path}")
        gp_paths.append(gp_path)

    # --- Generate annotation CSV ---
    # Write Run / Condition / BioReplicate columns from the analysis config metadata
    metadata = ctx.config.metadata or {}
    annotation_path = ctx.results_dir / "annotation.csv"
    with open(str(annotation_path), "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Run", "Condition", "BioReplicate"])
        for run_name, cols in metadata.items():
            writer.writerow([
                run_name,
                cols.get("Condition", ""),
                cols.get("BioReplicate", ""),
            ])

    # --- Store outputs for downstream steps ---
    ctx.step_outputs["annotation_csv"] = annotation_path
    ctx.step_outputs["ptm_input_path"] = ptm_files
    ctx.step_outputs["fasta_path"] = fasta_path
    ctx.step_outputs["protein_input_path"] = gp_paths
    ctx.step_outputs["mod_ids"] = mod_ids

    ctx.state.add_log("info", "PTM data preparation complete")
    ctx.step_outputs["ready"] = True

"""Scientific helpers for real Proteome Discoverer TMT PTM data."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd

from app.utils.file_parser import (
    detect_delimiter,
    detect_tmt_channels,
    read_file_columns,
)


@dataclass(frozen=True)
class SiteAssignment:
    site_token: str
    display_label: str
    localization_status: str
    mapping_status: str
    peptide_positions: tuple[str, ...]
    protein_positions: tuple[str, ...]
    scores: tuple[float, ...]


@dataclass(frozen=True)
class BackgroundNormalization:
    applied: bool
    complete_feature_count: int
    channel_factors: dict[str, float]
    warning: str | None = None
    method: str = "background_peptide"


def extract_peptide_sequence(annotated_sequence: str) -> str:
    """Extract the unflanked uppercase peptide sequence from a PD value."""
    value = str(annotated_sequence or "")
    parts = value.split(".")
    peptide = parts[1] if len(parts) >= 3 else value
    return re.sub(r"[^A-Za-z]", "", peptide).upper()


def parse_modification_sites(
    modifications: str, target_modification: str
) -> list[tuple[str, int]]:
    """Parse peptide-local sites assigned to one exact PD modification name."""
    sites: list[tuple[str, int]] = []
    for token in str(modifications or "").split(";"):
        match = re.match(r"^\s*([A-Za-z-]+)(\d+)?\(([^()]+)\)\s*$", token)
        if not match or match.group(3).strip() != target_modification:
            continue
        residue, position = match.group(1), match.group(2)
        if position is not None:
            sites.append((residue[-1].upper(), int(position)))
        elif residue.lower() in {"n-term", "nterm"}:
            sites.append(("N-term", 1))
        elif residue.lower() in {"c-term", "cterm"}:
            sites.append(("C-term", -1))
    return sites


def parse_localization_scores(
    localization: str, target_modification: str
) -> list[tuple[str, int, float]]:
    """Parse ptmRS or CHIMERYS per-site probabilities for one modification."""
    scores: list[tuple[str, int, float]] = []
    for token in str(localization or "").split(";"):
        match = re.match(
            r"^\s*([A-Za-z]+)(\d+)\(([^()]+)\)\s*:\s*([0-9.]+)\s*$",
            token,
        )
        if not match or match.group(3).strip() != target_modification:
            continue
        scores.append(
            (match.group(1)[-1].upper(), int(match.group(2)), float(match.group(4)))
        )
    return scores


def _peptide_starts(protein_sequence: str, peptide: str) -> list[int]:
    starts: list[int] = []
    offset = 0
    while peptide and (index := protein_sequence.find(peptide, offset)) >= 0:
        starts.append(index)
        offset = index + 1
    return starts


def build_site_assignment(
    *,
    accession: str,
    peptide: str,
    target_sites: list[tuple[str, int]],
    localization_scores: list[tuple[str, int, float]],
    protein_sequence: str | None,
    target_modification: str,
    localization_cutoff: float = 75.0,
) -> SiteAssignment:
    """Build one non-duplicating site or candidate-site feature."""
    del target_modification  # exact matching occurred before this boundary
    target_count = max(1, len(target_sites))
    confident = [item for item in localization_scores if item[2] >= localization_cutoff]
    if localization_scores and len(confident) >= target_count:
        chosen = sorted(confident, key=lambda item: (-item[2], item[1]))[:target_count]
        local_sites = [(residue, position) for residue, position, _ in chosen]
        localization_status = "Confident"
    elif localization_scores:
        local_sites = [
            (residue, position) for residue, position, _ in localization_scores
        ]
        localization_status = "Ambiguous"
    else:
        local_sites = list(target_sites)
        localization_status = "Unscored"

    if not local_sites:
        local_sites = [("?", 0)]

    starts = _peptide_starts(str(protein_sequence or "").upper(), peptide.upper())
    peptide_labels = tuple(
        "N-term" if pos == 1 and residue == "N-term" else f"{residue}{pos}"
        for residue, pos in local_sites
    )
    mapped: list[str] = []
    for start in starts:
        for residue, position in local_sites:
            if position <= 0:
                continue
            mapped.append(f"{residue}{start + position}")
    mapped = sorted(
        set(mapped), key=lambda value: (int(re.sub(r"\D", "", value) or 0), value)
    )

    if not mapped:
        local = "|".join(peptide_labels)
        token = f"peptide_{local}_unmapped"
        display = f"{accession} · peptide {local} · FASTA-unmapped"
        mapping_status = "FASTA-unmapped"
    else:
        is_candidate = localization_status == "Ambiguous" or len(starts) > 1
        if is_candidate:
            joined = "|".join(mapped)
            token = f"candidate_{joined}"
            noun = "position" if len(mapped) == 1 else "positions"
            display = f"{accession} · candidate {noun} {joined}"
            mapping_status = "Candidate positions"
        else:
            joined = "+".join(mapped)
            token = joined
            display = f"{accession} · {joined}"
            mapping_status = "FASTA mapped"

    return SiteAssignment(
        site_token=token,
        display_label=display,
        localization_status=localization_status,
        mapping_status=mapping_status,
        peptide_positions=peptide_labels,
        protein_positions=tuple(mapped),
        scores=tuple(score for _, _, score in localization_scores),
    )


def apply_background_normalization(
    target: pd.DataFrame,
    background: pd.DataFrame,
    *,
    sample_channels: list[str],
    minimum_features: int = 50,
) -> tuple[pd.DataFrame, BackgroundNormalization]:
    """Apply median-log2 channel factors from complete target-negative peptides."""
    normalized = target.copy()
    normalized["NormalizedAbundance"] = normalized["Abundance"].astype(float)
    if not sample_channels:
        return normalized, BackgroundNormalization(False, 0, {}, "No Sample channels")

    grouped = background.groupby(
        ["PeptideSequence", "Charge", "Channel"], as_index=False
    )["Abundance"].sum()
    pivot = grouped.pivot_table(
        index=["PeptideSequence", "Charge"],
        columns="Channel",
        values="Abundance",
        aggfunc="sum",
    )
    available = [channel for channel in sample_channels if channel in pivot.columns]
    complete = (
        pivot[available].dropna()
        if len(available) == len(sample_channels)
        else pivot.iloc[0:0]
    )
    count = len(complete)
    if count < minimum_features:
        warning = (
            f"Background normalization skipped: {count} complete features; "
            f"at least {minimum_features} required"
        )
        return normalized, BackgroundNormalization(False, count, {}, warning)

    log_medians = np.log2(complete.astype(float)).median(axis=0)
    center = float(log_medians.median())
    factors = {
        channel: float(2 ** (value - center)) for channel, value in log_medians.items()
    }
    channel_factors = normalized["Channel"].astype(str).map(factors).fillna(1.0)
    normalized["NormalizedAbundance"] = (
        normalized["Abundance"].astype(float) / channel_factors
    )
    return normalized, BackgroundNormalization(True, count, factors)


def apply_centered_median_normalization(
    target: pd.DataFrame,
    *,
    sample_channels: list[str],
) -> tuple[pd.DataFrame, BackgroundNormalization]:
    """Equalize reporter-channel medians across target PTM feature abundances."""
    normalized = target.copy()
    normalized["NormalizedAbundance"] = normalized["Abundance"].astype(float)
    if not sample_channels:
        return normalized, BackgroundNormalization(
            False,
            0,
            {},
            "No Sample channels",
            "centered_median",
        )

    usable = normalized[
        normalized["Channel"].astype(str).isin(sample_channels)
        & pd.to_numeric(normalized["Abundance"], errors="coerce").gt(0)
    ].copy()
    usable["Log2Abundance"] = np.log2(usable["Abundance"].astype(float))
    log_medians = usable.groupby(usable["Channel"].astype(str))[
        "Log2Abundance"
    ].median()
    if any(channel not in log_medians.index for channel in sample_channels):
        return normalized, BackgroundNormalization(
            False,
            len(usable),
            {},
            "Centered median normalization skipped: one or more Sample channels have no positive values",
            "centered_median",
        )

    center = float(log_medians.loc[sample_channels].median())
    factors = {
        channel: float(2 ** (float(log_medians.loc[channel]) - center))
        for channel in sample_channels
    }
    channel_factors = normalized["Channel"].astype(str).map(factors).fillna(1.0)
    normalized["NormalizedAbundance"] = (
        normalized["Abundance"].astype(float) / channel_factors
    )
    return normalized, BackgroundNormalization(
        True,
        len(usable),
        factors,
        method="centered_median",
    )


def site_passes_coverage(
    observed: dict[str, set[str]],
    expected: dict[str, set[str]],
    *,
    max_missing_fraction: float,
) -> bool:
    """Return true when every expected condition meets its coverage minimum."""
    for condition, channels in expected.items():
        required = math.ceil((1 - max_missing_fraction) * len(channels))
        if len(observed.get(condition, set()) & channels) < required:
            return False
    return True


def _sql_quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _sql_string(value: str) -> str:
    return value.replace("'", "''")


def _mapping_frame(mapping: dict[str, dict[str, str | int]]) -> pd.DataFrame:
    rows = []
    seen_channels: set[str] = set()
    ignored = {"replicate", "role", "channel_role"}
    for mapping_key, values in mapping.items():
        channel = str(mapping_key).rsplit("::", 1)[-1]
        if channel in seen_channels:
            raise ValueError(f"Reporter channel {channel} has duplicate metadata")
        seen_channels.add(channel)
        role = str(values.get("role", values.get("channel_role", "Sample")))
        group_keys = sorted(key for key in values if key not in ignored)
        if not group_keys:
            raise ValueError(f"Channel {channel} has no condition metadata")
        condition = "_".join(str(values[key]) for key in group_keys)
        replicate = int(values.get("replicate", 1))
        if role.lower() in {"reference", "reference/bridge", "bridge", "norm"}:
            condition = "Norm"
        rows.append(
            {
                "Channel": str(channel),
                "Condition": condition,
                "Replicate": replicate,
                "Role": role,
                "BioReplicate": f"{condition}_{replicate}",
            }
        )
    return pd.DataFrame(rows)


def prepare_pd_tmt_long(
    input_path: Path,
    output_path: Path,
    channel_mapping: dict[str, dict[str, str | int]],
    *,
    role: str,
) -> dict[str, int]:
    """Filter and melt one PD TMT export into a canonical long Parquet file."""
    columns = read_file_columns(input_path)
    sequence_column = "Sequence" if "Sequence" in columns else "Annotated Sequence"
    abundance_columns = [column for column in columns if detect_tmt_channels([column])]
    detected_channels = detect_tmt_channels(columns)
    metadata_channels = {str(key).rsplit("::", 1)[-1] for key in channel_mapping}
    if set(detected_channels) != metadata_channels:
        raise ValueError(
            f"Reporter channels in {input_path.name} do not match metadata: "
            f"file={detected_channels}, metadata={sorted(metadata_channels)}"
        )
    required = {
        sequence_column,
        "Modifications",
        "Charge",
        "Contaminant",
        "Master Protein Accessions",
        "Average Reporter SN",
    }
    if role == "ptm":
        required.add("Isolation Interference in Percent")
    elif role == "protein":
        required.add("Normalized CHIMERYS Coefficient")
    else:
        raise ValueError(f"Unknown PTM TMT input role: {role}")
    missing = sorted(required - set(columns))
    if missing:
        raise ValueError(
            f"Missing required {role} columns in {input_path.name}: {missing}"
        )

    delimiter = detect_delimiter(input_path)
    delimiter_sql = "\\t" if delimiter == "\t" else ","
    input_sql = _sql_string(input_path.as_posix())
    output_sql = _sql_string(output_path.as_posix())
    mapping = _mapping_frame(channel_mapping)

    filters = [
        "(\"Contaminant\" IS NULL OR UPPER(TRIM(\"Contaminant\")) NOT IN ('TRUE', '+'))",
        '("Master Protein Accessions" IS NOT NULL AND TRIM("Master Protein Accessions") != \'\')',
        'TRY_CAST("Average Reporter SN" AS DOUBLE) >= 5',
    ]
    if role == "ptm":
        filters.append('TRY_CAST("Isolation Interference in Percent" AS DOUBLE) <= 50')
    else:
        filters.append('TRY_CAST("Normalized CHIMERYS Coefficient" AS DOUBLE) >= 0.8')
    if "Reverse" in columns:
        filters.append("(Reverse IS NULL OR UPPER(TRIM(Reverse)) NOT IN ('TRUE', '+'))")
    if "Quan Info" in columns:
        filters.append(
            '("Quan Info" IS NULL OR UPPER(TRIM("Quan Info")) != \'NO VALUE\')'
        )
    where_clause = " AND ".join(filters)

    original_select = []
    for column in columns:
        if column in abundance_columns:
            continue
        if column in {"Sequence", "Annotated Sequence"}:
            if column != sequence_column:
                continue
            alias = "Annotated_Sequence"
        else:
            alias = column.replace(" ", "_")
        original_select.append(f"r.{_sql_quote(column)} AS {_sql_quote(alias)}")
    original_sql = ",\n                    ".join(original_select)
    abundance_regex = r"Abundance\s+\d+[NC]?"
    sequence_sql = f"r.{_sql_quote(sequence_column)}"

    con = duckdb.connect()
    try:
        con.register("channel_mapping_df", mapping)
        con.execute("CREATE TABLE channel_mapping AS SELECT * FROM channel_mapping_df")
        raw_reader = (
            f"read_csv('{input_sql}', delim='{delimiter_sql}', auto_detect=true, "
            "all_varchar=true, header=true)"
        )
        raw_count = int(con.execute(f"SELECT COUNT(*) FROM {raw_reader}").fetchone()[0])
        filtered_count = int(
            con.execute(
                f"SELECT COUNT(*) FROM {raw_reader} WHERE {where_clause}"
            ).fetchone()[0]
        )
        sql = f"""
            COPY (
                WITH raw AS (
                    SELECT *, ROW_NUMBER() OVER () AS _SourceRow
                    FROM {raw_reader}
                ),
                filtered AS (
                    SELECT * FROM raw WHERE {where_clause}
                ),
                melted AS (
                    UNPIVOT filtered
                    ON COLUMNS('{abundance_regex}')
                    INTO NAME ReporterColumn VALUE ReporterAbundance
                )
                SELECT
                    {original_sql},
                    r._SourceRow,
                    regexp_replace(r.ReporterColumn, '^Abundance\\s+', '') AS Channel,
                    TRY_CAST(r.ReporterAbundance AS DOUBLE) AS Abundance,
                    COALESCE({sequence_sql}, '') || '|' ||
                        COALESCE(r."Modifications", '') || '|' ||
                        COALESCE(r."Charge", '') AS Unique_PSM,
                    m.Condition,
                    m.Replicate,
                    m.Role,
                    m.BioReplicate
                FROM melted r
                JOIN channel_mapping m
                  ON regexp_replace(r.ReporterColumn, '^Abundance\\s+', '') = m.Channel
                WHERE TRY_CAST(r.ReporterAbundance AS DOUBLE) >= 1
            ) TO '{output_sql}'
            (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
        """
        con.execute(sql)
        long_count = int(
            con.execute(
                f"SELECT COUNT(*) FROM read_parquet('{output_sql}')"
            ).fetchone()[0]
        )
    finally:
        con.close()
    return {
        "input_psms": raw_count,
        "quality_filtered_psms": filtered_count,
        "long_reporter_rows": long_count,
    }


def read_fasta_subset(
    fasta_path: Path, accessions: set[str]
) -> dict[str, dict[str, str]]:
    """Read only requested exact/canonical UniProt entries from FASTA."""
    wanted = set(accessions)
    wanted.update(accession.split("-")[0] for accession in accessions)
    result: dict[str, dict[str, str]] = {}
    current: str | None = None
    current_gene = ""
    chunks: list[str] = []

    def finish() -> None:
        if current and current in wanted:
            result[current] = {
                "sequence": "".join(chunks).upper(),
                "gene": current_gene,
            }

    with fasta_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith(">"):
                finish()
                match = re.match(r">(?:sp|tr)\|([^|]+)\|", line)
                current = match.group(1) if match else line[1:].split()[0]
                gene_match = re.search(r"\bGN=([^\s]+)", line)
                current_gene = gene_match.group(1) if gene_match else ""
                chunks = []
            elif current in wanted:
                chunks.append(line)
        finish()
    return result


def _localization_for_row(
    row: pd.Series,
    target_modification: str,
    target_sites: list[tuple[str, int]],
) -> tuple[list[tuple[str, int, float]], str]:
    for column, source in (
        ("ptmRS_Best_Site_Probabilities", "ptmRS"),
        ("CHIMERYS_Best_Site_Probabilities", "CHIMERYS best-site"),
    ):
        value = row.get(column)
        if pd.notna(value) and str(value).strip():
            parsed = parse_localization_scores(str(value), target_modification)
            if parsed:
                return parsed, source
    value = row.get("CHIMERYS_PTM_Localization_Score")
    if pd.notna(value) and str(value).strip():
        try:
            score = float(value)
            if score <= 1:
                score *= 100
            return [
                (residue, position, score) for residue, position in target_sites
            ], "CHIMERYS score"
        except ValueError:
            pass
    return [], "Unscored"


def _expected_sample_channels(
    channel_mapping: dict[str, dict[str, str | int]],
) -> dict[str, set[str]]:
    frame = _mapping_frame(channel_mapping)
    sample = frame[~frame["Condition"].eq("Norm")]
    return {
        str(condition): set(group["Channel"].astype(str))
        for condition, group in sample.groupby("Condition")
    }


def _msstats_psm_id(feature_scope: str, peptidoform: str, charge: object) -> str:
    identity = f"{feature_scope}\x1f{peptidoform}"
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:16]
    return f"F{digest}_{int(float(charge))}"


def _msstats_peptide_id(feature_scope: str, peptidoform: str) -> str:
    """Keep MSstatsTMT balanced-design feature keys unique across site/protein groups."""
    digest = hashlib.sha1(str(feature_scope).encode("utf-8")).hexdigest()[:12]
    return f"S{digest}|{peptidoform}"


def build_ptm_site_inputs(
    ptm_long_path: Path,
    output_dir: Path,
    *,
    target_modification: str,
    fasta_path: Path,
    channel_mapping: dict[str, dict[str, str | int]],
    normalization_method: str = "background_peptide",
    background_normalization: bool | None = None,
    max_missing_fraction: float,
    protein_long_path: Path | None = None,
    minimum_background_features: int = 50,
) -> dict[str, Any]:
    """Build MSstatsPTM inputs and site-centric evidence tables."""
    output_dir.mkdir(parents=True, exist_ok=True)
    ptm = pd.read_parquet(ptm_long_path)
    ptm["PeptideSequence"] = ptm["Annotated_Sequence"].map(extract_peptide_sequence)
    target_pattern = rf"\({re.escape(target_modification)}\)"
    target_mask = (
        ptm["Modifications"].fillna("").str.contains(target_pattern, regex=True)
    )
    target_rows = ptm[target_mask].copy()
    if target_rows.empty:
        raise ValueError(f"No quality-filtered PSMs contain {target_modification}")
    background = ptm[~target_mask].copy()

    accessions = {
        item.strip()
        for value in target_rows["Master_Protein_Accessions"].dropna().astype(str)
        for item in value.split(";")
        if item.strip()
    }
    fasta = read_fasta_subset(fasta_path, accessions)

    assignment_keys = [
        "Master_Protein_Accessions",
        "PeptideSequence",
        "Modifications",
        "ptmRS_Best_Site_Probabilities",
        "CHIMERYS_Best_Site_Probabilities",
        "CHIMERYS_PTM_Localization_Score",
    ]
    existing_keys = [key for key in assignment_keys if key in target_rows.columns]
    unique_rows = target_rows[existing_keys].drop_duplicates().copy()
    assignments: list[dict[str, Any]] = []
    for _, row in unique_rows.iterrows():
        accession = str(row["Master_Protein_Accessions"])
        target_sites = parse_modification_sites(
            str(row["Modifications"]), target_modification
        )
        scores, source = _localization_for_row(row, target_modification, target_sites)
        lookup = fasta.get(accession)
        match_type = "exact"
        if lookup is None and ";" not in accession:
            lookup = fasta.get(accession.split("-")[0])
            if lookup is not None:
                match_type = "canonical_fallback"
        assignment = build_site_assignment(
            accession=accession,
            peptide=str(row["PeptideSequence"]),
            target_sites=target_sites,
            localization_scores=scores,
            protein_sequence=lookup["sequence"] if lookup else None,
            target_modification=target_modification,
        )
        assignments.append(
            {
                **{key: row[key] for key in existing_keys},
                "ProteinAccession": accession,
                "Gene": lookup["gene"] if lookup else "",
                "SiteToken": assignment.site_token,
                "SiteLabel": assignment.display_label,
                "ProteinName": f"{accession}_{assignment.site_token}",
                "LocalizationStatus": assignment.localization_status,
                "MappingStatus": assignment.mapping_status,
                "LocalizationSource": source,
                "LocalizationScores": "|".join(
                    str(score) for score in assignment.scores
                ),
                "PeptidePositions": "|".join(assignment.peptide_positions),
                "ProteinPositions": "|".join(assignment.protein_positions),
                "ProteinMapping": match_type if lookup else "unmapped",
            }
        )
    assignment_frame = pd.DataFrame(assignments)
    target_rows = target_rows.merge(assignment_frame, on=existing_keys, how="left")
    target_rows["Peptidoform"] = (
        target_rows["PeptideSequence"].astype(str)
        + "|"
        + target_rows["Modifications"].fillna("").astype(str)
    )

    group_columns = [
        "ProteinName",
        "ProteinAccession",
        "Gene",
        "SiteToken",
        "SiteLabel",
        "PeptideSequence",
        "Peptidoform",
        "Charge",
        "Channel",
        "Condition",
        "Replicate",
        "Role",
        "BioReplicate",
    ]
    aggregated = target_rows.groupby(group_columns, dropna=False, as_index=False)[
        "Abundance"
    ].sum()
    background = background.assign(
        PeptideSequence=background["Annotated_Sequence"].map(extract_peptide_sequence)
    )
    sample_channels = sorted(
        channel
        for channels in _expected_sample_channels(channel_mapping).values()
        for channel in channels
    )
    if background_normalization is not None:
        normalization_method = (
            "background_peptide" if background_normalization else "none"
        )
    if normalization_method == "background_peptide":
        aggregated, normalization = apply_background_normalization(
            aggregated,
            background,
            sample_channels=sample_channels,
            minimum_features=minimum_background_features,
        )
    elif normalization_method == "centered_median":
        aggregated, normalization = apply_centered_median_normalization(
            aggregated,
            sample_channels=sample_channels,
        )
    elif normalization_method == "none":
        aggregated = aggregated.copy()
        aggregated["NormalizedAbundance"] = aggregated["Abundance"].astype(float)
        normalization = BackgroundNormalization(
            False,
            0,
            {},
            "Disabled by user",
            "none",
        )
    else:
        raise ValueError(f"Unknown PTM normalization method: {normalization_method}")

    expected = _expected_sample_channels(channel_mapping)
    passing_sites: set[str] = set()
    for protein_name, rows in aggregated.groupby("ProteinName"):
        observed = {
            str(condition): set(group["Channel"].astype(str))
            for condition, group in rows[rows["Condition"] != "Norm"].groupby(
                "Condition"
            )
        }
        if site_passes_coverage(
            observed,
            expected,
            max_missing_fraction=max_missing_fraction,
        ):
            passing_sites.add(str(protein_name))
    aggregated = aggregated[aggregated["ProteinName"].isin(passing_sites)].copy()
    if aggregated.empty:
        raise ValueError("No PTM sites pass the per-condition coverage requirement")

    aggregated["PSM"] = aggregated.apply(
        lambda row: _msstats_psm_id(
            row["ProteinName"], row["Peptidoform"], row["Charge"]
        ),
        axis=1,
    )
    msstats = pd.DataFrame(
        {
            "ProteinName": aggregated["ProteinName"],
            "PeptideSequence": aggregated.apply(
                lambda row: _msstats_peptide_id(row["ProteinName"], row["Peptidoform"]),
                axis=1,
            ),
            "Charge": pd.to_numeric(aggregated["Charge"], errors="coerce")
            .fillna(0)
            .astype(int),
            "PSM": aggregated["PSM"],
            "Mixture": "1",
            "TechRepMixture": "1",
            "Run": "1_1",
            "Channel": aggregated["Channel"].astype(str),
            "Condition": aggregated["Condition"].astype(str),
            "BioReplicate": aggregated["BioReplicate"].astype(str),
            "Intensity": aggregated["NormalizedAbundance"].astype(float),
        }
    )
    ptm_input_path = output_dir / "ptm_msstats_input.tsv"
    msstats.to_csv(ptm_input_path, sep="\t", index=False)

    status_rank = {"Unscored": 0, "Ambiguous": 1, "Confident": 2}
    metadata = target_rows[target_rows["ProteinName"].isin(passing_sites)].copy()
    evidence_keys = [
        column
        for column in ["ProteinName", "File_ID", "_SourceRow"]
        if column in metadata.columns
    ]
    if len(evidence_keys) < 2:
        evidence_keys = [
            "ProteinName",
            "Peptidoform",
            "Charge",
            "LocalizationStatus",
            "LocalizationScores",
        ]
    metadata_evidence = metadata.drop_duplicates(subset=evidence_keys).copy()
    metadata_evidence["_status_rank"] = (
        metadata_evidence["LocalizationStatus"].map(status_rank).fillna(0)
    )
    site_metadata_rows = []
    for protein_name, rows in metadata_evidence.groupby("ProteinName"):
        representative = rows.iloc[0]
        best_status = max(
            rows["LocalizationStatus"], key=lambda value: status_rank.get(value, 0)
        )
        site_metadata_rows.append(
            {
                "ProteinName": protein_name,
                "ProteinAccession": representative["ProteinAccession"],
                "Gene": representative["Gene"],
                "SiteToken": representative["SiteToken"],
                "SiteLabel": representative["SiteLabel"],
                "LocalizationStatus": best_status,
                "MappingStatus": representative["MappingStatus"],
                "ProteinMapping": representative["ProteinMapping"],
                "TargetModification": target_modification,
                "ConfidentEvidence": int(
                    (rows["LocalizationStatus"] == "Confident").sum()
                ),
                "AmbiguousEvidence": int(
                    (rows["LocalizationStatus"] == "Ambiguous").sum()
                ),
                "UnscoredEvidence": int(
                    (rows["LocalizationStatus"] == "Unscored").sum()
                ),
            }
        )
    site_metadata = pd.DataFrame(site_metadata_rows)
    site_metadata_path = output_dir / "ptm_site_metadata.tsv"
    site_metadata.to_csv(site_metadata_path, sep="\t", index=False)

    evidence_columns = [
        "ProteinName",
        "SiteLabel",
        "PeptideSequence",
        "Modifications",
        "Charge",
        "LocalizationStatus",
        "LocalizationSource",
        "LocalizationScores",
        "PeptidePositions",
        "ProteinPositions",
        "MappingStatus",
        "File_ID",
        "First_Scan",
        "_SourceRow",
    ]
    evidence_columns = [
        column for column in evidence_columns if column in metadata_evidence.columns
    ]
    evidence = metadata_evidence[evidence_columns].drop_duplicates()
    evidence_path = output_dir / "ptm_localization_evidence.tsv"
    evidence.to_csv(evidence_path, sep="\t", index=False)

    peptidoforms = metadata_evidence.groupby(
        ["ProteinName", "SiteLabel", "Peptidoform", "Charge"], as_index=False
    ).agg(PSMCount=("Peptidoform", "size"))
    peptidoforms_path = output_dir / "ptm_peptidoforms.tsv"
    peptidoforms.to_csv(peptidoforms_path, sep="\t", index=False)

    abundance = aggregated[
        [
            "ProteinName",
            "SiteLabel",
            "Channel",
            "Condition",
            "Replicate",
            "Abundance",
            "NormalizedAbundance",
        ]
    ].copy()
    abundance["Imputed"] = False
    abundance_path = output_dir / "ptm_site_abundance.tsv"
    abundance.to_csv(abundance_path, sep="\t", index=False)

    protein_input_path: Path | None = None
    quantified_proteins: set[str] = set()
    if protein_long_path is not None:
        protein = pd.read_parquet(protein_long_path)
        protein["PeptideSequence"] = protein["Annotated_Sequence"].map(
            extract_peptide_sequence
        )
        protein["Peptidoform"] = (
            protein["PeptideSequence"].astype(str)
            + "|"
            + protein["Modifications"].fillna("").astype(str)
        )
        protein_grouped = protein.groupby(
            [
                "Master_Protein_Accessions",
                "Peptidoform",
                "Charge",
                "Channel",
                "Condition",
                "Replicate",
                "Role",
                "BioReplicate",
            ],
            as_index=False,
            dropna=False,
        )["Abundance"].sum()
        passing_proteins: set[str] = set()
        for accession, rows in protein_grouped.groupby("Master_Protein_Accessions"):
            observed = {
                str(condition): set(group["Channel"].astype(str))
                for condition, group in rows[rows["Condition"] != "Norm"].groupby(
                    "Condition"
                )
            }
            if site_passes_coverage(
                observed, expected, max_missing_fraction=max_missing_fraction
            ):
                passing_proteins.add(str(accession))
        protein_grouped = protein_grouped[
            protein_grouped["Master_Protein_Accessions"].isin(passing_proteins)
        ].copy()
        quantified_proteins = passing_proteins
        protein_grouped["PSM"] = protein_grouped.apply(
            lambda row: _msstats_psm_id(
                row["Master_Protein_Accessions"], row["Peptidoform"], row["Charge"]
            ),
            axis=1,
        )
        protein_msstats = pd.DataFrame(
            {
                "ProteinName": protein_grouped["Master_Protein_Accessions"].astype(str),
                "PeptideSequence": protein_grouped.apply(
                    lambda row: _msstats_peptide_id(
                        row["Master_Protein_Accessions"], row["Peptidoform"]
                    ),
                    axis=1,
                ),
                "Charge": pd.to_numeric(protein_grouped["Charge"], errors="coerce")
                .fillna(0)
                .astype(int),
                "PSM": protein_grouped["PSM"],
                "Mixture": "1",
                "TechRepMixture": "1",
                "Run": "1_1",
                "Channel": protein_grouped["Channel"].astype(str),
                "Condition": protein_grouped["Condition"].astype(str),
                "BioReplicate": protein_grouped["BioReplicate"].astype(str),
                "Intensity": protein_grouped["Abundance"].astype(float),
            }
        )
        protein_input_path = output_dir / "protein_msstats_input.tsv"
        protein_msstats.to_csv(protein_input_path, sep="\t", index=False)

    qc = {
        "target_modification": target_modification,
        "target_psm_reporter_rows": len(target_rows),
        "passing_site_count": len(passing_sites),
        "normalization": {
            "method": normalization.method,
            "applied": normalization.applied,
            "complete_feature_count": normalization.complete_feature_count,
            "channel_factors": normalization.channel_factors,
            "warning": normalization.warning,
        },
        "localization": site_metadata["LocalizationStatus"].value_counts().to_dict(),
        "mapping": site_metadata["MappingStatus"].value_counts().to_dict(),
        "quantified_protein_count": len(quantified_proteins),
    }
    qc_path = output_dir / "ptm_preprocessing_qc.json"
    qc_path.write_text(json.dumps(qc, indent=2), encoding="utf-8")

    return {
        "ptm_input_path": ptm_input_path,
        "protein_input_path": protein_input_path,
        "site_metadata_path": site_metadata_path,
        "evidence_path": evidence_path,
        "peptidoforms_path": peptidoforms_path,
        "abundance_path": abundance_path,
        "qc_path": qc_path,
        "passing_site_count": len(passing_sites),
        "quantified_protein_count": len(quantified_proteins),
    }

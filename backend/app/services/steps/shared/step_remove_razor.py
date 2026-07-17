"""Deprecated shared-peptide handler import."""

from .step_resolve_shared_peptides import step_resolve_shared_peptides

step_remove_razor = step_resolve_shared_peptides

__all__ = ["step_remove_razor"]

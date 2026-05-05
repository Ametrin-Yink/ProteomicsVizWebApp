'use client';

import React, { useState, useEffect } from 'react';
import type { DEResult, ProteinAbundance, PeptideAbundanceData, VolcanoFilters } from '@/types/api';
import { formatNumber, formatPValue, getSignificanceLabel, getVolcanoPointColor, parseDelimited } from '@/lib/utils';
import { getProteinAbundance, getPeptideAbundance } from '@/lib/api';
import { ProteinAbundancePlot, PeptideAbundancePlot } from './AbundancePlot';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProteinInfoSkeleton } from '@/components/ui/Loading';
import { Microscope } from 'lucide-react';

interface ProteinInfoProps {
  protein: DEResult | null;
  sessionId: string;
  isLoading?: boolean;
  filters?: VolcanoFilters;
}

interface ParsedProteinInfo {
  accessions: string[];
  geneNames: string[];
}

// Parse multiple UniProt IDs and gene names
function parseProteinInfo(protein: DEResult): ParsedProteinInfo {
  // Split accessions by comma or semicolon
  const accessions = parseDelimited(protein.master_protein_accessions);

  // Split gene names by comma or semicolon
  const geneNames = protein.gene_name
    ? parseDelimited(protein.gene_name)
    : [];

  // If no gene names provided, return empty array for each accession
  if (geneNames.length === 0) {
    return { accessions, geneNames: accessions.map(() => '-') };
  }

  // If gene names count doesn't match accessions, pad with '-'
  const paddedGeneNames = [...geneNames];
  while (paddedGeneNames.length < accessions.length) {
    paddedGeneNames.push('-');
  }

  return { accessions, geneNames: paddedGeneNames };
}

export default function ProteinInfo({ protein, sessionId, isLoading, filters }: ProteinInfoProps) {
  const [proteinAbundance, setProteinAbundance] = useState<ProteinAbundance | null>(null);
  const [peptideAbundance, setPeptideAbundance] = useState<PeptideAbundanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedGeneNames, setFetchedGeneNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!protein) {
      setProteinAbundance(null);
      setPeptideAbundance(null);
      setFetchedGeneNames(new Map());
      return;
    }

    async function fetchAbundanceData() {
      if (!protein) return;
      setLoading(true);
      setError(null);
      try {
        const [proteinData, peptideData] = await Promise.all([
          getProteinAbundance(sessionId, protein.master_protein_accessions),
          getPeptideAbundance(sessionId, protein.master_protein_accessions),
        ]);
        setProteinAbundance(proteinData);
        setPeptideAbundance(peptideData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load abundance data');
      } finally {
        setLoading(false);
      }
    }

    fetchAbundanceData();
  }, [protein, sessionId]);

  // Gene names are padded to match accessions by parseProteinInfo,
  // so no UniProt API fetch is needed here.

  if (isLoading) {
    return <ProteinInfoSkeleton />;
  }

  if (!protein) {
    return (
      <EmptyState
        title="No Protein Selected"
        description="Click on a point in the volcano plot or a row in the table to view protein details."
        icon={<Microscope className="w-8 h-8 text-text-muted" />}
      />
    );
  }

  const { accessions, geneNames: originalGeneNames } = parseProteinInfo(protein);

  // Combine original gene names with fetched ones
  const geneNames = accessions.map((acc, index) => {
    // First use the gene name from the data
    if (index < originalGeneNames.length && originalGeneNames[index] !== '-') {
      return originalGeneNames[index];
    }
    // Then check fetched gene names
    const fetched = fetchedGeneNames.get(acc);
    if (fetched) {
      return fetched;
    }
    // Finally fallback to '-'
    return '-';
  });

  return (
    <div data-testid="protein-info-panel" className="bg-background rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-text-primarymb-4">Protein Information</h3>

      {/* Basic Info */}
      <div className="space-y-3 mb-6">
        {/* UniProt Accessions with Links */}
        <div data-testid="protein-accession" className="py-2 border-b border-border">
          <div className="flex justify-between items-start">
            <span className="text-sm text-text-muted">UniProt ID(s)</span>
          </div>
          <div className="mt-1 space-y-1">
            {accessions.map((acc, index) => (
              <div key={acc} className="flex items-center justify-between">
                <a
                  href={`https://www.uniprot.org/uniprotkb/${acc}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-secondary hover:text-secondary-dark hover:underline"
                >
                  {acc}
                </a>
                <span className="text-xs text-text-muted">{geneNames[index] || '-'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gene Names - REMOVED as per user request */}
        {/*
        <div data-testid="gene-name" className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">Gene Name(s)</span>
          <span className="text-sm font-medium text-text-primary">{geneNames.join(', ') || '-'}</span>
        </div>
        */}

        <div className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">Fold Change</span>
          <span
            className={`text-sm font-medium ${
              protein.log_fc > 0 ? 'text-primary' : 'text-secondary'
            }`}
          >
            {formatNumber(Math.pow(2, protein.log_fc), 3)}
          </span>
        </div>

        <div data-testid="logfc-value" className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">Log2 Fold Change</span>
          <span
            className={`text-sm font-medium ${
              protein.log_fc > 0 ? 'text-primary' : 'text-secondary'
            }`}
          >
            {formatNumber(protein.log_fc, 3)}
          </span>
        </div>

        <div data-testid="pvalue-value" className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">P-value</span>
          <span className="text-sm font-medium text-text-primary">{formatPValue(protein.pval)}</span>
        </div>

        <div data-testid="adjpvalue-value" className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">Adj P-value</span>
          <span className="text-sm font-medium text-text-primary">{formatPValue(protein.adj_pval)}</span>
        </div>

        <div className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-sm text-text-muted">Number of PSMs</span>
          <span className="text-sm font-medium text-text-primary">
            {protein.psm_count && protein.psm_count > 0 ? protein.psm_count : '-'}
          </span>
        </div>

        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-text-muted">Significance</span>
          {filters ? (
            (() => {
              const label = getSignificanceLabel(protein.log_fc, protein.pval, protein.adj_pval, filters);
              const isSignificant = label !== 'Not Significant';
              const color = getVolcanoPointColor(protein.log_fc, protein.pval, protein.adj_pval, filters);
              return (
                <span
                  className="text-sm font-medium px-2 py-1 rounded"
                  style={{ backgroundColor: isSignificant ? color + '20' : 'var(--color-surface, #f1f5f9)', color: isSignificant ? color : '#94a3b8' }}
                >
                  {label}
                </span>
              );
            })()
          ) : (
            <span
              className={`text-sm font-medium px-2 py-1 rounded ${
                protein.significant
                  ? 'bg-success/10 text-success'
                  : 'bg-surface text-text-muted'
              }`}
            >
              {protein.significant ? 'Significant' : 'Not Significant'}
            </span>
          )}
        </div>
      </div>

      {/* Abundance Plots */}
      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-text-muted mt-2">Loading abundance data...</p>
        </div>
      )}

      {error && (
        <div className="bg-error/5 border border-error/20 rounded-lg p-4 mb-4">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {!loading && !error && proteinAbundance && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-text-primarymb-2">Protein Abundance</h4>
          <ProteinAbundancePlot data={proteinAbundance} />
        </div>
      )}

      {/* Always show Peptide Abundance section if data exists */}
      {!loading && !error && peptideAbundance && (
        <div>
          <h4 className="text-sm font-medium text-text-primarymb-2">Peptide Abundance</h4>
          {peptideAbundance.peptides.length > 0 ? (
            <PeptideAbundancePlot data={peptideAbundance} />
          ) : (
            <div className="bg-surface rounded-lg p-4 text-center text-text-muted text-sm">
              No peptide data available for this protein
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import type { DEResult, ProteinAbundance, PSMAbundanceData } from '@/types/api';
import { formatNumber, formatPValue } from '@/lib/utils';
import { getProteinAbundance, getPSMAbundance } from '@/lib/api';
import { fetchGeneNames } from '@/lib/uniprot';
import { ProteinAbundancePlot, PSMAbundancePlot } from './AbundancePlot';

interface ProteinInfoProps {
  protein: DEResult | null;
  sessionId: string;
}

interface ParsedProteinInfo {
  accessions: string[];
  geneNames: string[];
}

// Parse multiple UniProt IDs and gene names
function parseProteinInfo(protein: DEResult): ParsedProteinInfo {
  // Split accessions by comma or semicolon
  const accessions = protein.master_protein_accessions
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);

  // Split gene names by comma or semicolon
  const geneNames = protein.gene_name
    ? protein.gene_name
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean)
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

export default function ProteinInfo({ protein, sessionId }: ProteinInfoProps) {
  const [proteinAbundance, setProteinAbundance] = useState<ProteinAbundance | null>(null);
  const [psmAbundance, setPsmAbundance] = useState<PSMAbundanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedGeneNames, setFetchedGeneNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!protein) {
      setProteinAbundance(null);
      setPsmAbundance(null);
      setFetchedGeneNames(new Map());
      return;
    }

    async function fetchAbundanceData() {
      setLoading(true);
      setError(null);
      try {
        const [proteinData, psmData] = await Promise.all([
          getProteinAbundance(sessionId, protein.master_protein_accessions),
          getPSMAbundance(sessionId, protein.master_protein_accessions),
        ]);
        setProteinAbundance(proteinData);
        setPsmAbundance(psmData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load abundance data');
      } finally {
        setLoading(false);
      }
    }

    fetchAbundanceData();
  }, [protein, sessionId]);

  // Fetch gene names from UniProt API for additional UniProt IDs
  useEffect(() => {
    if (!protein) return;

    const { accessions, geneNames } = parseProteinInfo(protein);

    // If we have more accessions than gene names, fetch the missing ones
    if (accessions.length > geneNames.length) {
      const missingIds = accessions.slice(geneNames.length);
      fetchGeneNames(missingIds).then(fetched => {
        setFetchedGeneNames(fetched);
      });
    }
  }, [protein]);

  if (!protein) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="text-center text-gray-500 py-8">
          <p className="text-lg font-medium">No Protein Selected</p>
          <p className="text-sm mt-2">Click on a point in the volcano plot or a row in the table to view protein details.</p>
        </div>
      </div>
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
    <div data-testid="protein-info-panel" className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Protein Information</h3>

      {/* Basic Info */}
      <div className="space-y-3 mb-6">
        {/* UniProt Accessions with Links */}
        <div data-testid="protein-accession" className="py-2 border-b border-gray-100">
          <div className="flex justify-between items-start">
            <span className="text-sm text-gray-500">UniProt ID(s)</span>
          </div>
          <div className="mt-1 space-y-1">
            {accessions.map((acc, index) => (
              <div key={acc} className="flex items-center justify-between">
                <a
                  href={`https://www.uniprot.org/uniprotkb/${acc}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {acc}
                </a>
                <span className="text-xs text-gray-500">{geneNames[index] || '-'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gene Names */}
        <div data-testid="gene-name" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Gene Name(s)</span>
          <span className="text-sm font-medium text-gray-900">{geneNames.join(', ') || '-'}</span>
        </div>

        <div className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Fold Change</span>
          <span
            className={`text-sm font-medium ${
              protein.log_fc > 0 ? 'text-pink-600' : 'text-blue-600'
            }`}
          >
            {formatNumber(Math.pow(2, protein.log_fc), 3)}
          </span>
        </div>

        <div data-testid="logfc-value" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Log2 Fold Change</span>
          <span
            className={`text-sm font-medium ${
              protein.log_fc > 0 ? 'text-pink-600' : 'text-blue-600'
            }`}
          >
            {formatNumber(protein.log_fc, 3)}
          </span>
        </div>

        <div data-testid="pvalue-value" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">P-value</span>
          <span className="text-sm font-medium text-gray-900">{formatPValue(protein.pval)}</span>
        </div>

        <div data-testid="adjpvalue-value" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Adj P-value</span>
          <span className="text-sm font-medium text-gray-900">{formatPValue(protein.adj_pval)}</span>
        </div>

        <div className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Number of PSMs</span>
          <span className="text-sm font-medium text-gray-900">
            {protein.psm_count || '-'}
          </span>
        </div>

        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-gray-500">Significance</span>
          <span
            className={`text-sm font-medium px-2 py-1 rounded ${
              protein.significant
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {protein.significant ? 'Significant' : 'Not Significant'}
          </span>
        </div>
      </div>

      {/* Abundance Plots */}
      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Loading abundance data...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!loading && !error && proteinAbundance && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Protein Abundance</h4>
          <ProteinAbundancePlot data={proteinAbundance} />
        </div>
      )}

      {/* Always show PSM Abundance section if data exists */}
      {!loading && !error && psmAbundance && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">PSM Abundance</h4>
          {psmAbundance.psms.length > 0 ? (
            <PSMAbundancePlot data={psmAbundance} />
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500 text-sm">
              No PSM data available for this protein
            </div>
          )}
        </div>
      )}
    </div>
  );
}

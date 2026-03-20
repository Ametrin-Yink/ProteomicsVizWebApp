'use client';

import React, { useState, useEffect } from 'react';
import type { DEResult, ProteinAbundance, PSMAbundanceData } from '@/types/api';
import { formatNumber, formatPValue } from '@/lib/utils';
import { getProteinAbundance, getPSMAbundance } from '@/lib/api';
import { ProteinAbundancePlot, PSMAbundancePlot } from './AbundancePlot';

interface ProteinInfoProps {
  protein: DEResult | null;
  sessionId: string;
}

export default function ProteinInfo({ protein, sessionId }: ProteinInfoProps) {
  const [proteinAbundance, setProteinAbundance] = useState<ProteinAbundance | null>(null);
  const [psmAbundance, setPsmAbundance] = useState<PSMAbundanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!protein) {
      setProteinAbundance(null);
      setPsmAbundance(null);
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

  const uniprotUrl = `https://www.uniprot.org/uniprotkb/${protein.master_protein_accessions}`;

  return (
    <div data-testid="protein-info-panel" className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Protein Information</h3>

      {/* Basic Info */}
      <div className="space-y-3 mb-6">
        <div data-testid="protein-accession" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Master Protein Accessions</span>
          <a
            href={uniprotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            {protein.master_protein_accessions}
          </a>
        </div>

        <div data-testid="gene-name" className="flex justify-between items-center py-2 border-b border-gray-100">
          <span className="text-sm text-gray-500">Gene Name</span>
          <span className="text-sm font-medium text-gray-900">{protein.gene_name || '-'}</span>
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

      {!loading && !error && psmAbundance && psmAbundance.psms.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">PSM Abundance</h4>
          <PSMAbundancePlot data={psmAbundance} />
        </div>
      )}
    </div>
  );
}

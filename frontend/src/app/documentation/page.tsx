/**
 * Documentation Page
 *
 * User documentation for getting started with ProteomicsViz,
 * analysis workflows, and troubleshooting.
 */

import Link from 'next/link';

export default function DocumentationPage() {
  return (
    <div className="min-h-screen bg-gray-50 pt-14">
      <div className="max-w-4xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Documentation</h1>
          <p className="text-xl text-gray-600">
            Guides and references for using ProteomicsViz
          </p>
        </div>

        {/* Quick Start */}
        <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Quick Start</h2>
          <ol className="space-y-3 text-gray-700">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white text-sm font-medium flex items-center justify-center">1</span>
              <span>Select <strong>Protein Pair-wise Comparison Analysis</strong> from the welcome page</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white text-sm font-medium flex items-center justify-center">2</span>
              <span>Upload your PSM CSV files with the required format</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white text-sm font-medium flex items-center justify-center">3</span>
              <span>Configure analysis parameters (conditions, thresholds, etc.)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white text-sm font-medium flex items-center justify-center">4</span>
              <span>Click <strong>Start Analysis</strong> to begin processing</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-600 text-white text-sm font-medium flex items-center justify-center">5</span>
              <span>View results including differential expression, QC plots, and pathway analysis</span>
            </li>
          </ol>
        </div>

        {/* File Format */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Input File Format</h2>
          <p className="text-gray-600 mb-4">
            ProteomicsViz expects PSM (Peptide-Spectrum Match) data in CSV format with the following naming convention:
          </p>
          <div className="bg-gray-100 rounded-lg p-4 font-mono text-sm text-gray-700 mb-4">
            PSM_ExperimentName_Condition_ReplicateNumber.csv
          </div>
          <p className="text-gray-600 mb-4">Required columns in your CSV files:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li>Sequence - Peptide sequence</li>
            <li>Modifications - Post-translational modifications</li>
            <li>Charge - Peptide charge state</li>
            <li>Contaminant - Whether it's a contaminant</li>
            <li>Master Protein Accessions - Protein identifiers</li>
            <li>Quan Info - Quantification information</li>
            <li>Abundance - Quantitative abundance values</li>
          </ul>
        </div>

        {/* Analysis Types */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Analysis Types</h2>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Protein Pair-wise Comparison</h3>
              <p className="text-gray-600">
                Compare protein abundance between two experimental conditions using
                statistical testing (limma/msqrob2). Generates volcano plots, heatmaps,
                and differential expression tables.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Multi-Condition Analysis</h3>
              <p className="text-gray-600 text-sm text-gray-500">
                <em>Coming soon</em> - Analyze protein expression across multiple experimental conditions.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Time Course Analysis</h3>
              <p className="text-gray-600 text-sm text-gray-500">
                <em>Coming soon</em> - Track protein abundance changes over time.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Pathway Enrichment</h3>
              <p className="text-gray-600 text-sm text-gray-500">
                <em>Coming soon</em> - Identify enriched biological pathways from differential expression results.
              </p>
            </div>
          </div>
        </div>

        {/* Processing Pipeline */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Processing Pipeline</h2>
          <p className="text-gray-600 mb-4">Your data goes through a 9-step pipeline:</p>
          <ol className="space-y-2 text-gray-600">
            <li><strong>Combine Replicates</strong> - Aggregate replicate measurements</li>
            <li><strong>Generate Unique PSM</strong> - Create unique peptide identifiers</li>
            <li><strong>Remove Razor</strong> - Optional: remove razor peptides</li>
            <li><strong>Remove Low Quality</strong> - Filter low-quality data</li>
            <li><strong>Filter by Criteria</strong> - Apply user-defined filters</li>
            <li><strong>Protein Abundance</strong> - Aggregate to protein level using msqrob2</li>
            <li><strong>Differential Expression</strong> - Statistical testing with msqrob2</li>
            <li><strong>QC Metrics</strong> - Calculate quality control metrics</li>
            <li><strong>GSEA Analysis</strong> - Gene set enrichment analysis</li>
          </ol>
        </div>

        {/* Support */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Support</h2>
          <p className="text-gray-600 mb-4">
            Need help? Check these resources:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>Review the <Link href="/about" className="text-cyan-600 hover:text-cyan-700 font-medium">About page</Link> for feature overview</li>
            <li>Ensure your input files follow the required format</li>
            <li>Check that you have at least 3 replicates per condition</li>
            <li>Verify required R packages are installed (msqrob2, QFeatures, limma)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

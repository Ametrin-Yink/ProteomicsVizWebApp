/**
 * About Page
 *
 * Styled documentation page rendering the README content.
 */

import { Upload, Settings, BarChart3, FileDown, Cpu, Layers } from 'lucide-react';
import { MassSpecIcon } from '@/components/ui/MassSpecIcon';

const steps = [
  { icon: '1', title: 'Create a Session', desc: 'From the welcome page, create a new analysis session and give it a name.' },
  { icon: '2', title: 'Upload Data', desc: 'Upload PSM CSV files named as PSM_ExperimentName_Condition_ReplicateNumber.csv. Minimum 3 replicates per condition.' },
  { icon: '3', title: 'Configure & Process', desc: 'Set analysis parameters and start the six-stage pipeline. Progress is shown in real time.' },
  { icon: '4', title: 'View Results', desc: 'Explore interactive volcano plots, QC plots, and GSEA enrichment analysis.' },
  { icon: '5', title: 'Export', desc: 'Download results as CSV or export interactive HTML reports.' },
];

const pipelineSteps = [
  { range: '1', desc: 'Prepare and filter PSM data', tech: 'Python/DuckDB' },
  { range: '2', desc: 'Resolve shared peptide assignments', tech: 'Python/DuckDB' },
  { range: '3', desc: 'Filter coverage and protein eligibility', tech: 'Python/DuckDB' },
  { range: '4', desc: 'Protein abundance aggregation', tech: 'R/MSstats or msqrob2' },
  { range: '5', desc: 'Differential expression analysis', tech: 'R/MSstats or msqrob2' },
  { range: '6', desc: 'QC metrics (PCA, CV, distributions)', tech: 'Python/sklearn' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface pt-14">
      <div className="max-w-4xl mx-auto px-8 py-12">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <MassSpecIcon className="w-6 h-6 text-white" />
          </div>
          <h1 className="font-bold text-text-primarymb-3">Proteomics Visualization Web App</h1>
          <p className="text-base text-text-secondary max-w-2xl mx-auto">
            Full-stack scientific web application for proteomics data analysis and visualization.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {[
            { title: 'Data Input', desc: 'Upload proteomics CSV files with automatic validation', icon: Upload },
            { title: 'Processing Pipeline', desc: 'Six-stage analysis pipeline with real-time progress tracking', icon: Settings },
            { title: 'Visualization', desc: 'Interactive volcano plots, QC plots, and GSEA enrichment plots', icon: BarChart3 },
            { title: 'Session Management', desc: 'Persistent sessions that survive server restarts', icon: Layers },
            { title: 'HTML Reports', desc: 'Export interactive HTML reports with all visualizations', icon: FileDown },
          ].map((f) => (
            <div key={f.title} className="bg-background border border-border rounded-lg p-5">
              <div className="bg-primary/10 rounded-lg p-2 inline-flex mb-3"><f.icon className="w-8 h-8 text-primary" /></div>
              <h3 className="text-lg font-semibold text-text-primarymb-1">{f.title}</h3>
              <p className="text-sm text-text-secondary">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* How to Use */}
        <div className="bg-background border border-border rounded-lg p-5 mb-12">
          <h2 className="font-semibold text-text-primarymb-4">How to Use</h2>
          <div className="space-y-6">
            {steps.map((step) => (
              <div key={step.title} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-white font-bold flex items-center justify-center">
                  {step.icon}
                </div>
                <div className="pt-1">
                  <h3 className="text-lg font-semibold text-text-primarymb-1">{step.title}</h3>
                  <p className="text-text-secondary text-sm">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* File Requirements */}
        <div className="bg-info/5 border-info/20 rounded-lg p-5 mb-12">
          <h2 className="font-semibold text-text-primarymb-4">Input File Requirements</h2>
          <div className="space-y-3 text-text-primary">
            <p><strong>Filename pattern:</strong></p>
            <code className="block bg-surface rounded-lg px-4 py-2 border border-info/20 font-mono text-sm text-text-primary">
              PSM_ExperimentName_Condition_ReplicateNumber.csv
            </code>
            <p className="text-sm text-text-secondary mt-4">
              Examples: <code className="bg-surface px-2 py-0.5 rounded border border-info/20 text-xs">PSM_Exp1_Control_1.csv</code>, <code className="bg-surface px-2 py-0.5 rounded border border-info/20 text-xs">PSM_Exp1_Treated_1.csv</code>
            </p>
            <p className="mt-4"><strong>Required CSV columns:</strong></p>
            <div className="flex flex-wrap gap-2">
              {['Sequence', 'Modifications', 'Charge', 'Contaminant', 'Master Protein Accessions', 'Quan Info', 'Abundance'].map(c => (
                <span key={c} className="bg-surface px-3 py-1 rounded-full text-xs font-medium border border-info/20 text-text-primary">{c}</span>
              ))}
            </div>
            <p className="mt-2"><strong>Minimum replicates:</strong> 3 per condition</p>
          </div>
        </div>

        {/* Processing Pipeline */}
        <div className="bg-background border border-border rounded-lg p-5 mb-12">
          <h2 className="font-semibold text-text-primarymb-4">Processing Pipeline</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-text-primary">Step</th>
                  <th className="text-left py-3 px-4 font-semibold text-text-primary">Description</th>
                  <th className="text-left py-3 px-4 font-semibold text-text-primary">Technology</th>
                </tr>
              </thead>
              <tbody>
                {pipelineSteps.map((s) => (
                  <tr key={s.range} className="border-b border-border hover:bg-surface">
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface text-xs font-bold text-text-primary">
                        {s.range}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-primary">{s.desc}</td>
                    <td className="py-3 px-4">
                      <span className="bg-surface text-text-primarypx-3 py-1 rounded-full text-xs font-medium">{s.tech}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tech Stack */}
        <div className="bg-background border border-border rounded-lg p-5 mb-12">
          <h2 className="font-semibold text-text-primarymb-4">Tech Stack</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-semibold text-text-primarymb-2 flex items-center gap-2">
                <div className="bg-primary/10 rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-primary" /></div> Frontend
              </h3>
              <p className="text-sm text-text-secondary">Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js</p>
            </div>
            <div>
              <h3 className="font-semibold text-text-primarymb-2 flex items-center gap-2">
                <div className="bg-primary/10 rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-primary" /></div> Backend
              </h3>
              <p className="text-sm text-text-secondary">FastAPI, Python 3.11+, Pydantic, asyncio</p>
            </div>
            <div>
              <h3 className="font-semibold text-text-primarymb-2 flex items-center gap-2">
                <div className="bg-primary/10 rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-primary" /></div> Analysis
              </h3>
              <p className="text-sm text-text-secondary">R 4.3+, msqrob2, QFeatures, limma, gseapy</p>
            </div>
          </div>
        </div>

        {/* Quick Setup */}
        <div className="bg-background border border-border rounded-lg p-5 mb-12">
          <h2 className="font-semibold text-text-primarymb-4">Quick Setup</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-text-primarymb-2">1. Install R Packages</h3>
              <pre className="bg-surface rounded-lg p-4 text-sm text-text-primaryoverflow-x-auto">
{`Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
"`}
              </pre>
            </div>
            <div>
              <h3 className="font-medium text-text-primarymb-2">2. Install Dependencies</h3>
              <pre className="bg-surface rounded-lg p-4 text-sm text-text-primaryoverflow-x-auto">
{`# Backend (from project root)
pip install -r backend/requirements.txt

# Frontend (from project root)
cd frontend && npm install`}
              </pre>
            </div>
            <div>
              <h3 className="font-medium text-text-primarymb-2">3. Start the App</h3>
              <pre className="bg-surface rounded-lg p-4 text-sm text-text-primaryoverflow-x-auto">
{`# Terminal 1 - Backend
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev

# Access at http://localhost:3000`}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-text-muted text-sm space-y-2">
          <p>ProteomicsViz v1.0.0</p>
          <p>
            Contact:{' '}
            <a href="https://github.com/Ametrin-Yink" target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary font-medium">
              Ametrin-Yink on GitHub
            </a>
          </p>
          <p>MIT License — see LICENSE file for details.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * About Page
 *
 * Styled documentation page rendering the README content.
 */

import { FlaskConical, Upload, Settings, BarChart3, FileDown, Cpu, Layers } from 'lucide-react';

const steps = [
  { icon: '1', title: 'Create a Session', desc: 'From the welcome page, create a new analysis session and give it a name.' },
  { icon: '2', title: 'Upload Data', desc: 'Upload PSM CSV files named as PSM_ExperimentName_Condition_ReplicateNumber.csv. Minimum 3 replicates per condition.' },
  { icon: '3', title: 'Configure & Process', desc: 'Set analysis parameters and start the 9-step pipeline. Progress is shown in real time.' },
  { icon: '4', title: 'View Results', desc: 'Explore interactive volcano plots, QC plots, and GSEA enrichment analysis.' },
  { icon: '5', title: 'Export', desc: 'Download results as CSV or generate a comprehensive PDF report.' },
];

const pipelineSteps = [
  { range: '1-5', desc: 'Combine, filter, and clean PSM data', tech: 'Python/Pandas' },
  { range: '6', desc: 'Protein abundance aggregation', tech: 'R/msqrob2' },
  { range: '7', desc: 'Differential expression analysis', tech: 'R/msqrob2' },
  { range: '8', desc: 'QC metrics (PCA, CV, distributions)', tech: 'Python/sklearn' },
  { range: '9', desc: 'Gene Set Enrichment Analysis', tech: 'Python/gseapy' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50 pt-14">
      <div className="max-w-4xl mx-auto px-8 py-12">

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#E73564] to-[#00ADEF] flex items-center justify-center shadow-lg">
            <FlaskConical className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Proteomics Visualization Web App</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Full-stack scientific web application for proteomics data analysis and visualization.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {[
            { title: 'Data Input', desc: 'Upload proteomics CSV files with automatic validation', icon: Upload },
            { title: 'Processing Pipeline', desc: '9-step analysis pipeline with real-time progress tracking', icon: Settings },
            { title: 'Visualization', desc: 'Interactive volcano plots, QC plots, and GSEA enrichment plots', icon: BarChart3 },
            { title: 'Session Management', desc: 'Persistent sessions that survive server restarts', icon: Layers },
            { title: 'PDF Reports', desc: 'Export comprehensive analysis reports', icon: FileDown },
          ].map((f) => (
            <div key={f.title} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded-lg p-2 inline-flex mb-3"><f.icon className="w-8 h-8 text-white" /></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* How to Use */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">How to Use</h2>
          <div className="space-y-6">
            {steps.map((step) => (
              <div key={step.title} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-[#E73564] to-[#00ADEF] text-white font-bold flex items-center justify-center">
                  {step.icon}
                </div>
                <div className="pt-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{step.title}</h3>
                  <p className="text-gray-600 text-sm">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* File Requirements */}
        <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-200 p-8 mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Input File Requirements</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>Filename pattern:</strong></p>
            <code className="block bg-white rounded-lg px-4 py-2 border border-cyan-200 font-mono text-sm text-gray-800">
              PSM_ExperimentName_Condition_ReplicateNumber.csv
            </code>
            <p className="text-sm text-gray-600 mt-4">
              Examples: <code className="bg-white px-2 py-0.5 rounded border border-cyan-200 text-xs">PSM_Exp1_Control_1.csv</code>, <code className="bg-white px-2 py-0.5 rounded border border-cyan-200 text-xs">PSM_Exp1_Treated_1.csv</code>
            </p>
            <p className="mt-4"><strong>Required CSV columns:</strong></p>
            <div className="flex flex-wrap gap-2">
              {['Sequence', 'Modifications', 'Charge', 'Contaminant', 'Master Protein Accessions', 'Quan Info', 'Abundance'].map(c => (
                <span key={c} className="bg-white px-3 py-1 rounded-full text-xs font-medium border border-cyan-200 text-gray-700">{c}</span>
              ))}
            </div>
            <p className="mt-2"><strong>Minimum replicates:</strong> 3 per condition</p>
          </div>
        </div>

        {/* Processing Pipeline */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Processing Pipeline</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Step</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Description</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Technology</th>
                </tr>
              </thead>
              <tbody>
                {pipelineSteps.map((s) => (
                  <tr key={s.range} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-xs font-bold text-gray-700">
                        {s.range}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">{s.desc}</td>
                    <td className="py-3 px-4">
                      <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">{s.tech}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tech Stack */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Tech Stack</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <div className="bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-white" /></div> Frontend
              </h3>
              <p className="text-sm text-gray-600">Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <div className="bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-white" /></div> Backend
              </h3>
              <p className="text-sm text-gray-600">FastAPI, Python 3.11+, Pydantic, asyncio</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <div className="bg-gradient-to-br from-[#E73564] to-[#00ADEF] rounded p-1 inline-flex"><Cpu className="w-4 h-4 text-white" /></div> Analysis
              </h3>
              <p className="text-sm text-gray-600">R 4.3+, msqrob2, QFeatures, limma, gseapy</p>
            </div>
          </div>
        </div>

        {/* Quick Setup */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Quick Setup</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-900 mb-2">1. Install R Packages</h3>
              <pre className="bg-gray-100 rounded-lg p-4 text-sm text-gray-800 overflow-x-auto">
{`Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
"`}
              </pre>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 mb-2">2. Install Dependencies</h3>
              <pre className="bg-gray-100 rounded-lg p-4 text-sm text-gray-800 overflow-x-auto">
{`# Backend (from project root)
pip install -r backend/requirements.txt

# Frontend (from project root)
cd frontend && npm install`}
              </pre>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 mb-2">3. Start the App</h3>
              <pre className="bg-gray-100 rounded-lg p-4 text-sm text-gray-800 overflow-x-auto">
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
        <div className="text-center text-gray-500 text-sm space-y-2">
          <p>ProteomicsViz v1.0.0</p>
          <p>
            Contact:{' '}
            <a href="https://github.com/Ametrin-Yink" target="_blank" rel="noopener noreferrer" className="text-[#00ADEF] hover:text-[#E73564] font-medium">
              Ametrin-Yink on GitHub
            </a>
          </p>
          <p>MIT License — see LICENSE file for details.</p>
        </div>
      </div>
    </div>
  );
}

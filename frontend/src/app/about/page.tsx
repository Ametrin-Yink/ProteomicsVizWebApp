/**
 * About Page
 *
 * Information about the ProteomicsViz project, its purpose,
 * technology stack, and team.
 */

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50 pt-14">
      <div className="max-w-4xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">About ProteomicsViz</h1>
          <p className="text-xl text-gray-600">
            A modern web platform for proteomics data analysis and visualization
          </p>
        </div>

        {/* Mission */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Our Mission</h2>
          <p className="text-gray-600 leading-relaxed">
            ProteomicsViz aims to democratize proteomics data analysis by providing an intuitive,
            web-based platform for researchers to analyze protein abundance data without requiring
            deep computational expertise. We bridge the gap between complex bioinformatics tools
            and accessible data visualization.
          </p>
        </div>

        {/* Features */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Key Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Statistical Analysis</h3>
              <p className="text-gray-600 text-sm">
                Powered by established R packages including msqrob2, QFeatures, and limma
                for robust differential expression analysis.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Interactive Visualizations</h3>
              <p className="text-gray-600 text-sm">
                Real-time charts and plots using Plotly.js for exploring your data
                with zoom, pan, and selection capabilities.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Multiple Analysis Types</h3>
              <p className="text-gray-600 text-sm">
                Support for pairwise comparison, multi-condition, time course,
                and pathway enrichment analyses.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Quality Control</h3>
              <p className="text-gray-600 text-sm">
                Built-in QC metrics and plots including PCA, sample correlation,
                and missing value analysis.
              </p>
            </div>
          </div>
        </div>

        {/* Technology Stack */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Technology Stack</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-24 font-medium text-gray-700">Frontend</div>
              <div className="text-gray-600">
                Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-24 font-medium text-gray-700">Backend</div>
              <div className="text-gray-600">
                FastAPI, Python 3.11+, Pydantic, asyncio
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-24 font-medium text-gray-700">Analysis</div>
              <div className="text-gray-600">
                R 4.3+, msqrob2, QFeatures, limma, gseapy
              </div>
            </div>
          </div>
        </div>

        {/* Version */}
        <div className="text-center text-gray-500 text-sm">
          ProteomicsViz v1.0.0
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-text-muted mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-text mb-2">Page Not Found</h2>
        <p className="text-text-muted mb-6">The page you are looking for does not exist.</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#E73564] to-[#00ADEF] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}

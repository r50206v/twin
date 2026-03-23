import Twin from '@/components/twin';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center text-gray-800 mb-2">
            Hi, I'm Richard — Ask Me Anything
          </h1>
          <p className="text-center text-gray-600 mb-8">
            Data by day, curiosity always
          </p>
          <div className="mb-8 flex items-center justify-center gap-4 text-sm text-gray-600 whitespace-nowrap">
            <a
              href="https://www.linkedin.com/in/yi-ping-tseng/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <img src="/linkedin.svg" alt="LinkedIn logo" className="h-4 w-4" />
              LinkedIn
            </a>
            <span aria-hidden="true">|</span>
            <a
              href="https://github.com/r50206v"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <img src="/github.svg" alt="GitHub logo" className="h-4 w-4" />
              GitHub
            </a>
            <span aria-hidden="true">|</span>
            <a
              href="mailto:yiping.t@columbia.edu"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              📧 yiping.t@columbia.edu
            </a>
          </div>

          <div className="h-[600px]">
            <Twin />
          </div>

          <footer className="mt-8 text-center text-sm text-gray-500">
            <p>v1.0 Updated March 2026 — Still under construction, just like me</p>
          </footer>
        </div>
      </div>
    </main>
  );
}
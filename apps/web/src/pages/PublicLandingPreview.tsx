import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner } from '@brandforge/ui';
import { apiUrl } from '@/lib/api';

export function PublicLandingPreview() {
  const { publicId = '' } = useParams();
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setHtml('');
    fetch(apiUrl(`/api/v1/public/landing-pages/${publicId}/preview`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Preview unavailable: ${response.status}`);
        return response.text();
      })
      .then(setHtml)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, [publicId]);

  if (failed) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Esta vista previa no está disponible</p>
          <p className="mt-2 text-sm text-slate-400">El enlace puede haberse despublicado o haber cambiado.</p>
        </div>
      </main>
    );
  }

  if (!html) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-violet-400"><Spinner size="lg" /></main>;
  }

  return (
    <iframe
      title="Landing page"
      srcDoc={html}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="block h-screen w-full border-0 bg-white"
    />
  );
}

// api/descobrir.js — Descobre endpoints reais do Comprasnet inspecionando o bundle Angular
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web';
  const hdrs = {
    'Accept': 'text/html,application/xhtml+xml,*/*',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  };

  try {
    // 1. Pega o HTML da página principal
    const htmlRes = await fetch(`${base}/public/compras/acompanhamento-compra?compra=92595805900622026`, {
      headers: hdrs, signal: AbortSignal.timeout(8000),
    });
    const html = await htmlRes.text();

    // 2. Extrai src de scripts
    const scriptSrcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);

    // 3. Tenta buscar o main bundle
    const mainScript = scriptSrcs.find(s => s.includes('main') || s.includes('chunk'));
    let apiUrls = [];
    let bundlePreview = '';

    if (mainScript) {
      const scriptUrl = mainScript.startsWith('http')
        ? mainScript
        : `https://cnetmobile.estaleiro.serpro.gov.br${mainScript}`;
      try {
        const jsRes = await fetch(scriptUrl, { headers: hdrs, signal: AbortSignal.timeout(10000) });
        const js = await jsRes.text();
        bundlePreview = js.substring(0, 500);
        // Procura padrões de URL de API (strings com /api/, /rest/, /services/)
        // Pega todos os contextos onde comprasnet-mensagem aparece
        let searchFrom = 0;
        while (true) {
          const idx = js.indexOf('comprasnet-mensagem', searchFrom);
          if (idx < 0) break;
          apiUrls.push('CTX:' + js.substring(Math.max(0, idx - 30), idx + 200));
          searchFrom = idx + 1;
          if (apiUrls.length > 30) break;
        }
      } catch(e) {
        bundlePreview = 'Erro ao buscar bundle: ' + e.message;
      }
    }

    return res.status(200).json({
      htmlStatus: htmlRes.status,
      scripts: scriptSrcs,
      mainScript,
      apiUrls,
      bundlePreview,
    });
  } catch(e) {
    return res.status(200).json({ erro: e.message });
  }
}

// api/mensagens.js — Proxy server-side para mensagens do Comprasnet
// Browser não consegue chamar cnetmobile (CORS). Vercel server-to-server pode.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo, pagina = '1', tam = '20' } = req.query;
  if (!codigo) return res.status(400).json({ erro: 'codigo obrigatório' });

  const pg = Number(pagina) || 1;
  const sz = Number(tam) || 20;
  const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public';

  const tentativas = [];
  const root = 'https://cnetmobile.estaleiro.serpro.gov.br';
  // Contexto real descoberto no bundle Angular: /comprasnet-mensagem
  const msgBase = `${root}/comprasnet-mensagem`;
  const endpoints = [
    // Contexto /comprasnet-mensagem — endpoint real da API
    `${msgBase}/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/compra/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/mensagens?compra=${codigo}&pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/api/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/public/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/compras/${codigo}?pagina=${pg}&tamanhoPagina=${sz}`,
    // Paths antigos como fallback
    `${base}/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${base}/api/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
  ];

  const xhrHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${base}/compras/acompanhamento-compra?compra=${codigo}`,
    'Origin': 'https://cnetmobile.estaleiro.serpro.gov.br',
  };

  for (const url of endpoints) {
    const tentativa = { url, status: null, ct: null, erro: null, dados: null };
    try {
      const r = await fetch(url, {
        headers: xhrHeaders,
        signal: AbortSignal.timeout(7000),
      });
      tentativa.status = r.status;
      tentativa.ct = r.headers.get('content-type') || '';

      const body = await r.text();
      tentativa.bodyPreview = body.substring(0, 300);

      if (r.ok && tentativa.ct.includes('json')) {
        const d = JSON.parse(body);
        const msgs = Array.isArray(d) ? d
          : (d.content || d.mensagens || d.data || d.items || d.result || []);
        const total = d.totalElements || d.total || d.totalRegistros || msgs.length;
        tentativa.dados = { msgs, total };
        tentativas.push(tentativa);
        // Sucesso — retorna imediatamente
        return res.status(200).json({
          ok: true,
          mensagens: msgs,
          total,
          pagina: pg,
          fonte: url,
          debug: tentativas,
        });
      }
    } catch (e) {
      tentativa.erro = e.message;
    }
    tentativas.push(tentativa);
  }

  // Nenhum endpoint funcionou
  return res.status(200).json({
    ok: false,
    mensagens: [],
    total: 0,
    fonte: null,
    debug: tentativas,
  });
}

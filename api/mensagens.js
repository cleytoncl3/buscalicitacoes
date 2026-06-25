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
  const msgBase = `${root}/comprasnet-mensagem`;
  // codigo = UASG(6)+MOD(2)+NUM(5)+ANO(4) = 92595805900622026
  // Tenta variações de path para o Spring Boot da comprasnet-mensagem
  const endpoints = [
    `${msgBase}/v1/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/api/v1/compras/${codigo}/mensagens?pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/v1/mensagens?codigoCompra=${codigo}&pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/v1/mensagens?compra=${codigo}&pagina=${pg}&tamanhoPagina=${sz}`,
    `${msgBase}/mensagens/compra/${codigo}?pagina=${pg}&tamanhoPagina=${sz}`,
    // Swagger/OpenAPI para descobrir os paths reais
    `${msgBase}/v3/api-docs`,
    `${msgBase}/swagger-ui.html`,
    `${msgBase}/actuator/mappings`,
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

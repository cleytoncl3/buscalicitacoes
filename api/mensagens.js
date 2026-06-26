// api/mensagens.js — Proxy server-side para mensagens do Comprasnet
// Endpoint real: /comprasnet-mensagem/v2/chat/{chaveCompra}?captcha=...
// Deprecated (sem captcha): /comprasnet-mensagem/api/v1/chat/{chaveCompra}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo, pagina = '1', tam = '20', captcha } = req.query;
  if (!codigo) return res.status(400).json({ erro: 'codigo obrigatório' });

  const pg = Number(pagina) || 1;
  const sz = Number(tam) || 20;
  const root = 'https://cnetmobile.estaleiro.serpro.gov.br';
  const msgBase = `${root}/comprasnet-mensagem`;

  const hdrs = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${root}/comprasnet-web/public/compras/acompanhamento-compra?compra=${codigo}`,
    'Origin': root,
  };

  const tentativas = [];

  // Ordem: deprecated (sem captcha) → v2 sem captcha → v2 com captcha do browser
  const endpoints = [
    // Deprecated: 1-based pagination, provavelmente sem captcha obrigatório
    `${msgBase}/api/v1/chat/${codigo}?tamanhoPagina=${sz}&pagina=${pg}`,
    // v2 sem captcha (server-side IPs podem ser isentos)
    `${msgBase}/v2/chat/${codigo}?size=${sz}&page=${pg - 1}&legadoAsp=false`,
    // v2 com captcha passado pelo browser (se disponível)
    ...(captcha ? [`${msgBase}/v2/chat/${codigo}?size=${sz}&page=${pg - 1}&legadoAsp=false&captcha=${encodeURIComponent(captcha)}`] : []),
  ];

  for (const url of endpoints) {
    const t = { url, status: null, ct: null, erro: null };
    try {
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(8000) });
      t.status = r.status;
      t.ct = r.headers.get('content-type') || '';

      const body = await r.text();
      t.bodyPreview = body.substring(0, 400);

      if ((r.ok || r.status === 206) && t.ct.includes('json')) {
        let d;
        try { d = JSON.parse(body); } catch { tentativas.push(t); continue; }

        // v2 responde com Page<MensagemChatRepresentation>: {content:[...], totalElements, ...}
        // v1 deprecated pode responder com array direto ou {content:[...]}
        const msgs = Array.isArray(d) ? d
          : (d.content || d.mensagens || d.data || d.items || d.result || []);
        const total = d.totalElements ?? d.total ?? d.totalRegistros ?? msgs.length;

        t.dados = { msgs, total };
        tentativas.push(t);
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
      t.erro = e.message;
    }
    tentativas.push(t);
  }

  return res.status(200).json({
    ok: false,
    mensagens: [],
    total: 0,
    fonte: null,
    debug: tentativas,
  });
}

// api/numeros-compra.js — busca em lote os números reais (Comprasnet) para uma lista de controles PNCP
// GET ?controles=cnpj-seq-000216/2026,cnpj-seq-000042/2026,...
// Retorna: { "cnpj-1-000216/2026": { numeroCompra: "90004", anoCompra: 2026 }, ... }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { controles } = req.query;
  if (!controles) return res.status(400).json({ erro: 'controles obrigatório' });

  const hdrs = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

  const parseControle = (c) => {
    const m = c.match(/^(\d+)-(\d+)-(\d+)\/(\d+)$/);
    if (!m) return null;
    return { cnpj: m[1], seqOrgao: m[2], seq: parseInt(m[3]), ano: m[4] };
  };

  const fetchNumero = async (controle) => {
    const p = parseControle(controle.trim());
    if (!p) return [controle, null];
    const url = `https://pncp.gov.br/api/consulta/v1/orgaos/${p.cnpj}/compras/${p.ano}/${p.seq}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, { headers: hdrs, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return [controle, null];
      const d = await r.json();
      const ci = Array.isArray(d) ? d[0] : d;
      const numeroCompra = ci?.numeroCompra || ci?.numero_compra || null;
      const anoCompra    = ci?.anoCompra    || ci?.ano_compra    || p.ano;
      return [controle, numeroCompra ? { numeroCompra, anoCompra } : null];
    } catch {
      clearTimeout(timer);
      return [controle, null];
    }
  };

  const lista = controles.split(',').slice(0, 20); // máx 20 por chamada
  const resultados = await Promise.all(lista.map(fetchNumero));
  const mapa = {};
  resultados.forEach(([c, v]) => { if (v) mapa[c] = v; });

  return res.status(200).json(mapa);
}

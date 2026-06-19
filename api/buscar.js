export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', dataFinal = '', modalidade = '' } = req.query;

  function fmt(data) { return data.replace(/-/g, ''); }

  const dataFim = dataFinal
    ? fmt(dataFinal)
    : fmt(new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  function buildUrl(p) {
    const params = new URLSearchParams({ dataFinal: dataFim, pagina: p });
    if (uf) params.append('uf', uf);
    if (modalidade) params.append('codigoModalidadeContratacao', modalidade);
    return `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?${params}`;
  }

  try {
    const promises = [1, 2, 3].map(p =>
      fetch(buildUrl(p), { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => {
          try { return JSON.parse(text); } catch { return null; }
        })
        .catch(() => null)
    );

    const resultados = await Promise.all(promises);

    let itens = [];
    resultados.forEach(r => { if (r && r.data) itens = itens.concat(r.data); });

    if (palavraChave) {
      const termo = palavraChave.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      itens = itens.filter(i => {
        const obj = (i.objetoCompra || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const info = (i.informacaoComplementar || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return obj.includes(termo) || info.includes(termo);
      });
    }

    return res.status(200).json({ data: itens, totalRegistros: itens.length });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

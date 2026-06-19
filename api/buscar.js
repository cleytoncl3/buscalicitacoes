export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', dataFinal = '', pagina = 1, modalidade = '' } = req.query;

  function fmt(data) { return data.replace(/-/g, ''); }

  const dataFim = dataFinal
    ? fmt(dataFinal)
    : fmt(new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  const params = new URLSearchParams({
    dataFinal: dataFim,
    pagina: pagina,
  });

  if (uf) params.append('uf', uf);
  if (modalidade) params.append('codigoModalidadeContratacao', modalidade);

  try {
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?${params}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ erro: `PNCP retornou: ${text.substring(0, 200)}` });
    }

    if (!response.ok) {
      return res.status(response.status).json({ erro: data.message || text });
    }

    let itens = data.data || [];

    if (palavraChave) {
      const termo = palavraChave.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      itens = itens.filter(i => {
        const obj = (i.objetoCompra || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const info = (i.informacaoComplementar || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return obj.includes(termo) || info.includes(termo);
      });
    }

    itens.sort((a, b) => new Date(a.dataEncerramentoProposta || 0) - new Date(b.dataEncerramentoProposta || 0));

    return res.status(200).json({ data: itens, totalRegistros: itens.length });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

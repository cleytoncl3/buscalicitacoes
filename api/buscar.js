export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', dataInicial = '', dataFinal = '', pagina = 1, modalidade = '' } = req.query;

  function fmt(data) {
    if (!data) return null;
    return data.replace(/-/g, '');
  }

  const dataIni = fmt(dataInicial) || fmt(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const dataFim = fmt(dataFinal) || fmt(new Date().toISOString().split('T')[0]);

  const modalidades = modalidade ? [modalidade] : ['6', '8', '4', '9', '7', '5'];

  try {
    const promises = modalidades.map(mod => {
      const params = new URLSearchParams({
        dataInicial: dataIni,
        dataFinal: dataFim,
        codigoModalidadeContratacao: mod,
        tamanhoPagina: 20,
        pagina: pagina,
      });
      if (uf) params.append('uf', uf);
      return fetch(`https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?${params}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      }).then(r => r.ok ? r.json() : null).catch(() => null);
    });

    const resultados = await Promise.all(promises);

    let itens = [];
    resultados.forEach(r => { if (r && r.data) itens = itens.concat(r.data); });

    if (palavraChave) {
      const termo = palavraChave.toLowerCase();
      itens = itens.filter(i =>
        (i.objetoCompra || '').toLowerCase().includes(termo) ||
        (i.informacaoComplementar || '').toLowerCase().includes(termo)
      );
    }

    itens.sort((a, b) => new Date(b.dataPublicacaoPncp || 0) - new Date(a.dataPublicacaoPncp || 0));

    return res.status(200).json({ data: itens, totalRegistros: itens.length });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

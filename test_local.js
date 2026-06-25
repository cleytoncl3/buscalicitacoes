const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--no-proxy-server']
  });
  const page = await browser.newPage();

  await page.goto('http://127.0.0.1:8899', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  // ---- Verificações de UI ----
  const vBadge = await page.locator('span[title="Versão do sistema"]').textContent().catch(()=>'NAO ENCONTRADO');
  console.log('Badge versão:', vBadge);
  console.log('navChat:', await page.locator('#navChat').count() > 0 ? '✅ existe' : '❌');

  // Sessões ao Vivo não deve estar no dropdown Pesquisar
  await page.click('#navOportunidades');
  await page.waitForTimeout(300);
  const sessNoMenu = await page.locator('#dropOportunidades').locator('text=Sessões').count();
  console.log('Sessões fora do Pesquisar dropdown:', sessNoMenu === 0 ? '✅' : '❌ ainda presente');
  await page.screenshot({ path: '/tmp/s1_nav.png' });

  // Vai para Sessões ao Vivo
  await page.click('#navChat');
  await page.waitForTimeout(500);
  console.log('View chatMonitor ativa:', await page.locator('#viewChatMonitor.ativo').count() > 0 ? '✅' : '❌');
  console.log('navChat ativo:', await page.locator('#navChat.ativo').count() > 0 ? '✅' : '❌');
  await page.screenshot({ path: '/tmp/s2_sessoes.png' });

  // Clica aba Adicionar Certame (é um .chat-aba, não button)
  await page.locator('#chatAba-buscar').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/s3_aba.png' });

  // Preenche formulário
  await page.fill('#chatUasg', '925958');
  await page.selectOption('#chatModalidade', '05');
  await page.fill('#chatNumCompra', '90062');
  await page.fill('#chatAno', '2026');
  await page.waitForTimeout(500);

  const codigoPreview = await page.locator('#chatCodigoValor').textContent().catch(()=>'—');
  console.log('\nCódigo gerado:', codigoPreview.trim());
  console.log('Esperado:      92595805900622026');
  console.log('Match:', codigoPreview.trim() === '92595805900622026' ? '✅ CORRETO' : '❌ ERRADO');
  await page.screenshot({ path: '/tmp/s4_form.png' });

  // Botão Adicionar
  const addBtn = page.locator('button').filter({ hasText: /^Adicionar$/ });
  console.log('\nBotão Adicionar:', await addBtn.count() > 0 ? '✅ existe' : '❌ não encontrado');

  await browser.close();
  console.log('\n✅ Screenshots em /tmp/s1_nav.png até s4_form.png');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

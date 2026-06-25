const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const apiLogs = [];
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      try {
        const body = await r.text();
        apiLogs.push({ url: r.url(), status: r.status(), body: body.substring(0, 600) });
      } catch {}
    }
  });

  // Testa via buscalicitacoes.vercel.app (domínio direto Vercel)
  const url = 'https://buscalicitacoes.vercel.app';
  console.log('=== Abrindo', url, '===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/s1_home.png' });
  console.log('✅ Home carregada');

  // Clica no botão Sessões ao Vivo
  console.log('\n=== Navegando para Sessões ao Vivo ===');
  const navChat = page.locator('#navChat');
  const count = await navChat.count();
  console.log('navChat encontrado:', count > 0);
  if (count > 0) {
    await navChat.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/s2_chat.png' });
  } else {
    console.log('BOTÃO NÃO ENCONTRADO — tentando via URL hash');
    await page.goto(url + '#chatMonitor', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/s2_chat.png' });
  }

  // Clica em Adicionar Certame
  console.log('\n=== Clicando Adicionar Certame ===');
  const addBtn = page.locator('text=+ Adicionar Certame');
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(600);
  }

  // Preenche formulário
  console.log('Preenchendo formulário...');
  await page.fill('#chatUasg', '925958');
  await page.selectOption('#chatModalidade', '05');
  await page.fill('#chatNumCompra', '90062');
  const anoField = page.locator('#chatAno');
  if (await anoField.count() > 0) {
    await anoField.fill('2026');
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/s3_form.png' });

  // Código preview
  const preview = await page.locator('#chatCodigoValor').textContent().catch(()=>'');
  console.log('Código preview:', preview);

  // Clica Adicionar
  console.log('Clicando Adicionar...');
  const addCertame = page.locator('button').filter({ hasText: /Adicionar$/ });
  if (await addCertame.count() > 0) {
    await addCertame.click();
  } else {
    await page.locator('button:has-text("Adicionar")').first().click();
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/s4_after_add.png' });

  const statusHtml = await page.locator('#chatBuscarStatus').innerHTML().catch(() => '—');
  console.log('\nStatus após adicionar:', statusHtml);

  // Vai para Monitorados
  console.log('\n=== Aba Monitorados ===');
  await page.locator('text=Monitorados').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/s5_monitorados.png' });
  const listaHtml = await page.locator('#chatListaMonitorados').innerHTML().catch(() => '');
  console.log('Lista (300 chars):', listaHtml.substring(0, 300));

  console.log('\n=== API Logs ===');
  apiLogs.forEach(l => console.log(`[${l.status}] ${l.url.split('/api/')[1]||l.url}\n  ${l.body.substring(0,300)}\n`));

  await browser.close();
  console.log('\n✅ Screenshots em /tmp/s1..s5_*.png');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

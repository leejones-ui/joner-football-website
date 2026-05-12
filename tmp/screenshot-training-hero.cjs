const puppeteer = require('/Users/jonerai/.openclaw/workspace/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4325/training/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.screenshot({ path: '/Users/jonerai/.openclaw/workspace/tmp/training-hero-mobile.png', fullPage: false });
  await page.setViewport({ width: 1440, height: 920, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4325/training/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.screenshot({ path: '/Users/jonerai/.openclaw/workspace/tmp/training-hero-desktop.png', fullPage: false });
  await browser.close();
})();

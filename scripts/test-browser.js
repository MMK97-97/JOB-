import { BrowserManager } from '../core/browser.js';

async function test() {
  console.log('Testing stealth browser launch...');
  const browser = new BrowserManager({ headless: true });
  await browser.launch();
  const page = await browser.getPage();

  console.log('Navigating to Indeed to verify connectivity and stealth headers...');
  await page.goto('https://www.indeed.com/jobs?q=Supply+Chain&l=Sarasota%2C+FL', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const title = await page.title();
  console.log('Page Title:', title);

  const shot = await browser.takeScreenshot('test-indeed');
  console.log('Saved test screenshot to:', shot);

  await browser.close();
  console.log('Browser test completed successfully!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

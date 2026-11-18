#!/usr/bin/env node

import { createServer } from './ui/server.js';
import { JobAgent } from './core/agent.js';
import chalk from 'chalk';
import { exec } from 'child_process';

const args = process.argv.slice(2);

async function main() {
  const isDashboard = args.includes('--dashboard') || args.includes('-d') || args.length === 0;
  const isRun = args.includes('--run') || args.includes('-r');
  const isDryRun = args.includes('--dry-run');
  const isTest = args.includes('--test');
  const isLogin = args.includes('--login');

  console.log(chalk.bold.blue('\n======================================================'));
  console.log(chalk.bold.blue('        AUTONOMOUS JOB APPLYING AGENT v1.0            '));
  console.log(chalk.bold.blue('======================================================\n'));

  if (isLogin) {
    console.log(chalk.cyan('Launching persistent browser profile for session login...'));
    const agent = new JobAgent();
    await agent.browserManager.launch();
    const page = await agent.browserManager.getPage();

    console.log(chalk.yellow('Navigating to Indeed sign-in page...'));
    await page.goto('https://secure.indeed.com/auth', { waitUntil: 'domcontentloaded' }).catch(() => {});

    // Open LinkedIn in a second tab
    try {
      const liPage = await agent.browserManager.browser.newPage();
      console.log(chalk.yellow('Opening LinkedIn sign-in page in a second tab...'));
      await liPage.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
    } catch (e) {}

    console.log(chalk.bold.green('\n Both login tabs are now open in your Chrome window!'));
    console.log(chalk.cyan('👉 Tab 1: Log in to your Indeed account'));
    console.log(chalk.cyan('👉 Tab 2: Log in to your LinkedIn account'));
    console.log(chalk.gray('\nOnce you finish logging in, simply close the Chrome browser window.'));
    console.log(chalk.gray('Your login session will be permanently saved in ./data/chrome-profile.\n'));

    // Keep process alive until user closes browser
    await new Promise((resolve) => {
      agent.browserManager.browser.on('disconnected', resolve);
    });
    console.log(chalk.green('Session saved successfully! You are ready to run the agent.'));
    return;
  }

  if (isTest) {
    console.log(chalk.cyan('Running stealth browser diagnostics...'));
    const agent = new JobAgent();
    await agent.browserManager.launch();
    const page = await agent.browserManager.getPage();
    await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle2' });
    console.log(chalk.green('Stealth test page loaded. Check the browser window for bot detection results.'));
    return;
  }

  if (isRun) {
    // Determine board
    const boardIndex = args.indexOf('--board');
    const board = boardIndex !== -1 ? args[boardIndex + 1] : 'indeed';

    console.log(chalk.yellow(`Starting Job Agent in CLI mode... [Board: ${board.toUpperCase()}]`));
    const agent = new JobAgent();
    await agent.start({
      board,
      dryRun: isDryRun
    });
    return;
  }

  // Default: Start Web Dashboard
  const port = process.env.PORT || 3000;
  const { server } = createServer(port);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(chalk.yellow(`\n Port ${port} is already in use by another instance.`));
      console.log(chalk.bold(` You can access the already running dashboard at: `) + chalk.cyan.underline(`http://localhost:${port}\n`));
      const openCmd = process.platform === 'win32' ? `start http://localhost:${port}` :
                      process.platform === 'darwin' ? `open http://localhost:${port}` :
                      `xdg-open http://localhost:${port}`;
      exec(openCmd);
    } else {
      console.error(chalk.red('Server error:'), err);
    }
  });

  server.listen(port, () => {
    console.log(chalk.bold.green(`\n Web Dashboard is active and running!`));
    console.log(chalk.bold(` Access URL: `) + chalk.cyan.underline(`http://localhost:${port}`));
    console.log(chalk.yellow(` Opening dashboard in your browser...`));
    console.log(chalk.gray(`\n [NOTE] Keep this terminal window open while using the dashboard.`));
    console.log(chalk.gray(` Only press Ctrl+C when you want to stop the server.\n`));

    // Automatically open the user's browser
    const openCmd = process.platform === 'win32' ? `start http://localhost:${port}` :
                    process.platform === 'darwin' ? `open http://localhost:${port}` :
                    `xdg-open http://localhost:${port}`;
    exec(openCmd);
  });
}

main().catch(err => {
  console.error(chalk.red('Fatal error during startup:'), err);
});

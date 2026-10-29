'use strict';

// Скриншоты экранов для проверки вёрстки и README. Только для разработки:
//   LIFEVPN_SHOTS=<папка> npx electron . --demo
// LIFEVPN_SHOT_STEPS — список шагов через запятую (по умолчанию all).

const fs = require('fs');
const path = require('path');

module.exports = function shots(getWindow, app, extras) {
  const dir = process.env.LIFEVPN_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const js = (code) => getWindow().webContents.executeJavaScript(code);
  const click = (selector, index = 0) => js(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`);
  const tab = (id) => click(`.side-row[data-tab="${id}"]`);
  const capture = async (name, wait = 600) => {
    await sleep(wait);
    const image = await getWindow().webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  };

  (async () => {
    await extras.setLanguage(process.env.LIFEVPN_LANG || 'ru');
    await sleep(700);
    await capture('00-splash', 0);
    await sleep(2200);
    const steps = (process.env.LIFEVPN_SHOT_STEPS || 'all').split(',');
    const want = (n) => steps.includes('all') || steps.includes(n);

    if (want('home')) await capture('01-home');
    if (want('connect')) {
      await extras.connect();
      await capture('02-connecting', 300);
      await sleep(1400);
      await capture('03-connected');
    }
    if (want('menu')) {
      await click('.side-header .round-btn', 0);
      await capture('04-add-menu');
      await js("document.querySelector('.overlay-layer').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    }
    if (want('servers')) { await tab('servers'); await capture('05-servers'); }
    if (want('routing')) { await tab('routing'); await capture('06-routing'); }
    if (want('stats')) {
      await tab('stats');
      await extras.speed();
      await capture('07-stats', 1900);
    }
    if (want('settings')) {
      await tab('settings');
      await capture('08-settings');
      await js("document.querySelector('.scroll').scrollTop = 1000");
      await capture('09-settings-bottom');
    }
    if (want('search')) {
      await tab('home');
      await js("const i=document.querySelector('.side-search input'); i.value='hel'; i.dispatchEvent(new Event('input',{bubbles:true}))");
      await capture('10-search');
      await js("const i=document.querySelector('.side-search input'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}))");
    }
    if (want('collapsed')) {
      await tab('home');
      await click('.side-header .round-btn', 1);
      await capture('11-collapsed', 800);
      await click('.side-header .round-btn', 0);
      await sleep(500);
    }
    if (want('sheet')) {
      await tab('routing');
      await click('.btn-outline', 0);
      await capture('12-domains-sheet');
      await js("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))");
    }
    if (want('themes')) {
      await tab('home');
      for (const id of (process.env.LIFEVPN_THEMES || 'amoled,panel,amethyst,lagoon,amber,sky,peach').split(',')) {
        await extras.setPalette(id);
        await capture(`13-theme-${id}`, 900);
      }
    }
    if (want('failed')) {
      await extras.setPalette('amoled');
      await extras.fakeState('failed');
      await capture('14-failed');
    }
    if (want('en')) {
      await extras.setLanguage('en');
      await tab('home');
      await capture('15-english');
    }
    app.exit(0);
  })().catch((error) => {
    console.error(error);
    app.exit(1);
  });
};

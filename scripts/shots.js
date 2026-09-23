'use strict';

// Скриншоты всех экранов для проверки вёрстки. Только для разработки:
// LIFEVPN_SHOTS=<папка> npx electron .

const fs = require('fs');
const path = require('path');

module.exports = function shots(getWindow, app, extras) {
  const dir = process.env.LIFEVPN_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const js = (code) => getWindow().webContents.executeJavaScript(code);
  const click = (selector, index = 0) => js(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`);
  const capture = async (name) => {
    await sleep(450);
    const image = await getWindow().webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  };

  (async () => {
    await sleep(900);
    await capture('00-splash');
    await sleep(2200);
    const steps = (process.env.LIFEVPN_SHOT_STEPS || 'all').split(',');
    const want = (n) => steps.includes('all') || steps.includes(n);

    if (want('home')) await capture('01-home');
    if (want('scroll')) {
      await js("document.querySelector('.scroll').scrollTop = 400");
      await capture('02-home-scrolled');
      await js("document.querySelector('.scroll').scrollTop = 0");
    }
    if (want('menu')) {
      await click('.add-button');
      await capture('03-add-menu');
      await js("document.querySelector('.overlay-layer').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    }
    if (want('servers')) {
      await click('.tab', 1);
      await sleep(1500);
      await capture('04-servers');
    }
    if (want('settings')) {
      await click('.tab', 2);
      await capture('05-settings');
      await js("document.querySelector('.scroll').scrollTop = 1000");
      await capture('06-settings-bottom');
    }
    if (want('sheet')) {
      await click('.tab', 0);
      await sleep(200);
      await click('.add-button');
      await sleep(200);
      await click('.menu-row', 3);
      await capture('07-add-sheet');
      await js("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))");
    }
    if (want('themes')) {
      for (const id of ['night', 'amoled', 'peach']) {
        await extras.setPalette(id);
        await click('.tab', 0);
        await capture(`08-theme-${id}`);
      }
      await extras.setPalette('sky');
    }
    if (want('states')) {
      await click('.tab', 0);
      await extras.fakeState('connected');
      await capture('09-connected');
      await extras.fakeState('failed');
      await capture('10-failed');
      await extras.fakeState('connecting');
      await capture('11-connecting');
    }
    if (want('e2e')) {
      await click('.tab', 0);
      const result = await extras.e2e();
      console.log('E2E', JSON.stringify(result));
      await capture('13-e2e-connected');
      await extras.speed();
      await capture('14-e2e-speed');
      console.log('SPEED', JSON.stringify(extras.speedState()));
      await extras.disconnect();
      await capture('15-e2e-disconnected');
    }
    if (want('en')) {
      await extras.setLanguage('en');
      await capture('12-english');
    }
    app.exit(0);
  })().catch((error) => {
    console.error(error);
    app.exit(1);
  });
};

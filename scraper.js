const { chromium } = require('playwright');

const API_URL = process.env.SCRAPER_URL;
const API_TOKEN = process.env.SCRAPER_TOKEN;
const DEFAULT_DISCOUNT = 35;

const MONTH_INDEX = {
  'janv.': 0,
  'févr.': 1,
  'mars':  2,
  'avr.':  3,
  'mai':   4,
  'juin':  5,
  'juil.': 6,
  'août':  7,
  'sept.': 8,
  'oct.':  9,
  'nov.':  10,
  'déc.':  11,
};

/**
 * Convertit une entrée brute du scraper en tableau de créneaux ISO.
 * Entrée  : { date: "jeudi 02 juil.", slots: ["10:30", "11:00"] }
 * Sortie  : [{ time: "2026-07-02T08:30:00.000Z", discount: 35 }, ...]
 * (les heures sont en Europe/Paris, UTC+2 en été → on soustrait 2h pour l'ISO UTC)
 */
function formatSlots(planning) {
  const year = new Date().getFullYear();
  const formatted = [];

  for (const entry of planning) {
    const parts = entry.date.trim().split(/\s+/);
    // parts ex: ["jeudi", "02", "juil."]  ou  ["02", "juil."]
    const dayPart   = parts.find(p => /^\d{1,2}$/.test(p));
    const monthPart = parts.find(p => MONTH_INDEX[p] !== undefined);

    if (!dayPart || !monthPart) {
      console.warn(`  ⚠ Date non reconnue, ignorée : "${entry.date}"`);
      continue;
    }

    const day   = parseInt(dayPart, 10);
    const month = MONTH_INDEX[monthPart];

    for (const slot of entry.slots) {
      const [hours, minutes] = slot.split(':').map(Number);
      // Construit la date en heure locale Paris puis la convertit en UTC ISO
      const localDate = new Date(year, month, day, hours, minutes, 0, 0);
      formatted.push({
        time: localDate.toISOString(),
        discount: DEFAULT_DISCOUNT,
      });
    }
  }

  return formatted;
}

async function sendToApi(planityUrl, scrapedSlots) {
  console.log(`\nEnvoi de ${scrapedSlots.length} créneau(x) vers l'API...`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',  'Authorization': `Bearer ${API_TOKEN}` },
    body: JSON.stringify({ planityUrl, scrapedSlots }),
  });

  if (response.ok) {
    const data = await response.json().catch(() => ({}));
    console.log(`Synchro réussie ! (HTTP ${response.status})`);
    if (Object.keys(data).length > 0) console.log('Réponse API :', JSON.stringify(data, null, 2));
  } else {
    const errorText = await response.text().catch(() => '');
    console.error(`Erreur API (HTTP ${response.status}) : ${errorText}`);
  }
}

function randomDelay(min = 300, max = 900) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf('--url');
  const prestationFlag = args.indexOf('--prestation');

  const url = urlFlag !== -1 ? args[urlFlag + 1] : null;
  const prestation = prestationFlag !== -1 ? args[prestationFlag + 1] : null;

  if (!url || !prestation) {
    console.error('Usage: node scraper.js --url <URL_DU_SALON> --prestation <NOM_DE_LA_PRESTATION>');
    console.error('Exemple: node scraper.js --url "https://www.planity.com/salon-exemple" --prestation "Coupe Homme"');
    process.exit(1);
  }

  return { url, prestation };
}

async function scrapeSalons() {
  const { url, prestation } = parseArgs();

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--window-size=1280,800',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Patch des propriétés navigator détectées par les anti-bots
  await context.addInitScript(() => {
    // Supprime le flag webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Simule des plugins réels
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.refresh = () => {};
        plugins.item = (i) => plugins[i];
        plugins.namedItem = (name) => plugins.find(p => p.name === name);
        Object.setPrototypeOf(plugins, PluginArray.prototype);
        return plugins;
      },
    });

    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });

    // Simule l'objet window.chrome d'un vrai navigateur
    if (!window.chrome) {
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        },
        runtime: {},
      };
    }

    // Masque la détection via les permissions
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };
    }

    // Résolution d'écran cohérente avec viewport
    Object.defineProperty(screen, 'width', { get: () => 1280 });
    Object.defineProperty(screen, 'height', { get: () => 800 });
    Object.defineProperty(screen, 'availWidth', { get: () => 1280 });
    Object.defineProperty(screen, 'availHeight', { get: () => 760 });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  });

  const page = await context.newPage();

  try {
    console.log(`Navigation vers l'accueil du salon : ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Simule un comportement humain après chargement
    await randomDelay(800, 1500);
    await page.mouse.move(
      Math.floor(Math.random() * 400) + 200,
      Math.floor(Math.random() * 300) + 100
    );
    await randomDelay(400, 800);

    const boutonCookie = page.locator('button:has-text("Accepter & Fermer")');
    if (await boutonCookie.isVisible({ timeout: 4000 }).catch(() => false)) {
      await randomDelay(500, 1000);
      await boutonCookie.click();
      console.log("Cookies acceptés.");
      await randomDelay(600, 1200);
    }

    console.log(`Recherche de la prestation : "${prestation}"`);
    const boutonPrestation = page.locator(`span:has-text("${prestation}")`).first();

    await boutonPrestation.waitFor({ state: 'visible', timeout: 15000 });
    await randomDelay(400, 900);

    // Déplace la souris vers le bouton avant de cliquer (comportement humain)
    const box = await boutonPrestation.boundingBox();
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2 + (Math.random() * 6 - 3),
        box.y + box.height / 2 + (Math.random() * 6 - 3),
        { steps: 10 }
      );
      await randomDelay(100, 300);
    }
    await boutonPrestation.click();
    console.log(`Prestation "${prestation}" sélectionnée avec succès !`);

    console.log("Attente du chargement des horaires...");
    await page.waitForSelector('.page-module_dayWrapper-vmw33', { timeout: 15000 });
    await randomDelay(500, 1000);

    const planning = await page.evaluate(() => {
      const dayBlocks = document.querySelectorAll('.page-module_dayWrapper-vmw33');
      const results = [];

      dayBlocks.forEach(block => {
        const dayText = block.querySelector('.page-module_day-5m7pD')?.innerText.trim() || '';
        const dateText = block.querySelector('.page-module_date-qFRuO')?.innerText.trim() || '';
        const fullDate = `${dayText} ${dateText}`.trim();

        const hourButtons = block.querySelectorAll('.page-module_hourWithIcon-YXOEm');
        const slots = Array.from(hourButtons).map(btn => btn.innerText.trim());

        if (fullDate) {
          results.push({ date: fullDate, slots });
        }
      });

      return results;
    });

    console.log(`=== CRÉNEAUX BRUTS POUR "${prestation.toUpperCase()}" ===`);
    console.log(JSON.stringify(planning, null, 2));

    const scrapedSlots = formatSlots(planning);
    console.log(`\n=== CRÉNEAUX FORMATÉS (${scrapedSlots.length} au total) ===`);
    console.log(JSON.stringify(scrapedSlots, null, 2));

    if (scrapedSlots.length > 0) {
      await sendToApi(url, scrapedSlots);
    } else {
      console.log('\nAucun créneau disponible, rien à envoyer.');
    }

  } catch (error) {
    console.error("Erreur pendant le scraping :", error.message);
    await page.screenshot({ path: 'erreur.png' });
    console.log("Capture d'écran sauvegardée (erreur.png)");
  } finally {
    await browser.close();
  }
}

scrapeSalons();

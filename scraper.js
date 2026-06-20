const { chromium } = require('playwright');

async function scrapeSalons() {

  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log("Navigation vers l'accueil du salon...");
    await page.goto('URL_DU_SALON', {
      waitUntil: 'networkidle'
    });

  
    const boutonCookie = page.locator('button:has-text("Accepter & Fermer")');
    if (await boutonCookie.isVisible()) {
        await boutonCookie.click();
        console.log("Cookies acceptés.");
    }


    console.log("Recherche de la prestation");
    const boutonCoupeHomme = page.locator('#button-choose-0-0.service-module_hideOnMobileOrTablet-Lfa6f');

    await boutonCoupeHomme.waitFor({ state: 'visible', timeout: 5000 });
    await boutonCoupeHomme.click();
    console.log("Prestation 'Coupe Homme' sélectionnée avec succès !");

    console.log("Attente du chargement des horaires...");
    
    await page.waitForSelector('.page-module_dayWrapper-vmw33', { timeout: 7000 });

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
                results.push({
                    date: fullDate,
                    slots: slots // Tableau d'heures, vide si le salon est fermé ou complet
                });
            }
        });

        return results;
    });

    console.log("=== CRÉNEAUX DISPONIBLES STRUCTURÉS POUR UNE COUPE HOMME ===");
    console.log(JSON.stringify(planning, null, 2));

  } catch (error) {
    console.error("Erreur pendant le scraping :", error.message);
    await page.screenshot({ path: 'erreur.png' });
    console.log("Capture d'écran sauvegardée (erreur.png)");
  } finally {
    await browser.close();
  }
}

scrapeSalons();
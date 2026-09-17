// Explicit test-only acceptance, on fictional isolated profiles.
async function reviewTerms(page) {
  await page.locator('#ready-stage:not([hidden])').waitFor();
  if (!await page.locator('#terms-agree').isChecked()) {
    await page.locator('#terms-reader').focus();
    await page.locator('#terms-reader').press('Control+End');
    await page.locator('#terms-agree:enabled').waitFor();
    await page.locator('#terms-agree').check();
  }
}
module.exports = { reviewTerms };

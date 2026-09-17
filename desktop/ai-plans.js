// Display and preference metadata only. This catalogue does not grant AI access.
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.CaseForgePlans = value;
})(typeof window === 'object' ? window : globalThis, function () {
  const free = Object.freeze({ id: 'free', name: 'Free', dailyTokens: 1_500_000, monthlyAud: 0 });
  // A$50 supports a larger reading budget when generated tokens have their own cap.
  // These are separate daily limits, not an unrestricted 3.5M-token balance.
  const everyday = Object.freeze({ id: 'everyday', name: 'Everyday', dailyTokens: 3_500_000,
    dailyInputTokens: 3_000_000, dailyOutputTokens: 500_000, monthlyAud: 50 });
  const plus = Object.freeze({ id: 'plus', name: 'Plus', dailyTokens: 30_000_000, monthlyAud: 90, priceReviewRequired: true });
  const astraUpgrade = Object.freeze({ name: 'Everyday + Astra', planId: everyday.id,
    priceMultiplier: 1.5, monthlyAud: everyday.monthlyAud * 1.5, status: 'planned', dailyTokens: null });
  return Object.freeze({
    status: 'preview', checkedOn: '2026-09-17', currency: 'AUD',
    model: 'gemini-2.5-flash-lite', modelName: 'Gemini 2.5 Flash-Lite',
    advancedModel: 'gpt-6-astra', advancedName: 'GPT-6 Astra',
    astraUpgrade,
    plans: Object.freeze({ free, everyday, plus }),
    // Text-only standard service. Output includes billable reasoning tokens.
    cost: Object.freeze({ inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.40,
      usdPerAudReference: 0.7122, exchangeDate: '2026-09-15',
      usdPerAudBudget: 0.70, maximumDays: 31, taxReserveRate: 0.10, targetCostMultiple: 2 }),
  });
});

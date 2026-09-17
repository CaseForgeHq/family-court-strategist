const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalogue = require('../ai-plans.js');

test('the 30M Plus preview retains its price and explicitly flags the original cost target for review', () => {
  const { cost, plans } = catalogue;
  const worstRate = Math.max(cost.inputUsdPerMillion, cost.outputUsdPerMillion);
  const maximumAiCostAud = plans.plus.dailyTokens / 1e6 * worstRate * cost.maximumDays / cost.usdPerAudBudget;
  const netRevenueAud = plans.plus.monthlyAud / (1 + cost.taxReserveRate);
  assert.ok(netRevenueAud < maximumAiCostAud, 'The requested 30M preview requires pricing review before funded usage launches');
  assert.ok(netRevenueAud < cost.targetCostMultiple * maximumAiCostAud, '30M at A$90 no longer meets the earlier twice-cost target');
  assert.equal(plans.plus.priceReviewRequired, true, 'Flag the pricing review before any paid launch');
  assert.equal(catalogue.status, 'preview');
  assert.equal(plans.free.dailyTokens, 1_500_000);
  assert.equal(plans.plus.dailyTokens, 30_000_000);
  assert.equal(plans.free.monthlyAud, 0);
  assert.equal(catalogue.model, 'gemini-2.5-flash-lite');
  assert.equal(catalogue.advancedModel, 'gpt-6-astra');
  assert.equal(plans.plus.astraTokens, undefined, 'Astra must never inherit the Gemini allowance');
});

test('the A$50 middle tier supports both separate daily limits at twice AI cost', () => {
  const { cost, plans } = catalogue, plan = plans.everyday;
  assert.equal(plan.monthlyAud, 50);
  assert.equal(plan.dailyTokens, plan.dailyInputTokens + plan.dailyOutputTokens);
  assert.ok(plan.dailyTokens > plans.free.dailyTokens && plan.dailyTokens < plans.plus.dailyTokens);
  const dailyCostUsd = (plan.dailyInputTokens * cost.inputUsdPerMillion + plan.dailyOutputTokens * cost.outputUsdPerMillion) / 1e6;
  const maximumAiCostAud = dailyCostUsd * cost.maximumDays / cost.usdPerAudBudget;
  const netRevenueAud = plan.monthlyAud / (1 + cost.taxReserveRate);
  assert.ok(netRevenueAud >= cost.targetCostMultiple * maximumAiCostAud,
    'Both advertised limits must be affordable when fully consumed every day');
  assert.ok(netRevenueAud < cost.targetCostMultiple * plan.dailyTokens / 1e6 * cost.outputUsdPerMillion * cost.maximumDays / cost.usdPerAudBudget,
    'Everyday must retain separate limits: an unrestricted combined balance would break its price');
  assert.equal(plan.astraTokens, undefined);
});

test('Astra is a A$75 Everyday bundle, not a A$75 surcharge or an inherited base allowance', () => {
  const { plans, astraUpgrade } = catalogue;
  assert.equal(astraUpgrade.planId, 'everyday');
  assert.equal(astraUpgrade.monthlyAud, plans.everyday.monthlyAud * astraUpgrade.priceMultiplier);
  assert.equal(astraUpgrade.monthlyAud, 75);
  assert.equal(astraUpgrade.monthlyAud - plans.everyday.monthlyAud, 25);
  assert.equal(astraUpgrade.dailyTokens, null, 'Astra usage must be priced separately before activation');
  assert.equal(astraUpgrade.status, 'planned');
  assert.equal(plans.plus.monthlyAud, 90);
});

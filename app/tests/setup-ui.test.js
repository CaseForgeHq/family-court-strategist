import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../../desktop/setup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../../desktop/setup.js", import.meta.url), "utf8");
const entryScript = readFileSync(new URL("../../desktop/entry-flow.js", import.meta.url), "utf8");
const termsScript = readFileSync(new URL("../../desktop/terms.js", import.meta.url), "utf8");
const termsScreenScript = readFileSync(new URL("../../desktop/terms-screen.js", import.meta.url), "utf8");
const planScript = readFileSync(new URL("../../desktop/ai-plans.js", import.meta.url), "utf8");
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail("Setup did not reach the expected state"); }
function installEntry(dom) {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  dom.window.eval(entryScript);
}
async function setup(t, initialState = {}, actions = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://caseforge.test/setup.html" });
  t.after(() => dom.window.close());
  const document = dom.window.document, calls = [], state = { pinConfigured: false, folderSelected: false, folderName: "My Case", folderPath: "C:/Cases/My Case", ...initialState };
  let savedPreferences = actions.initialPreferences;
  let termsAccepted = actions.termsAccepted !== false;
  const receipt = () => ({ version: "beta-1.0", documentHash: "a".repeat(64), accepted: termsAccepted });
  const defaults = () => ({ folderKey: state.folderPath, caseName: state.folderName, preferredProvider: "ollama", configured: false });
  const selectFolder = async (kind) => {
    calls.push({ kind });
    const result = actions[kind] ? await actions[kind]() : true;
    if (result === true) Object.assign(state, { folderSelected: true, folderName: "My Case", folderPath: "C:/Cases/My Case" });
    return result;
  };
  dom.window.strategistDesktop = {
    getSetupState: async () => ({ ...state }),
    getTermsStatus: async () => receipt(),
    acceptTerms: async (value) => {
      calls.push({ kind: "accept-terms", input: JSON.parse(JSON.stringify(value)) });
      if (actions.acceptTerms) { const result = await actions.acceptTerms(value); if (result?.error) return result; }
      termsAccepted = true; return receipt();
    },
    ...(actions.stage ? { getEntryStage: async () => actions.stage } : {}),
    configurePin: async (input) => {
      calls.push({ kind: "pin", input: JSON.parse(JSON.stringify(input)) });
      const result = actions.pin ? await actions.pin(input) : { ok: true };
      if (result?.ok && actions.confirmPinConfigured !== false) state.pinConfigured = true;
      return result;
    },
    chooseCaseFolder: () => selectFolder("folder"),
    createCase: () => selectFolder("create"),
    getWorkspacePreferences: async () => {
      calls.push({ kind: "load-preferences" });
      return actions.loadPreferences ? await actions.loadPreferences() : savedPreferences || defaults();
    },
    saveWorkspacePreferences: async (input) => {
      const value = JSON.parse(JSON.stringify(input));
      calls.push({ kind: "preferences", input: value });
      const result = actions.savePreferences ? await actions.savePreferences(value) : { ...value, configured: true };
      if (result?.configured) savedPreferences = result;
      return result;
    },
    openWorkspace: async () => { calls.push({ kind: "open" }); return actions.open ? await actions.open() : { ok: true }; },
  };
  installEntry(dom); dom.window.eval(planScript); dom.window.eval(termsScript); dom.window.eval(termsScreenScript); dom.window.eval(script);
  await until(() => !document.querySelector("#setup-configure-pin").disabled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stage = () => dom.window.CaseForgeEntry.getStage();
  const inputPin = (id, value) => {
    const field = document.getElementById(id); field.value = value;
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const submitPin = (currentPin = "") => {
    inputPin("setup-current-pin", currentPin);
    inputPin("setup-new-pin", "693827");
    inputPin("setup-confirm-pin", "693827");
    document.querySelector("#setup-pin-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  };
  const preferences = async () => {
    document.getElementById("configure-continue").click();
    await until(() => stage() === "preferences" && !document.getElementById("preferences-case-name").disabled);
  };
  const submitPreferences = (caseName, aiPlan) => {
    if (caseName !== undefined) document.getElementById("preferences-case-name").value = caseName;
    if (aiPlan !== undefined) document.querySelector(`input[name="ai-plan"][value="${aiPlan}"]`).checked = true;
    document.getElementById("preferences-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  };
  const ready = async () => { if (stage() === "configure") await preferences(); submitPreferences(); await until(() => stage() === "ready"); };
  return { dom, document, state, calls, inputPin, submitPin, preferences, submitPreferences, ready, stage, opens: () => calls.filter((item) => item.kind === "open").length };
}

test("setup opens directly on PIN and folder configuration with top branding and progress above the cards", async (t) => {
  const { document, stage, opens } = await setup(t);
  assert.equal(stage(), "configure"); assert.equal(document.body.dataset.entryStage, "configure");
  assert.equal(document.getElementById("configure-stage").hidden, false);
  assert.equal(document.getElementById("ready-stage").hidden, true);
  assert.equal(document.getElementById("preferences-stage").hidden, true);
  assert.equal(document.querySelector("#welcome-stage, #welcome-continue, #configure-back"), null);
  assert.equal(document.querySelectorAll("body > header .entry-brand img").length, 1);
  assert.equal(document.querySelector(".entry-footer .entry-brand, .entry-footer .setup-progress"), null);
  assert.deepEqual(Array.from(document.querySelectorAll("main > .setup-progress [data-step]"), (item) => item.dataset.step), ["configure", "preferences", "ready"]);
  assert.equal(document.querySelector("main > .setup-progress").nextElementSibling, document.getElementById("configure-stage"));
  assert.equal(document.getElementById("scene-controls").hidden, false);
  assert.equal(document.getElementById("configure-continue").disabled, true);
  document.getElementById("ready-open").click(); assert.equal(opens(), 0);
  assert.equal(document.querySelectorAll(".setup-card").length, 2);
  assert.equal(document.querySelector('[aria-current="step"]').dataset.step, "configure");
  assert.equal(document.getElementById("setup-progress-fill").style.width, "0%");
  assert.equal(document.getElementById("setup-folder-status").hidden, true);
});

test("folder-first setup waits for a successful PIN, saved preferences and explicit workspace entry", async (t) => {
  let rejectPin = true;
  const { document, calls, submitPin, ready, stage, opens } = await setup(t, {}, {
    pin: async () => rejectPin ? { error: "Those PINs do not match." } : { ok: true },
  });
  document.getElementById("setup-choose-folder").click();
  await until(() => document.getElementById("setup-folder-path").textContent === "C:/Cases/My Case");
  assert.equal(document.getElementById("configure-continue").disabled, true); assert.equal(opens(), 0);
  document.getElementById("setup-configure-pin").click();
  assert.equal(document.getElementById("pin-dialog").open, true);
  assert.equal(document.getElementById("setup-current-wrap").hidden, true);
  submitPin();
  await until(() => document.getElementById("setup-pin-message").textContent.includes("do not match"));
  assert.equal(document.getElementById("setup-new-pin").value, "");
  assert.equal(document.getElementById("setup-confirm-pin").value, "");
  assert.equal(document.getElementById("pin-dialog").open, true); assert.equal(opens(), 0);
  rejectPin = false; submitPin();
  await until(() => document.getElementById("pin-dialog").dataset.status === "success");
  assert.equal(document.getElementById("setup-pin-badge").textContent, "PIN active");
  assert.equal(document.getElementById("setup-save-pin").disabled, true, "Success feedback must retain busy protection until the dialog closes");
  assert.equal(document.getElementById("configure-continue").disabled, true);
  await until(() => !document.getElementById("configure-continue").disabled);
  assert.equal(document.getElementById("pin-dialog").open, false);
  assert.equal(stage(), "configure"); assert.equal(opens(), 0);
  await ready(); assert.equal(opens(), 0);
  assert.equal(document.querySelector('[aria-current="step"]').dataset.step, "ready");
  assert.equal(document.getElementById("setup-progress-fill").style.width, "100%");
  assert.equal(document.getElementById("scene-controls").hidden, false);
  document.getElementById("ready-open").click(); await until(() => opens() === 1);
  assert.deepEqual(calls.filter((item) => item.kind === "pin").map((item) => item.input), [
    { currentPin: "", newPin: "693827", confirmation: "693827" }, { currentPin: "", newPin: "693827", confirmation: "693827" },
  ]);
});

for (const [kind, button] of [["folder", "setup-choose-folder"], ["create", "setup-create-folder"]]) {
  test("PIN-first " + kind + " selection enables Continue without opening automatically", async (t) => {
    const { document, calls, submitPin, ready, opens } = await setup(t);
    document.getElementById("setup-configure-pin").click(); submitPin();
    await until(() => !document.getElementById("pin-dialog").open && !document.getElementById(button).disabled);
    assert.equal(document.getElementById("configure-continue").disabled, true); assert.equal(opens(), 0);
    document.getElementById(button).click(); await until(() => !document.getElementById("configure-continue").disabled);
    assert.equal(opens(), 0); await ready(); assert.equal(opens(), 0);
    document.getElementById("ready-open").click(); await until(() => opens() === 1);
    assert.deepEqual(calls.filter((item) => item.kind !== "load-preferences").map((item) => item.kind), ["pin", kind, "preferences", "open"]);
  });

  test("cancelled " + kind + " selection preserves the authenticated folder and configuration stage", async (t) => {
    const { document, stage, opens } = await setup(t, {
      pinConfigured: true, folderSelected: true, folderName: "Existing Case", folderPath: "C:/Cases/Existing Case",
    }, { stage: "configure", [kind]: async () => false });
    assert.equal(stage(), "configure"); assert.equal(opens(), 0);
    document.getElementById(button).click(); await until(() => !document.getElementById(button).disabled);
    assert.equal(document.getElementById("setup-folder-path").textContent, "C:/Cases/Existing Case");
    assert.equal(stage(), "configure"); assert.equal(opens(), 0);
  });
}

test("PIN dialog cancellation clears typed values; pending and failed saves cannot advance", async (t) => {
  let finishPin;
  const { dom, document, submitPin, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    pin: async () => new Promise((resolve) => { finishPin = resolve; }),
  });
  document.getElementById("setup-configure-pin").click();
  assert.equal(document.getElementById("setup-current-pin").required, true);
  assert.equal(document.getElementById("configure-continue").disabled, true);
  submitPin("123456");
  document.getElementById("pin-dialog").dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
  assert.equal(document.getElementById("pin-dialog").open, true, "Busy PIN save must not be abandoned");
  document.getElementById("configure-continue").click(); assert.equal(stage(), "configure");
  finishPin({ error: "Your current PIN is incorrect." });
  await until(() => document.getElementById("setup-pin-message").textContent.includes("incorrect"));
  for (const id of ["setup-current-pin", "setup-new-pin", "setup-confirm-pin"]) assert.equal(document.getElementById(id).value, "");
  document.getElementById("setup-new-pin").value = "693827";
  document.getElementById("pin-dialog").dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
  assert.equal(document.getElementById("pin-dialog").open, false);
  assert.equal(document.getElementById("setup-new-pin").value, "");
  assert.equal(document.getElementById("configure-continue").disabled, false);
  assert.equal(stage(), "configure"); assert.equal(opens(), 0);
});

test("PIN dialog validates format and matching confirmation before calling the native save", async (t) => {
  const { dom, document, inputPin, calls, state } = await setup(t);
  document.getElementById("setup-configure-pin").click();
  const save = document.getElementById("setup-save-pin"), form = document.getElementById("setup-pin-form");
  const submit = () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(save.disabled, true);
  for (const [pin, confirmation] of [["", ""], ["123", "123"], ["73948x", "73948x"], ["7394821111111", "7394821111111"], ["739482", "739483"]]) {
    inputPin("setup-new-pin", pin); inputPin("setup-confirm-pin", confirmation);
    assert.equal(save.disabled, true, "Invalid or mismatched values must keep Save disabled");
    submit();
  }
  assert.equal(calls.filter((item) => item.kind === "pin").length, 0);
  inputPin("setup-new-pin", "739482"); inputPin("setup-confirm-pin", "739482");
  assert.equal(save.disabled, false);
  assert.equal(document.getElementById("setup-new-pin").dataset.status, "ready");
  assert.equal(document.getElementById("setup-confirm-pin").dataset.status, "ready");
  assert.equal(document.getElementById("setup-confirm-pin").getAttribute("aria-invalid"), "false");
  assert.match(document.getElementById("setup-confirm-pin-feedback").textContent, /match/i);
  assert.doesNotMatch(document.getElementById("setup-new-pin-feedback").textContent + document.getElementById("setup-confirm-pin-feedback").textContent, /PIN (?:saved|confirmed|active)/i);
  assert.equal(state.pinConfigured, false, "Matching typed values are not a saved PIN");
  assert.equal(calls.filter((item) => item.kind === "pin").length, 0);
});

test("setup card badges reflect native PIN and folder state independently", async (t) => {
  for (const [pinConfigured, folderSelected] of [[false, false], [true, false], [false, true], [true, true]]) {
    const { document } = await setup(t, { pinConfigured, folderSelected });
    assert.equal(document.getElementById("setup-pin-badge").textContent, pinConfigured ? "PIN active" : "Not set");
    assert.equal(document.getElementById("setup-folder-badge").textContent, folderSelected ? "Selected" : "Not selected");
    assert.equal(document.getElementById("setup-pin-card").dataset.status, pinConfigured ? "success" : "idle");
    assert.equal(document.getElementById("setup-folder-card").dataset.status, folderSelected ? "success" : "idle");
  }
});

test("a save acknowledgement without native configured status cannot report PIN success", async (t) => {
  const { document, submitPin, opens } = await setup(t, { folderSelected: true }, { confirmPinConfigured: false });
  document.getElementById("setup-configure-pin").click(); submitPin();
  await until(() => document.getElementById("setup-pin-message").textContent.includes("could not be confirmed"));
  assert.equal(document.getElementById("pin-dialog").dataset.status, "error");
  assert.equal(document.getElementById("pin-dialog").open, true);
  assert.equal(document.getElementById("setup-pin-badge").textContent, "Not set");
  assert.equal(document.getElementById("configure-continue").disabled, true);
  assert.equal(opens(), 0);
});

test("changing a PIN also requires a correctly formatted current PIN before native verification", async (t) => {
  const { dom, document, inputPin, calls } = await setup(t, { pinConfigured: true });
  document.getElementById("setup-configure-pin").click();
  inputPin("setup-new-pin", "693827"); inputPin("setup-confirm-pin", "693827");
  const save = document.getElementById("setup-save-pin"), form = document.getElementById("setup-pin-form");
  for (const currentPin of ["", "123", "73948x", "7394821111111"]) {
    inputPin("setup-current-pin", currentPin);
    assert.equal(save.disabled, true);
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  }
  assert.equal(calls.filter((item) => item.kind === "pin").length, 0);
  inputPin("setup-current-pin", "739482");
  assert.equal(save.disabled, false);
  assert.equal(calls.filter((item) => item.kind === "pin").length, 0, "Current PIN formatting must not imply authentication");
});

test("a pending or rejected first PIN cannot claim success or permit duplicate saves", async (t) => {
  let finishPin;
  const { dom, document, inputPin, calls, state, opens } = await setup(t, { folderSelected: true }, {
    pin: async () => new Promise((resolve) => { finishPin = resolve; }),
  });
  document.getElementById("setup-configure-pin").click();
  inputPin("setup-new-pin", "111111"); inputPin("setup-confirm-pin", "111111");
  assert.equal(document.getElementById("setup-save-pin").disabled, false, "Predictability remains a native security decision");
  const form = document.getElementById("setup-pin-form");
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(calls.filter((item) => item.kind === "pin").length, 1);
  for (const id of ["setup-current-pin", "setup-new-pin", "setup-confirm-pin", "setup-save-pin", "setup-cancel-pin", "setup-configure-pin", "setup-choose-folder", "setup-create-folder", "configure-continue"]) {
    assert.equal(document.getElementById(id).disabled, true, id + " must be disabled while saving");
  }
  assert.equal(state.pinConfigured, false); assert.equal(opens(), 0);
  finishPin({ error: "Choose a less predictable PIN." });
  await until(() => document.getElementById("setup-pin-message").textContent.includes("less predictable"));
  assert.equal(state.pinConfigured, false);
  assert.equal(document.getElementById("pin-dialog").open, true);
  assert.equal(document.getElementById("setup-save-pin").disabled, true);
  assert.equal(document.getElementById("configure-continue").disabled, true);
  assert.doesNotMatch(document.getElementById("setup-pin-badge").textContent, /^PIN active$/i);
  for (const id of ["setup-new-pin", "setup-confirm-pin"]) {
    assert.equal(document.getElementById(id).value, ""); assert.equal(document.getElementById(id).disabled, false);
  }
  assert.equal(opens(), 0);
});

test("setup without a desktop bridge cannot configure, continue or enter a case", async () => {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  try {
    installEntry(dom); dom.window.eval(script);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const document = dom.window.document;
    assert.match(document.getElementById("setup-message").textContent, /desktop app/);
    assert.notEqual(document.getElementById("setup-pin-badge").textContent, "PIN active");
    assert.notEqual(document.getElementById("setup-folder-badge").textContent, "Selected");
    for (const id of ["setup-configure-pin", "setup-choose-folder", "setup-create-folder", "configure-continue", "preferences-continue", "ready-open"]) assert.equal(document.getElementById(id).disabled, true);
  } finally { dom.window.close(); }
});

test("cancelled and failed folder selection keep incomplete setup gated", async (t) => {
  let attempts = 0;
  const { document, stage, opens } = await setup(t, { pinConfigured: true }, {
    folder: async () => ++attempts === 1 ? false : { error: "That folder is unavailable." },
  });
  document.getElementById("setup-choose-folder").click();
  await until(() => !document.getElementById("setup-choose-folder").disabled);
  assert.equal(document.getElementById("setup-folder-path").textContent, ""); assert.equal(opens(), 0);
  document.getElementById("setup-choose-folder").click();
  await until(() => document.getElementById("setup-message").textContent.includes("unavailable"));
  assert.equal(document.getElementById("configure-continue").disabled, true);
  assert.equal(stage(), "configure"); assert.equal(opens(), 0);
});

test("Ready opens once while busy, shows native errors and permits back navigation or retry", async (t) => {
  let finishOpen;
  const { document, ready, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    open: async () => new Promise((resolve) => { finishOpen = resolve; }),
  });
  document.getElementById("ready-open").click(); assert.equal(opens(), 0, "Ready control must not open from configuration");
  await ready(); document.getElementById("ready-open").click(); document.getElementById("ready-open").click();
  await until(() => opens() === 1); assert.equal(document.getElementById("ready-back").disabled, true);
  finishOpen({ error: "Your workspace could not be opened." });
  await until(() => !document.getElementById("ready-open").disabled);
  assert.match(document.getElementById("ready-message").textContent, /could not be opened/);
  document.getElementById("ready-back").click(); assert.equal(stage(), "preferences");
  assert.equal(document.getElementById("ready-message").textContent, "");
  await ready(); document.getElementById("ready-open").click(); await until(() => opens() === 2);
  finishOpen({ ok: true });
});

test("native entry hints always show Preferences before Terms, including when choices were saved", async (t) => {
  for (const [hint, complete, configured, expected] of [["preferences", true, true, "preferences"], ["ready", true, true, "preferences"], ["ready", true, false, "preferences"], ["ready", false, false, "configure"], ["configure", true, true, "configure"], ["unexpected", true, true, "configure"]]) {
    const { stage, opens } = await setup(t, { pinConfigured: complete, folderSelected: complete }, {
      stage: hint,
      initialPreferences: { folderKey: "C:/Cases/My Case", caseName: "My Case", preferredProvider: "ollama", configured },
    });
    assert.equal(stage(), expected); assert.equal(opens(), 0);
  }
});

test("Continue rechecks the selected folder before loading Preferences", async (t) => {
  const { document, state, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true });
  state.folderSelected = false;
  document.getElementById("configure-continue").click(); await until(() => document.getElementById("configure-continue").disabled);
  assert.equal(stage(), "configure"); assert.equal(opens(), 0);
});

test("Preferences defaults to Free, saves a plan choice once without changing the connection, then enables Ready", async (t) => {
  let finishSave;
  const { document, calls, preferences, submitPreferences, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    savePreferences: async () => new Promise((resolve) => { finishSave = resolve; }),
  });
  assert.equal(document.getElementById("ready-open").disabled, true, "Complete PIN/folder setup is insufficient before preferences are saved");
  await preferences();
  assert.equal(document.getElementById("preferences-case-name").value, "My Case");
  assert.equal(document.getElementById("preferences-case-name").maxLength, 80);
  assert.equal(document.getElementById("preferences-case-name").required, true);
  assert.equal(document.querySelector('input[name="ai-plan"]:checked').value, "free");
  assert.equal(document.querySelector('[aria-current="step"]').dataset.step, "preferences");
  assert.equal(document.getElementById("setup-progress-fill").style.width, "50%");
  document.getElementById("ready-open").click(); assert.equal(opens(), 0);
  submitPreferences("Family case 2026", "plus"); submitPreferences("Another name", "free");
  const saves = calls.filter((item) => item.kind === "preferences");
  assert.deepEqual(saves, [{ kind: "preferences", input: { folderKey: "C:/Cases/My Case", caseName: "Family case 2026", preferredProvider: "ollama", aiPlan: "plus", advancedIntelligence: false } }]);
  assert.equal(stage(), "preferences"); assert.equal(opens(), 0);
  assert.equal(document.getElementById("preferences-back").disabled, true);
  assert.equal(document.getElementById("preferences-continue").disabled, true);
  assert.equal(document.getElementById("ready-open").disabled, true);
  finishSave({ ...saves[0].input, configured: true });
  await until(() => stage() === "ready");
  assert.equal(document.getElementById("ready-open").disabled, false); assert.equal(opens(), 0);
  document.getElementById("ready-open").click(); await until(() => opens() === 1);
});

test("a preferences load error is visible, blocks entry and can be retried from configuration", async (t) => {
  let unavailable = true;
  const { document, calls, preferences, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    loadPreferences: async () => unavailable ? { error: "Preferences could not be read." } : { folderKey: "C:/Cases/My Case", caseName: "My Case", preferredProvider: "ollama", configured: false },
  });
  document.getElementById("configure-continue").click();
  await until(() => document.body.textContent.includes("Preferences could not be read."));
  assert.equal(document.getElementById("ready-open").disabled, true);
  document.getElementById("ready-open").click(); assert.equal(opens(), 0);
  assert.equal(calls.filter((item) => item.kind === "preferences").length, 0);
  unavailable = false;
  if (stage() === "preferences") document.getElementById("preferences-back").click();
  await preferences();
  assert.equal(document.getElementById("preferences-case-name").value, "My Case");
  assert.equal(document.getElementById("preferences-message").textContent, "");
});

for (const throws of [false, true]) {
  test("a " + (throws ? "thrown" : "returned") + " preferences save error retains the draft and permits retry", async (t) => {
    let unavailable = true;
    const { document, calls, preferences, submitPreferences, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, {
      savePreferences: async (input) => {
        if (unavailable) {
          if (throws) throw new Error("Preferences could not be saved.");
          return { error: "Preferences could not be saved." };
        }
        return { ...input, configured: true };
      },
    });
    await preferences(); submitPreferences("Updated case", "plus");
    await until(() => document.getElementById("preferences-message").textContent.includes("could not be saved"));
    assert.equal(stage(), "preferences"); assert.equal(opens(), 0);
    assert.equal(document.getElementById("preferences-case-name").value, "Updated case");
    assert.equal(document.querySelector('input[name="ai-plan"]:checked').value, "plus");
    assert.equal(document.getElementById("preferences-continue").disabled, false);
    assert.equal(document.getElementById("ready-open").disabled, true);
    unavailable = false; submitPreferences(); await until(() => stage() === "ready");
    assert.equal(calls.filter((item) => item.kind === "preferences").length, 2);
    assert.equal(opens(), 0);
  });
}

test("Ready and Preferences back controls preserve saved choices without opening or saving again", async (t) => {
  const { document, calls, preferences, submitPreferences, stage, opens } = await setup(t, { pinConfigured: true, folderSelected: true });
  await preferences(); submitPreferences("Saved case", "plus"); await until(() => stage() === "ready");
  document.getElementById("ready-back").click();
  assert.equal(stage(), "preferences");
  assert.equal(document.getElementById("preferences-case-name").value, "Saved case");
  assert.equal(document.querySelector('input[name="ai-plan"]:checked').value, "plus");
  document.getElementById("preferences-back").click(); assert.equal(stage(), "configure");
  assert.equal(document.getElementById("setup-folder-path").textContent, "C:/Cases/My Case");
  await preferences();
  assert.equal(document.getElementById("preferences-case-name").value, "Saved case");
  assert.equal(document.querySelector('input[name="ai-plan"]:checked').value, "plus");
  assert.equal(calls.filter((item) => item.kind === "preferences").length, 1); assert.equal(opens(), 0);
});

test('Astra is opt-in, previews remain explicit, and an existing connection preference survives selection', async (t) => {
  const { dom, document, calls, preferences, submitPreferences, stage } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    initialPreferences: { folderKey: 'C:/Cases/My Case', caseName: 'Existing case', preferredProvider: 'anthropic', configured: true },
  });
  await preferences();
  const astra = document.getElementById('preferences-astra');
  assert.equal(astra.checked, false);
  assert.match(document.getElementById('plan-preview-note').textContent, /billing are not active/);
  assert.doesNotMatch(document.getElementById('preferences-stage').textContent, /Gemini|45%|trained model/i);
  assert.match(document.querySelector('.astra-copy').textContent, /Planned upgrade/);
  assert.match(document.querySelector('.astra-copy').textContent, /Separate Astra usage allowance to be confirmed/);
  assert.equal(document.getElementById('plus-plan-price').textContent, 'A$90');
  document.getElementById('preferences-plan-plus').click();
  astra.click();
  assert.equal(document.getElementById('astra-preview-status').textContent, 'Selected');
  assert.equal(document.getElementById('astra-plan-price').textContent, 'A$75');
  assert.equal(document.getElementById('astra-price-detail').textContent, 'A$25 extra · incl. GST');
  document.getElementById('preferences-back').click(); await preferences();
  assert.equal(astra.checked, true);
  assert.equal(document.getElementById('preferences-plan-everyday').checked, true);
  submitPreferences(); await until(() => stage() === 'ready');
  const saved = calls.filter(call => call.kind === 'preferences');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].input.preferredProvider, 'anthropic');
  assert.equal(saved[0].input.aiPlan, 'everyday'); assert.equal(saved[0].input.advancedIntelligence, true);
  assert.equal(calls.filter(call => call.kind === 'open').length, 0);
});

test('choosing another plan clears the Astra bundle before saving and cannot show a misleading A$75 Plus price', async (t) => {
  const { document, calls, preferences, submitPreferences, stage } = await setup(t, { pinConfigured: true, folderSelected: true });
  await preferences();
  document.getElementById('preferences-astra').click();
  assert.equal(document.getElementById('preferences-plan-everyday').checked, true);
  document.getElementById('preferences-plan-plus').click();
  assert.equal(document.getElementById('preferences-astra').checked, false);
  submitPreferences(); await until(() => stage() === 'ready');
  const saved = calls.find(call => call.kind === 'preferences').input;
  assert.equal(saved.aiPlan, 'plus'); assert.equal(saved.advancedIntelligence, false);
});

test('the middle tier loads from saved preferences and stays selected through Back and native confirmation', async (t) => {
  const { document, calls, preferences, submitPreferences, stage } = await setup(t, { pinConfigured: true, folderSelected: true }, {
    initialPreferences: { folderKey: 'C:/Cases/My Case', caseName: 'Saved middle tier', preferredProvider: 'anthropic', aiPlan: 'everyday', advancedIntelligence: false, configured: true },
  });
  await preferences();
  assert.equal(document.getElementById('preferences-plan-everyday').checked, true);
  assert.equal(document.getElementById('everyday-plan-price').textContent, 'A$50');
  assert.match(document.querySelector('[data-plan="everyday"] .plan-detail').textContent, /3M reading \+ 500k generated\.Separate daily limits\./);
  document.getElementById('preferences-back').click(); await preferences();
  assert.equal(document.getElementById('preferences-plan-everyday').checked, true);
  submitPreferences(); await until(() => stage() === 'ready');
  const saved = calls.filter(call => call.kind === 'preferences');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].input.aiPlan, 'everyday');
  assert.equal(saved[0].input.preferredProvider, 'anthropic');
  assert.equal(saved[0].input.advancedIntelligence, false);
  assert.equal(calls.filter(call => call.kind === 'open').length, 0);
});


test("terms require reaching the end and explicit acceptance before workspace entry", async t => {
  const { dom, document, ready, opens, calls } = await setup(t, { pinConfigured: true, folderSelected: true }, { termsAccepted: false });
  await ready();
  const reader = document.getElementById('terms-reader'), checkbox = document.getElementById('terms-agree'), open = document.getElementById('ready-open');
  const agreement = document.querySelector('.terms-agreement');
  Object.defineProperties(reader, { clientHeight: { value: 300 }, scrollHeight: { value: 1500 } });
  assert.equal(checkbox.disabled, true); assert.equal(open.disabled, true);
  assert.equal(agreement.hidden, true); assert.equal(open.hidden, true);
  checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change'));
  open.click(); assert.equal(opens(), 0, 'checking without scrolling must not open');
  checkbox.checked = false;
  reader.scrollTop = 600; reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(checkbox.disabled, true); assert.equal(document.getElementById('terms-progress').value, 50);
  assert.equal(agreement.hidden, true); assert.equal(open.hidden, true);
  reader.scrollTop = 1200; reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(checkbox.disabled, false); assert.equal(open.disabled, true);
  assert.equal(agreement.hidden, false); assert.equal(open.hidden, false);
  checkbox.click(); assert.equal(open.disabled, false);
  checkbox.click(); assert.equal(open.disabled, true);
  checkbox.click(); open.click(); open.click(); await until(() => opens() === 1);
  assert.equal(calls.filter(c => c.kind === 'accept-terms').length, 1);
  assert.deepEqual(calls.filter(c => ['accept-terms', 'open'].includes(c.kind)).map(c => c.kind), ['accept-terms', 'open']);
});

test("layout changes, hidden stages and zero-height content cannot reveal agreement controls", async t => {
  const { dom, document, ready } = await setup(t, { pinConfigured: true, folderSelected: true }, { termsAccepted: false });
  await ready();
  const reader = document.getElementById('terms-reader'), checkbox = document.getElementById('terms-agree'), open = document.getElementById('ready-open');
  let height = 300, content = 300;
  Object.defineProperties(reader, { clientHeight: { get: () => height }, scrollHeight: { get: () => content } });
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(open.hidden, true); assert.equal(checkbox.disabled, true);
  assert.equal(document.getElementById('terms-progress').value, 0);
  content = 1500; reader.scrollTop = 1200;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(open.hidden, true, 'A layout measurement at the bottom is not a scroll');
  dom.window.CaseForgeEntry.show('preferences', false);
  reader.dispatchEvent(new dom.window.Event('scroll'));
  dom.window.CaseForgeEntry.show('ready', false);
  assert.equal(open.hidden, true, 'A hidden document cannot be reviewed');
  height = 0; reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(open.hidden, true);
  height = 300; reader.scrollTop = 0; reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(open.hidden, true);
  assert.match(document.getElementById('terms-scroll-status').textContent, /Scroll to the end/);
  reader.scrollTop = 1200; reader.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(open.hidden, false); assert.equal(checkbox.disabled, false);
});

test("failed terms save keeps the workspace closed and permits a deliberate retry", async t => {
  let fail = true;
  const { dom, document, ready, opens } = await setup(t, { pinConfigured: true, folderSelected: true }, { termsAccepted: false, acceptTerms: async () => fail ? { error: 'Could not save acceptance.' } : undefined });
  await ready();
  const reader = document.getElementById('terms-reader');
  Object.defineProperties(reader, { clientHeight: { value: 300 }, scrollHeight: { value: 1500 } });
  reader.scrollTop = 1200; reader.dispatchEvent(new dom.window.Event('scroll'));
  document.getElementById('terms-agree').click(); document.getElementById('ready-open').click();
  await until(() => document.getElementById('ready-message').textContent.includes('Could not save'));
  assert.equal(opens(), 0); assert.equal(document.getElementById('ready-open').disabled, false);
  fail = false; document.getElementById('ready-open').click(); await until(() => opens() === 1);
});

test("an accepted version can be reviewed without forcing another agreement", async t => {
  const { document, ready, calls, opens } = await setup(t, { pinConfigured: true, folderSelected: true });
  await ready();
  assert.equal(document.getElementById('terms-agree').checked, true);
  assert.equal(document.getElementById('terms-agree').disabled, true);
  assert.match(document.getElementById('ready-open').textContent, /Enter Case Forge/);
  assert.equal(document.querySelectorAll('.terms-section').length, 10);
  document.getElementById('ready-open').click(); await until(() => opens() === 1);
  assert.equal(calls.filter(c => c.kind === 'accept-terms').length, 0);
});

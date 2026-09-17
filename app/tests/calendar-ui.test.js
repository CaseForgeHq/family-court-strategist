import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCalendar } from "../public/calendar.js";

async function until(check) { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail("Calendar UI did not reach its expected state"); }
function setup(t) {
  const dom = new JSDOM('<main id="host"></main>', { url: "http://127.0.0.1" }), previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document; dom.window.confirm = () => true;
  t.after(() => { dom.window.close(); Object.assign(globalThis, previous); }); return { document: dom.window.document, host: dom.window.document.querySelector("#host") };
}
function input(document, selector, value) { const field = document.querySelector(selector); field.value = value; field.dispatchEvent(new window.Event("input", { bubbles: true })); }
const event = { id: "example-manual", title: "Fictional meeting", date: "2026-09-22", details: "Bring notes", revision: 1, kind: "manual", editable: true, syncable: true, status: "active", dateState: "personal", source: null };

test("calendar navigates dates, preserves a draft between views, saves and reopens manual entries", async t => {
  const { document, host } = setup(t); let events = [], posts = [], calendar;
  const api = async (path, options) => {
    if (!options) return { events, access: { canWrite: true } };
    posts.push(options.body); const saved = { ...options.body, revision: options.body.expectedRevision + 1, kind: "manual", editable: true, syncable: true, dateState: "personal" }; events = [saved]; return saved;
  };
  calendar = createCalendar({ api, getSession: () => ({ caseKey: "one", access: { canWrite: true } }) }); t.after(() => calendar.unmount());
  await calendar.mount(host); assert.equal(document.querySelectorAll(".calendar-day").length, 42);
  const firstTitle = document.querySelector("#calendar-month-title").textContent; document.querySelector("#calendar-next").click(); assert.notEqual(document.querySelector("#calendar-month-title").textContent, firstTitle); document.querySelector("#calendar-prev").click(); assert.equal(document.querySelector("#calendar-month-title").textContent, firstTitle);
  document.querySelector("#calendar-new").click(); input(document, "#calendar-event-title", "New fictional appointment"); input(document, "#calendar-event-date", "2026-09-22"); input(document, "#calendar-event-details", "Private calendar note");
  calendar.unmount(); await calendar.mount(host); assert.equal(document.querySelector("#calendar-event-title").value, "New fictional appointment");
  document.querySelector("#calendar-event-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => document.querySelector("#calendar-editor").hidden);
  assert.equal(posts.length, 1); assert.equal(document.querySelector(".calendar-event h3").textContent, "New fictional appointment");
  document.querySelector("[data-edit-event]").click(); input(document, "#calendar-event-title", "Updated appointment"); document.querySelector("#calendar-event-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await until(() => posts.length === 2 && document.querySelector("#calendar-editor").hidden);
  assert.equal(posts[1].expectedRevision, 1); assert.equal(posts[1].id, posts[0].id);
  document.querySelector("[data-edit-event]").click(); document.querySelector("#calendar-archive").click(); await until(() => posts.length === 3 && document.querySelector("#calendar-editor").hidden); assert.equal(posts[2].status, "archived");
  assert.equal(document.querySelectorAll(".calendar-event").length, 0); document.querySelector("#calendar-inactive").checked = true; document.querySelector("#calendar-inactive").dispatchEvent(new window.Event("change")); assert.equal(document.querySelectorAll(".calendar-event").length, 1);
});

test("Google sync is explicit, only sends selected eligible events, and source links route to their record", async t => {
  const { document, host } = setup(t), synced = [], opened = [];
  const task = { ...event, id: "task:one", title: "Proposed deadline", kind: "task", dateState: "proposed", syncable: false, editable: false, source: { kind: "task", id: "one" } };
  const calendar = createCalendar({ api: async () => ({ events: [event, task], access: { canWrite: true } }), getSession: () => ({ caseKey: "one", access: { canWrite: true } }), openRecord: source => opened.push(source), google: { status: async () => ({ available: true, configured: true, connected: true }), sync: async value => { synced.push(value); return {}; } } }); t.after(() => calendar.unmount());
  await calendar.mount(host); await calendar.open(event.id); assert.equal(synced.length, 0); assert.equal(document.querySelector('#calendar-sync').disabled, true);
  assert.equal(document.querySelector('[data-select-event="task:one"]').disabled, true); document.querySelector('[data-source-event="task:one"]').click(); assert.deepEqual(opened, [{ kind: "task", id: "one" }]);
  const check = document.querySelector('[data-select-event="example-manual"]'); check.checked = true; check.dispatchEvent(new window.Event("change")); assert.equal(synced.length, 0); assert.equal(document.querySelector('#calendar-sync').disabled, false);
  document.querySelector('#calendar-sync').click(); await until(() => synced.length === 1 && document.querySelector('#calendar-sync').disabled);
  assert.deepEqual(synced[0], { events: [{ id: event.id, title: event.title, date: event.date, details: event.details }] });
});

test("read-only and missing Google configuration stay explicit without renderer secrets", async t => {
  const { document, host } = setup(t); let configured = false, calls = 0;
  const calendar = createCalendar({ api: async () => ({ events: [event], access: { canWrite: false } }), getSession: () => ({ caseKey: "readonly", access: { canWrite: false } }), google: { status: async () => ({ available: true, configured, connected: false }), configure: async value => { assert.equal(value, undefined); calls++; configured = true; return {}; } } }); t.after(() => calendar.unmount());
  await calendar.mount(host); await calendar.open(event.id); assert.equal(document.querySelector('#calendar-new').disabled, true); assert.equal(document.querySelector('[data-edit-event]').disabled, true);
  document.querySelector('#calendar-google-toggle').click(); assert.equal(document.querySelector('#calendar-google').hidden, false); assert.equal(document.querySelector('#calendar-google-connect').disabled, true); assert.equal(document.querySelectorAll('#calendar-google input').length, 0);
  document.querySelector('#calendar-google-configure').click(); await until(() => calls === 1 && !document.querySelector('#calendar-google-connect').disabled);
});

test("save conflict retains the local draft and switching cases clears it", async t => {
  const { document, host } = setup(t); let caseKey = "one";
  const calendar = createCalendar({ api: async (path, options) => { if (options) throw new Error("This event has a newer saved version."); return { events: [event], access: { canWrite: true } }; }, getSession: () => ({ caseKey, access: { canWrite: true } }) }); t.after(() => calendar.unmount());
  await calendar.mount(host); await calendar.open(event.id); document.querySelector('[data-edit-event]').click(); input(document, '#calendar-event-title', 'My unsaved change'); document.querySelector('#calendar-event-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await until(() => document.querySelector('#calendar-message').textContent.includes('newer saved'));
  assert.equal(document.querySelector('#calendar-event-title').value, 'My unsaved change'); calendar.unmount(); caseKey = "two"; await calendar.mount(host); assert.equal(document.querySelector('#calendar-editor').hidden, true);
});
test("partial sync keeps failed events selected so users can retry without reselecting", async t => {
  const {document,host}=setup(t), other={...event,id:'second',title:'Second event'};
  const calendar=createCalendar({api:async()=>({events:[event,other],access:{canWrite:true}}),getSession:()=>({caseKey:'one',access:{canWrite:true}}),google:{status:async()=>({available:true,configured:true,connected:true}),sync:async()=>({synced:[event.id],failed:[{id:other.id,error:'Unavailable'}],message:'1 entry synced; 1 could not sync.'})}});t.after(()=>calendar.unmount());await calendar.mount(host);await calendar.open(event.id);
  for(const checkbox of document.querySelectorAll('[data-select-event]')){checkbox.checked=true;checkbox.dispatchEvent(new window.Event('change'));}document.querySelector('#calendar-sync').click();await until(()=>document.querySelector('#calendar-message').textContent.includes('could not sync'));
  assert.equal(document.querySelector('[data-select-event="example-manual"]').checked,false);assert.equal(document.querySelector('[data-select-event="second"]').checked,true);assert.equal(document.querySelector('#calendar-sync').disabled,false);assert.equal(document.querySelector('#calendar-message').classList.contains('error'),true);
});
test("pending Google sign-in refreshes after its callback and Escape closes its panel", async t => {
  const {document,host}=setup(t);let state={available:true,configured:true,connected:false,pending:true,message:'Finish signing in in your browser.'};
  const calendar=createCalendar({api:async()=>({events:[event],access:{canWrite:true}}),getSession:()=>({caseKey:'one',access:{canWrite:true}}),google:{status:async()=>state}});t.after(()=>calendar.unmount());await calendar.mount(host);document.querySelector('#calendar-google-toggle').click();assert.equal(document.querySelector('#calendar-google-connect').textContent,'Cancel sign-in');
  state={...state,connected:true,pending:false,message:'Google Calendar connected.'};await until(()=>document.querySelector('#calendar-google-connect').textContent==='Disconnect Google');assert.match(document.querySelector('#calendar-message').textContent,/connected/);
  document.querySelector('.calendar-workspace').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(document.querySelector('#calendar-google').hidden,true);
});
test("cancelled native client-file import never reports successful configuration",async t=>{
  const {document,host}=setup(t),state={available:true,configured:false,connected:false,pending:false,message:''};
  const calendar=createCalendar({api:async()=>({events:[],access:{canWrite:true}}),getSession:()=>({caseKey:'one',access:{canWrite:true}}),google:{status:async()=>state,configure:async()=>state}});t.after(()=>calendar.unmount());await calendar.mount(host);document.querySelector('#calendar-google-toggle').click();document.querySelector('#calendar-google-configure').click();await until(()=>document.querySelector('#calendar-message').textContent.includes('No connection file'));
  assert.equal(document.querySelector('#calendar-google-connect').disabled,true);
});

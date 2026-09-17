import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { normaliseGraph, filterGraph, createCaseMap } from "../public/graph.js";

const example = () => ({ graph: { nodes: [
  { id: "people/alex.md", type: "person", label: "Alex", role: "Applicant", reference: "people/alex.md" },
  { id: "timeline/meeting.md", type: "event", label: "School meeting", date: "2026-09-15", reference: "timeline/meeting.md", sources: [{ name: "letter.pdf", page: 2 }], tags: ["school"] },
  { id: "notes/unrelated.md", type: "note", label: "Another school meeting" },
], edges: [{ source: "timeline/meeting.md", target: "people/alex.md", label: "Person recorded in note" }], unresolvedLinks: 2 } });

test("graph draws only supplied valid links and does not infer links from similar titles", () => {
  const model = example();
  model.graph.edges.push({ source: "missing", target: "people/alex.md", label: "Unknown" });
  model.graph.edges.push({ source: "people/alex.md", target: "people/alex.md", label: "Self" });
  model.graph.edges.push(model.graph.edges[0]);
  const graph = normaliseGraph(model);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.unresolvedLinks, 2);
  assert.deepEqual(graph.nodes[1].sources, ["letter.pdf · page 2"]);
  const legacy = normaliseGraph({ timeline: [{ eventId: "E-1", title: "Alex meeting" }], people: [{ name: "Alex" }], evidence: [{ claim: "Alex meeting", source: "letter.pdf" }] });
  assert.equal(legacy.nodes.length, 3);
  assert.deepEqual(legacy.edges, [], "Legacy names alone must not create evidence relationships");
});

test("search and type filtering keep only edges whose endpoints are visible", () => {
  const graph = normaliseGraph(example());
  const filtered = filterGraph(graph, "school");
  assert.equal(filtered.nodes.length, 2);
  assert.equal(filtered.edges.length, 0);
  assert.equal(filterGraph(graph, "letter.pdf").nodes[0].label, "School meeting");
  assert.deepEqual(filterGraph(graph, "", "person").nodes.map((n) => n.label), ["Alex"]);
  assert.equal(filterGraph(graph, "2026-09-15").nodes.length, 1);
  assert.equal(filterGraph(graph, "no match").nodes.length, 0);
});

test("map falls back to a complete searchable list with source details and connected records", (t) => {
  const dom = new JSDOM('<main id="host"></main>');
  const host = dom.window.document.querySelector("#host"), map = createCaseMap();
  t.after(() => { map.unmount(); dom.window.close(); });
  map.mount(host, example());
  assert.equal(host.querySelectorAll(".map-items li").length, 3);
  assert.equal(host.querySelector("#map-fallback").hidden, false);
  assert.equal(host.querySelector('[data-map-mode="map"]').disabled, true);
  assert.match(host.textContent, /2 recorded links point to a note that could not be matched/);
  host.querySelector('[data-map-select="timeline/meeting.md"]').click();
  assert.match(host.querySelector("#map-details").textContent, /letter.pdf · page 2/);
  assert.match(host.querySelector("#map-details").textContent, /Person recorded in note/);
  host.querySelector('#map-details [data-map-select="people/alex.md"]').click();
  assert.equal(host.querySelector("#map-details h2").textContent, "Alex");
  host.querySelector('[data-map-mode="list"]').click();
  assert.equal(host.querySelector("#map-map").hidden, true);
  assert.equal(host.querySelector("#map-list").hidden, false);
  host.querySelector("#map-search").value = "letter.pdf";
  host.querySelector("#map-search").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(host.querySelectorAll(".map-items li").length, 1);
  assert.match(host.querySelector("#map-count").textContent, /1 item · 0 recorded connections/);
  host.querySelector("#map-type").value = "person";
  host.querySelector("#map-type").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(host.querySelector("#map-list").textContent, /No matching records/);
});

test("untrusted note text stays text in list, source references and links", (t) => {
  const dom = new JSDOM('<main id="host"></main>');
  const host = dom.window.document.querySelector("#host"), map = createCaseMap();
  t.after(() => { map.unmount(); dom.window.close(); });
  const attack = '<img src=x onerror="bad()"><script>bad()</script>';
  const model = example();
  model.graph.nodes[0].label = attack;
  model.graph.nodes[0].reference = attack;
  model.graph.edges[0].label = attack;
  map.mount(host, model);
  host.querySelector('[data-map-mode="list"]').click();
  host.querySelector('#map-list [data-map-select="people/alex.md"]').click();
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector("script"), null);
  assert.equal(host.querySelector("#map-details h2").textContent, attack);
  assert.match(host.querySelector("#map-details").textContent, /<img/);
});

test("blurring map search does not replace the result before its first click", t => {
  const dom = new JSDOM('<main id="host"></main>');
  const host = dom.window.document.querySelector("#host"), map = createCaseMap();
  t.after(() => { map.unmount(); dom.window.close(); });
  map.mount(host, example());
  host.querySelector('[data-map-mode="list"]').click();
  const search = host.querySelector("#map-search");
  search.value = "letter.pdf";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const result = host.querySelector('#map-list [data-map-select="timeline/meeting.md"]');
  // A real pointer click blurs the changed input before delivering click to the
  // result. The result must survive that change event for the click to bubble.
  search.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(result.isConnected, true);
  result.click();
  assert.equal(host.querySelector("#map-details h2").textContent, "School meeting");
});

test("large graphs keep every matching item available without WebGL", (t) => {
  const dom = new JSDOM('<main id="host"></main>');
  const host = dom.window.document.querySelector("#host"), map = createCaseMap();
  t.after(() => { map.unmount(); dom.window.close(); });
  map.mount(host, { graph: { nodes: Array.from({ length: 125 }, (_, i) => ({ id: `n-${i}`, label: `Note ${i}`, type: "note" })), edges: [] } });
  assert.equal(host.querySelectorAll(".map-items li").length, 125);
  assert.equal(host.querySelector("#map-limit"), null);
  host.querySelector('[data-map-mode="list"]').click();
  assert.equal(host.querySelectorAll(".map-items li").length, 125);
  assert.equal(host.querySelector("#map-limit"), null);
  map.unmount();
  map.mount(host, { graph: { nodes: [], edges: [] } });
  assert.equal(host.querySelectorAll(".map-node").length, 0);
  assert.doesNotMatch(host.textContent, /Note 124/);
});

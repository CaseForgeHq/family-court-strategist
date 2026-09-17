import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { layoutGraph3D, flightStep } from './map-layout.js';
import { icon } from './icons.js';

const palette = { person: '#b55633', event: '#487b63', pattern: '#8973a1', evidence: '#ba8549', document: '#458ac0', tag: '#8b9060', note: '#698b98' };
const glyph = { person: 'people', event: 'calendar', pattern: 'patterns', evidence: 'evidence', document: 'file', tag: 'link', note: 'notebook' };
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createMapScene(container, { onSelect, onUnavailable, onModeChange } = {}) {
  const doc = container.ownerDocument, win = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 1.7));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'map-canvas'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D case map. Drag to orbit, scroll to zoom. Choose Fly to move with W A S D and Q E. Escape returns to orbit. Use List for all records.');
  canvas.setAttribute('aria-describedby', 'map-navigation-hint');
  const labels = doc.createElement('div'); labels.className = 'map-labels';
  container.replaceChildren(canvas, labels);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, 1, 6000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x35575c, 2.6));
  const light = new THREE.DirectionalLight(0xffe1bb, 3.1); light.position.set(-220, 450, 500); scene.add(light);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.minDistance = 55; controls.maxDistance = 2600;
  controls.maxTargetRadius = 1100; controls.rotateSpeed = .65; controls.zoomSpeed = .75;
  const records = new THREE.Group(), lines = new THREE.Group(); scene.add(records, lines);
  const grid = new THREE.PolarGridHelper(600, 12, 5, 100, 0x7d9696, 0x7d9696);
  grid.position.y = -235; grid.material.transparent = true; grid.material.opacity = .13; scene.add(grid);
  const sphere = new THREE.SphereGeometry(8, 24, 16);
  let points = new Map(), meshes = [], edgeMeshes = [], labelNodes = [], selected = null;
  let disposed = false, paused = false, frame = 0, previousTime = 0, mode = 'orbit', drag = null;
  let homeDistance = 740, homeTarget = new THREE.Vector3(), selectedPosition = null;
  const keys = new Set(), listeners = [];
  function listen(target, name, fn, options) { target.addEventListener(name, fn, options); listeners.push(() => target.removeEventListener(name, fn, options)); }
  function stop() { keys.clear(); drag = null; previousTime = 0; }
  function request() { if (!disposed && !paused && !doc.hidden && !frame) frame = win.requestAnimationFrame(draw); }
  function draw(now) {
    frame = 0;
    if (disposed || paused || doc.hidden) return;
    if (mode === 'fly' && keys.size) {
      const movement = flightStep(keys, previousTime ? (now - previousTime) / 1000 : 1 / 60);
      const delta = new THREE.Vector3(movement.x, 0, movement.z).applyQuaternion(camera.quaternion);
      delta.y += movement.y; camera.position.add(delta).clampLength(0, 2600);
    }
    previousTime = now;
    camera.updateMatrixWorld(); renderer.render(scene, camera);
    positionLabels();
    if (mode === 'fly' && keys.size) request();
  }
  function positionLabels() {
    const width = container.clientWidth, height = container.clientHeight, occupied = [];
    const visible = labelNodes.map(({ node, element }) => {
      const point = new THREE.Vector3().copy(points.get(node.id));
      const distance = camera.position.distanceTo(point); point.project(camera);
      return { node, element, point, distance, x: (point.x * .5 + .5) * width, y: (-point.y * .5 + .5) * height + 16 };
    }).sort((a, b) => Number(b.node.id === selected) - Number(a.node.id === selected) || a.distance - b.distance);
    for (const p of visible) {
      const w = 172, h = 34;
      const box = { x: p.x - w / 2, y: p.y, w, h };
      const clipped = p.point.z < -1 || p.point.z > 1 || box.x < 5 || box.x + w > width - 5 || box.y < 5 || box.y + h > height - 5;
      const overlap = occupied.some(b => box.x < b.x + b.w + 5 && box.x + w + 5 > b.x && box.y < b.y + b.h + 6 && box.y + h + 6 > b.y);
      p.element.hidden = clipped || (overlap && p.node.id !== selected && doc.activeElement !== p.element);
      if (!p.element.hidden) occupied.push(box);
      p.element.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px) translateX(-50%)`;
      p.element.style.zIndex = p.node.id === selected ? '3' : '1';
    }
  }
  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); request();
  }
  function clearRecords() {
    for (const mesh of meshes) mesh.material.dispose();
    for (const edge of edgeMeshes) { edge.geometry.dispose(); edge.material.dispose(); }
    records.clear(); lines.clear(); labels.replaceChildren(); meshes = []; edgeMeshes = []; labelNodes = [];
  }
  function update(graph) {
    stop(); clearRecords(); points = layoutGraph3D(graph);
    const positions = [...points.values()];
    const bounds = new THREE.Box3().setFromPoints(positions.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    homeTarget = positions.length ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const extent = positions.length ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
    homeDistance = Math.max(500, Math.max(extent.y + 130, (extent.x + 260) / Math.max(.5, camera.aspect)) / (2 * Math.tan(THREE.MathUtils.degToRad(24))) + extent.z / 2);
    grid.position.y = (positions.length ? bounds.min.y : 0) - 95;
    for (const node of graph.nodes) {
      const material = new THREE.MeshStandardMaterial({ color: palette[node.type], roughness: .28, metalness: .15 });
      const mesh = new THREE.Mesh(sphere, material); mesh.position.copy(points.get(node.id)); mesh.userData.id = node.id;
      if (node.type === 'person') mesh.scale.setScalar(1.35);
      records.add(mesh); meshes.push(mesh);
      const element = doc.createElement('button'); element.type = 'button'; element.className = `map-node type-${node.type}`;
      element.dataset.mapSelect = node.id; element.title = node.label; element.setAttribute('aria-label', `${node.type === 'tag' ? 'Topic' : node.type}: ${node.label}`);
      element.innerHTML = icon(glyph[node.type]); const text = doc.createElement('span'); text.textContent = node.label; element.append(text);
      labels.append(element); labelNodes.push({ node, element });
    }
    for (const edge of graph.edges) {
      const a = points.get(edge.source), b = points.get(edge.target); if (!a || !b) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x668382, transparent: true, opacity: .45 }));
      line.userData = edge; lines.add(line); edgeMeshes.push(line);
    }
    setSelected(selected); reset();
  }
  function setSelected(id) {
    selected = id; selectedPosition = points.get(id);
    const dark = doc.documentElement.dataset.sceneMode === 'dark';
    for (const mesh of meshes) {
      const active = mesh.userData.id === id; mesh.material.emissive.set(active ? palette[graphType(mesh)] : '#000000'); mesh.material.emissiveIntensity = active ? .42 : 0;
    }
    for (const edge of edgeMeshes) {
      const active = id && (edge.userData.source === id || edge.userData.target === id);
      edge.material.color.set(active ? (dark ? '#e7bd8c' : '#915226') : (dark ? '#b6ccca' : '#587675'));
      edge.material.opacity = active ? .95 : id ? .22 : .55;
    }
    for (const { node, element } of labelNodes) { element.setAttribute('aria-pressed', String(node.id === id)); element.classList.toggle('is-selected', node.id === id); }
    request();
  }
  function graphType(mesh) { return labelNodes.find(p => p.node.id === mesh.userData.id)?.node.type || 'note'; }
  function setMode(next) {
    stop(); mode = next; controls.enabled = next === 'orbit';
    if (next === 'orbit') { const direction = camera.getWorldDirection(new THREE.Vector3()); controls.target.copy(camera.position).addScaledVector(direction, Math.min(homeDistance, 450)); controls.update(); }
    container.dataset.navigation = mode; onModeChange?.(mode); request();
  }
  function reset() { setMode('orbit'); camera.position.copy(homeTarget).add(new THREE.Vector3(0, homeDistance * .12, homeDistance)); controls.target.copy(homeTarget); controls.update(); request(); }
  function focus() {
    if (!selectedPosition) return;
    setMode('orbit'); controls.target.copy(selectedPosition);
    camera.position.copy(selectedPosition).add(new THREE.Vector3(45, 60, 310)); controls.update(); request();
  }
  function zoom(direction) {
    if (mode === 'fly') { camera.translateZ(direction === 'in' ? -75 : 75); camera.position.clampLength(0, 2600); }
    else { const delta = camera.position.clone().sub(controls.target).multiplyScalar(direction === 'in' ? .8 : 1.25); camera.position.copy(controls.target).add(delta); controls.update(); }
    request();
  }
  controls.addEventListener('change', request);
  listen(canvas, 'pointerdown', event => {
    canvas.focus({ preventScroll: true }); drag = { x: event.clientX, y: event.clientY, previousX: event.clientX, previousY: event.clientY };
    if (mode === 'fly') canvas.setPointerCapture(event.pointerId);
  });
  listen(canvas, 'pointermove', event => {
    if (mode !== 'fly' || !drag) return;
    const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    rotation.y -= (event.clientX - drag.previousX) * .004;
    rotation.x = Math.max(-1.45, Math.min(1.45, rotation.x - (event.clientY - drag.previousY) * .004));
    camera.quaternion.setFromEuler(rotation); drag.previousX = event.clientX; drag.previousY = event.clientY; request();
  });
  listen(canvas, 'pointerup', event => {
    if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) {
      const rect = canvas.getBoundingClientRect(), pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(meshes)[0]; if (hit) onSelect?.(hit.object.userData.id);
    }
    drag = null;
  });
  listen(canvas, 'pointercancel', stop);
  listen(canvas, 'keydown', event => {
    if (event.key === 'Escape' && mode === 'fly') { event.preventDefault(); setMode('orbit'); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || !movementKeys.has(event.code)) return;
    event.preventDefault();
    if (mode === 'fly') { keys.add(event.code); request(); }
    else { const step = 35; if (['ArrowLeft', 'KeyA'].includes(event.code)) controls.rotateLeft(.09); if (['ArrowRight', 'KeyD'].includes(event.code)) controls.rotateLeft(-.09); if (['ArrowUp', 'KeyW'].includes(event.code)) controls.rotateUp(.09); if (['ArrowDown', 'KeyS'].includes(event.code)) controls.rotateUp(-.09); if (event.code === 'KeyQ') controls.pan(0, step); if (event.code === 'KeyE') controls.pan(0, -step); controls.update(); request(); }
  });
  listen(win, 'keyup', event => keys.delete(event.code)); listen(canvas, 'blur', stop); listen(win, 'blur', stop);
  listen(doc, 'visibilitychange', () => { stop(); if (doc.hidden && frame) { win.cancelAnimationFrame(frame); frame = 0; } else request(); });
  listen(canvas, 'wheel', event => { if (mode === 'fly') { event.preventDefault(); zoom(event.deltaY < 0 ? 'in' : 'out'); } }, { passive: false });
  listen(canvas, 'webglcontextlost', event => { event.preventDefault(); onUnavailable?.(); });
  const resizeObserver = new win.ResizeObserver(resize); resizeObserver.observe(container);
  const themeObserver = new win.MutationObserver(() => setSelected(selected)); themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-scene-mode'] });
  resize();
  return { update, setSelected, setMode, reset, focus, zoom,
    focusCanvas() { canvas.focus({ preventScroll: true }); },
    pause(value) { paused = value; stop(); if (paused && frame) { win.cancelAnimationFrame(frame); frame = 0; } else request(); },
    // Read-only camera state also makes real-renderer regression checks possible.
    snapshot() { return { position: camera.position.toArray(), target: controls.target.toArray(), mode, nodes: meshes.length, edges: edgeMeshes.length, framePending: !!frame }; },
    dispose() { disposed = true; stop(); win.cancelAnimationFrame(frame); listeners.forEach(remove => remove()); resizeObserver.disconnect(); themeObserver.disconnect(); controls.dispose(); clearRecords(); sphere.dispose(); grid.geometry.dispose(); grid.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); container.replaceChildren(); },
  };
}

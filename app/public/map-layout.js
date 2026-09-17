// Stable, bounded 3D layout. Coordinates only arrange records; they are not scores.
export function layoutGraph3D(graph) {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const count = nodes.length, radius = Math.max(145, Math.sqrt(count) * 59);
  const points = nodes.map((n, i) => {
    const y = count > 1 ? 1 - 2 * (i + .5) / count : 0;
    const ring = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    return { id: n.id, x: count > 1 ? Math.cos(angle) * ring * radius : 0,
      y: y * radius * .74, z: count > 1 ? Math.sin(angle) * ring * radius * .72 : 0 };
  });
  const byId = new Map(points.map(p => [p.id, p]));
  for (let step = 0; step < 85; step++) {
    const force = new Map(points.map(p => [p.id, { x: -p.x * .002, y: -p.y * .002, z: -p.z * .002 }]));
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = points[i], b = points[j], delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
      const distance = Math.max(1, Math.hypot(delta.x, delta.y, delta.z));
      const strength = Math.min(9, 19000 / distance ** 2);
      for (const axis of ['x', 'y', 'z']) { const f = delta[axis] / distance * strength; force.get(a.id)[axis] += f; force.get(b.id)[axis] -= f; }
    }
    for (const edge of graph.edges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
      for (const axis of ['x', 'y', 'z']) {
        const f = (b[axis] - a[axis]) / distance * (distance - 190) * .007;
        force.get(a.id)[axis] += f; force.get(b.id)[axis] -= f;
      }
    }
    for (const p of points) for (const axis of ['x', 'y', 'z']) p[axis] = Math.max(-900, Math.min(900, p[axis] + force.get(p.id)[axis]));
  }
  for (const p of points) p.x *= 1.65;
  return byId;
}

// Normalize diagonals, cap frame gaps, and prevent travel far outside the map.
export function flightStep(keys, seconds, speed = 210) {
  const pressed = (...names) => names.some(name => keys.has(name)) ? 1 : 0;
  const x = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft');
  const y = pressed('KeyE') - pressed('KeyQ');
  const z = pressed('KeyS', 'ArrowDown') - pressed('KeyW', 'ArrowUp');
  const length = Math.hypot(x, y, z) || 1;
  const scale = speed * Math.max(0, Math.min(seconds, .05)) / length;
  return { x: x * scale, y: y * scale, z: z * scale };
}

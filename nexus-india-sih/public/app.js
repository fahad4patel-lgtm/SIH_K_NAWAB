import Graph from "graphology";
import Sigma from "sigma";
import { NodeProgram } from "sigma/rendering";
import forceAtlas2 from "graphology-layout-forceatlas2";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let state = { network: null, cases: null, ledger: null };
let selectedEntityId = null;
let graphFocus = false;
let activeTypeFilter = "all";
let graphRenderer = null;
let graphModel = null;
let graphAdjacency = new Map();
let graphViewState = { mode: "all", visibleIds: new Set(), adjacent: new Set(), selectedId: null };
let hoveredNodeId = null;
let hoveredAdjacent = new Set();
let historyTrail = [];

const SQUARE_VERTEX_SHADER = `
  attribute vec4 a_id;
  attribute vec4 a_color;
  attribute vec2 a_position;
  attribute float a_size;
  attribute float a_angle;
  uniform mat3 u_matrix;
  uniform float u_sizeRatio;
  uniform float u_cameraAngle;
  uniform float u_correctionRatio;
  varying vec4 v_color;
  const float sqrt_8 = sqrt(8.0);
  void main() {
    float size = a_size * u_correctionRatio / u_sizeRatio * sqrt_8;
    float angle = a_angle + u_cameraAngle; 
    vec2 diffVector = size * vec2(cos(angle), sin(angle));
    vec2 position = a_position + diffVector;
    gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);
    #ifdef PICKING_MODE
    v_color = a_id;
    #else
    v_color = a_color;
    #endif
    v_color.a *= (255.0 / 254.0);
  }
`;

const SQUARE_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec4 v_color;
  void main(void) {
    gl_FragColor = v_color;
  }
`;

function floatColor(color) {
  if (typeof color === "string" && color.startsWith("#")) {
    let c = color.slice(1);
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return (r) | (g << 8) | (b << 16) | (255 << 24);
  }
  return 4294967295;
}

class NodeSquareProgram extends NodeProgram {
  getDefinition() {
    const u = Math.PI;
    return {
      VERTICES: 6,
      VERTEX_SHADER_SOURCE: SQUARE_VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: SQUARE_FRAGMENT_SHADER,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS: ["u_sizeRatio", "u_correctionRatio", "u_cameraAngle", "u_matrix"],
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: WebGLRenderingContext.FLOAT },
        { name: "a_size", size: 1, type: WebGLRenderingContext.FLOAT },
        { name: "a_color", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true }
      ],
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: WebGLRenderingContext.FLOAT }],
      CONSTANT_DATA: [[u / 4], [3 * u / 4], [-u / 4], [3 * u / 4], [-u / 4], [-3 * u / 4]]
    };
  }
  processVisibleItem(nodeIndex, startIndex, data) {
    const array = this.array;
    const color = floatColor(data.color || "#38bdf8");
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = color;
    array[startIndex++] = nodeIndex;
  }
  setUniforms(params, { gl, uniformLocations }) {
    gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
    gl.uniform1f(uniformLocations.u_cameraAngle, params.cameraAngle);
    gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
    gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
  }
}

const OCCUPATION_COLORS = {
  "logistics supervisor": "#38bdf8",
  "delivery driver": "#38bdf8",
  "transport contractor": "#38bdf8",
  "warehouse worker": "#0ea5e9",
  "accountant": "#34d399",
  "automobile dealer": "#10b981",
  "mechanic": "#a78bfa",
  "freelance technician": "#818cf8",
  "business consultant": "#f472b6",
  "office administrator": "#fb7185"
};

const NODE_COLORS = {
  person: "#38bdf8",
  suspect: "#38bdf8",
  incident: "#fbbf24",
  case: "#fbbf24",
  identifier: "#94a3b8",
  phone: "#94a3b8",
  phone_ref: "#94a3b8",
  vehicle: "#94a3b8",
  organization: "#60a5fa",
  event: "#fbbf24",
  location: "#a3e635",
  account: "#34d399",
  device: "#94a3b8",
  default: "#94a3b8"
};

function getNodeColor(entityOrType) {
  if (!entityOrType) return NODE_COLORS.default;
  if (typeof entityOrType === "string") {
    return NODE_COLORS[entityOrType.toLowerCase()] || NODE_COLORS.default;
  }
  if (entityOrType.occupation) {
    const occ = entityOrType.occupation.toLowerCase().trim();
    if (OCCUPATION_COLORS[occ]) return OCCUPATION_COLORS[occ];
    for (const [key, color] of Object.entries(OCCUPATION_COLORS)) {
      if (occ.includes(key) || key.includes(occ)) return color;
    }
  }
  const type = (entityOrType.type || "").toLowerCase();
  return NODE_COLORS[type] || NODE_COLORS.default;
}

function getEdgeColor(rel) {
  return "rgba(255, 255, 255, 0.22)";
}

async function api(url, opt = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opt });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || ("API " + r.status));
  return data;
}

function toast(t) {
  const x = $("#toast");
  if (!x) return;
  x.textContent = t;
  x.classList.add("show");
  setTimeout(() => x.classList.remove("show"), 2200);
}

function go(id) {
  $$('.page').forEach(x => x.classList.toggle('active', x.id === id));
  $$('.nav').forEach(x => x.classList.toggle('active', x.dataset.page === id));
  $('#pageTitle').textContent = {
    sentinel: 'Pattern & Cluster Analysis',
    network: 'Network Relationship Analysis',
    cases: 'Incident Records',
    ledger: 'Evidence Audit Ledger'
  }[id] || 'Investigative Intelligence';
  load(id);
}

$$(".nav").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));
$$("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

function addStat(container, label, value) {
  const item = document.createElement("div");
  item.className = "analysisStat";
  const number = document.createElement("strong");
  number.textContent = Number(value).toLocaleString();
  const caption = document.createElement("span");
  caption.textContent = label;
  item.append(number, caption);
  container.appendChild(item);
}

function addFinding(container, title, summary, evidence) {
  const item = document.createElement("article");
  item.className = "patternFinding";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const detail = document.createElement("p");
  detail.textContent = summary;
  const list = document.createElement("ul");
  evidence.forEach(entry => {
    const row = document.createElement("li");
    row.textContent = entry;
    list.appendChild(row);
  });
  item.append(heading, detail, list);
  container.appendChild(item);
}

async function loadSentinel() {
  if (!state.network) state.network = await api("/api/network");
  const { entities, edgeDetails = [] } = state.network;
  const incidents = entities.filter(entity => entity.type === "incident");
  const people = entities.filter(entity => entity.type !== "incident" && entity.type !== "identifier");
  const identifierCount = entities.filter(entity => entity.type === "identifier").length;
  
  const stats = $("#analysisStats");
  stats.replaceChildren();
  addStat(stats, "PERSONS OF INTEREST", people.length);
  addStat(stats, "INCIDENT RECORDS", incidents.length);
  addStat(stats, "MATCHED IDENTIFIERS", identifierCount);
  addStat(stats, "CONFIRMED RELATIONSHIPS", edgeDetails.length);

  // Highest-Degree Entities
  const hubsList = $("#hubsList");
  if (hubsList) {
    hubsList.replaceChildren();
    const sortedHubs = [...entities].sort((a, b) => (b.links || 0) - (a.links || 0)).slice(0, 5);
    const maxLinkCount = Math.max(1, sortedHubs[0]?.links || 1);
    
    sortedHubs.forEach((hub, idx) => {
      const item = document.createElement("div");
      item.className = "hubItem";
      const pct = Math.round(((hub.links || 0) / maxLinkCount) * 100);
      const hubColor = getNodeColor(hub);
      const typeBadge = hub.occupation
        ? `[${hub.occupation.toUpperCase()}]`
        : hub.type === "incident" ? "[CASE]" : hub.type === "identifier" ? "[ID]" : "[PERSON]";
      
      item.innerHTML = `
        <span class="hubRank" style="color: ${hubColor}">#${idx + 1}</span>
        <div class="hubInfo">
          <div class="hubName"><span class="hubTypeTag" style="border-color: ${hubColor}; color: ${hubColor}">${typeBadge}</span> ${hub.name}</div>
          <div class="hubBarTrack">
            <div class="hubBarFill" style="width: ${pct}%; background: ${hubColor};"></div>
          </div>
        </div>
        <span class="hubLinksCount">${hub.links || 0} links</span>
        <button class="hubActionBtn" title="Focus in Network Graph">Focus</button>
      `;
      item.querySelector(".hubActionBtn").onclick = () => {
        go("network");
        setTimeout(() => {
          applyGraphView("focus", hub.id, { zoom: true });
        }, 120);
      };
      hubsList.appendChild(item);
    });
  }

  // Topology Distribution
  const dist = $("#distributionBreakdown");
  if (dist) {
    dist.replaceChildren();
    const total = Math.max(1, entities.length);
    const groups = [
      { label: "Persons of Interest", count: people.length, color: "#38bdf8" },
      { label: "Incident Records (FIR)", count: incidents.length, color: "#fbbf24" },
      { label: "Matched Digital Identifiers", count: identifierCount, color: "#fb7185" }
    ];
    groups.forEach(g => {
      const pct = Math.round((g.count / total) * 100);
      const row = document.createElement("div");
      row.className = "distRow";
      row.innerHTML = `
        <div class="distRowHead"><span>${g.label}</span><b>${g.count} (${pct}%)</b></div>
        <div class="distTrack"><div class="distFill" style="width: ${pct}%; background: ${g.color};"></div></div>
      `;
      dist.appendChild(row);
    });
  }

  // Pattern Findings
  const results = $("#patternResults");
  results.replaceChildren();
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const incidentLinks = new Map(incidents.map(incident => [incident.id, []]));
  edgeDetails.forEach(edge => {
    if (incidentLinks.has(edge.source)) incidentLinks.get(edge.source).push(edge);
    if (incidentLinks.has(edge.target)) incidentLinks.get(edge.target).push(edge);
  });
  const linkedIncidents = incidents
    .map(incident => ({ incident, links: incidentLinks.get(incident.id) }))
    .filter(group => group.links.length > 1)
    .sort((a, b) => b.links.length - a.links.length);

  linkedIncidents.slice(0, 30).forEach(({ incident, links }) => {
    const linked = links.map(edge => byId.get(edge.source === incident.id ? edge.target : edge.source)).filter(Boolean);
    const names = [...new Set(linked.map(entity => entity.name))];
    const evidence = links.map(edge => edge.identifierHint ? `${edge.relationship} · ${edge.identifierHint}` : edge.relationship);
    addFinding(results, "Shared Incident Record", `${incident.name} connects ${names.length} subjects (${names.join(", ")}).`, evidence);
  });

  const adjacency = new Map(entities.map(entity => [entity.id, new Set()]));
  edgeDetails.forEach(edge => {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  entities.filter(entity => entity.type === "identifier" && entity.links > 1)
    .sort((a, b) => b.links - a.links)
    .slice(0, 30)
    .forEach(identifier => {
      const linked = [...(adjacency.get(identifier.id) || [])].map(id => byId.get(id)).filter(Boolean);
      addFinding(results, `Shared ${identifier.identifierType || "Digital"} Identifier`, `${identifier.name} links ${linked.length} records in common syndicate.`, linked.slice(0, 10).map(entity => `${entity.type}: ${entity.name}`));
    });

  const visited = new Set();
  let largest = [];
  entities.forEach(entity => {
    if (visited.has(entity.id)) return;
    const queue = [entity.id], component = [];
    visited.add(entity.id);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      component.push(id);
      adjacency.get(id)?.forEach(next => {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    if (component.length > largest.length) largest = component;
  });

  if (largest.length > 1) {
    const connected = largest.map(id => byId.get(id)).filter(Boolean);
    const largestSet = new Set(largest);
    const edgeCount = edgeDetails.reduce((count, edge) => count + (largestSet.has(edge.source) && largestSet.has(edge.target) ? 1 : 0), 0);
    addFinding(results, "Primary Syndicate Subgraph", `${connected.length} key records connected through ${edgeCount} verified relationships.`, connected.slice(0, 8).map(entity => `${entity.type}: ${entity.name}`));
  }
}

function getVisibleGraphNodes(selectedId, mode) {
  const visible = new Set();
  const adjacent = new Set(graphAdjacency.get(selectedId) || []);
  if (mode === "all" || !selectedId) {
    graphModel.forEachNode(id => visible.add(id));
    return { visible, adjacent };
  }
  visible.add(selectedId);
  adjacent.forEach(id => visible.add(id));
  const hubs = [...adjacent].filter(id => ["incident", "identifier"].includes(graphModel.getNodeAttribute(id, "entityType")));
  let expanded = 0;
  for (const hub of hubs) {
    for (const id of graphAdjacency.get(hub) || []) {
      if (id === selectedId || visible.has(id)) continue;
      if (expanded >= 80) break;
      visible.add(id);
      expanded += 1;
    }
    if (expanded >= 80) break;
  }
  return { visible, adjacent };
}

function fitVisibleGraph(duration = 250) {
  if (!graphRenderer) return;
  if (graphViewState.mode === "all" || !graphViewState.selectedId) {
    graphRenderer.getCamera().animatedReset({ duration });
  } else {
    centerOnNode(graphViewState.selectedId, { ratio: 0.72, duration });
  }
}

function centerOnNode(nodeId, { ratio = 0.72, duration = 260 } = {}) {
  if (!graphRenderer || !nodeId) return;
  const point = graphRenderer.getNodeDisplayData(nodeId);
  if (!point) return;
  graphRenderer.getCamera().animate({ x: point.x, y: point.y, ratio }, { duration });
}

function updateHudStats() {
  if (!graphModel) return;
  const totalNodes = graphModel.order;
  const totalEdges = graphModel.size;
  const visibleNodes = [...graphViewState.visibleIds].filter(id => {
    if (activeTypeFilter === "all") return true;
    const type = graphModel.getNodeAttribute(id, "entityType");
    const links = graphModel.getNodeAttribute(id, "linksCount") || 0;
    if (activeTypeFilter === "person") return type !== "incident" && type !== "identifier";
    if (activeTypeFilter === "incident") return type === "incident";
    if (activeTypeFilter === "identifier") return type === "identifier";
    if (activeTypeFilter === "hubs") return links >= 3;
    return true;
  }).length;
  
  if ($("#hudEntitiesCount")) $("#hudEntitiesCount").textContent = `${visibleNodes}/${totalNodes}`;
  if ($("#hudEdgesCount")) $("#hudEdgesCount").textContent = totalEdges.toLocaleString();
  if ($("#hudModeVal")) $("#hudModeVal").textContent = graphViewState.mode === "focus" ? "TARGET FOCUS" : "GLOBAL TOPOLOGY";
  if ($("#hudDensityVal")) {
    const maxEdges = (totalNodes * (totalNodes - 1)) / 2;
    const density = maxEdges > 0 ? (totalEdges / maxEdges).toFixed(3) : "0.000";
    $("#hudDensityVal").textContent = density;
  }
}

function updateTrail(entity) {
  if (!entity) return;
  const idx = historyTrail.findIndex(item => item.id === entity.id);
  if (idx !== -1) {
    historyTrail = historyTrail.slice(0, idx + 1);
  } else {
    historyTrail.push({ id: entity.id, name: entity.name, type: entity.type });
    if (historyTrail.length > 5) historyTrail.shift();
  }
  renderTrail();
}

function renderTrail() {
  const container = $("#trailChips");
  if (!container) return;
  container.replaceChildren();

  const rootChip = document.createElement("button");
  rootChip.className = `trailChip ${!selectedEntityId ? "active" : ""}`;
  rootChip.textContent = "Global View";
  rootChip.onclick = () => {
    applyGraphView("all", null, { zoom: true });
  };
  container.appendChild(rootChip);

  historyTrail.forEach(item => {
    const chip = document.createElement("button");
    chip.className = `trailChip ${item.id === selectedEntityId ? "active" : ""}`;
    chip.textContent = item.name.length > 18 ? item.name.slice(0, 16) + "…" : item.name;
    chip.title = `${item.name} (${item.id})`;
    chip.onclick = () => {
      applyGraphView(graphFocus ? "focus" : "all", item.id, { zoom: true });
    };
    container.appendChild(chip);
  });
}

function applyGraphView(mode, selectedId, { zoom = false } = {}) {
  if (!graphModel || !graphRenderer) return;
  graphFocus = mode === "focus";
  selectedEntityId = selectedId;
  const neighborhood = getVisibleGraphNodes(selectedId, mode);
  graphViewState = {
    mode,
    selectedId,
    selected: new Set(selectedId ? [selectedId] : []),
    visibleIds: neighborhood.visible,
    adjacent: neighborhood.adjacent
  };

  $("#modeFocus")?.classList.toggle("active", mode === "focus");
  $("#modeAll")?.classList.toggle("active", mode === "all");

  graphRenderer.setSetting("labelDensity", mode === "focus" ? 0.18 : 0.08);
  graphRenderer.setSetting("labelGridCellSize", mode === "focus" ? 65 : 90);
  graphRenderer.setSetting("labelRenderedSizeThreshold", mode === "focus" ? 2 : 4);
  graphRenderer.setSetting("renderEdgeLabels", mode === "focus" && graphModel.size <= 400);
  graphRenderer.refresh();

  updateHudStats();

  if (selectedId) {
    const entity = state.network.entities.find(item => item.id === selectedId);
    if (entity) {
      selectEntity(entity);
      updateTrail(entity);
    }
  }
  if (zoom) fitVisibleGraph(260);
}

function applySpaciousLayout(graph) {
  const nodes = graph.nodes();
  if (nodes.length <= 1) return;

  const incidents = nodes.filter(id => graph.getNodeAttribute(id, "entityType") === "incident");
  const people = nodes.filter(id => graph.getNodeAttribute(id, "entityType") !== "incident" && graph.getNodeAttribute(id, "entityType") !== "identifier");
  const identifiers = nodes.filter(id => graph.getNodeAttribute(id, "entityType") === "identifier");

  incidents.forEach((id, i) => {
    const angle = (i / Math.max(1, incidents.length)) * Math.PI * 2;
    graph.mergeNodeAttributes(id, { x: Math.cos(angle) * 420, y: Math.sin(angle) * 360 });
  });

  people.forEach((id, i) => {
    const angle = (i / Math.max(1, people.length)) * Math.PI * 2 + 0.4;
    graph.mergeNodeAttributes(id, { x: Math.cos(angle) * 240, y: Math.sin(angle) * 200 });
  });

  identifiers.forEach((id, i) => {
    const angle = (i / Math.max(1, identifiers.length)) * Math.PI * 2 + 0.8;
    graph.mergeNodeAttributes(id, { x: Math.cos(angle) * 140, y: Math.sin(angle) * 120 });
  });

  forceAtlas2.assign(graph, {
    iterations: 160,
    settings: {
      barnesHutOptimize: false,
      adjustSizes: true,
      gravity: 0.015,
      scalingRatio: 500,
      slowDown: 4.0,
      strongGravityMode: false
    }
  });

  // Strict collision-free relaxation: guarantee minimum 160px center-to-center distance
  const minDistance = 160;
  for (let step = 0; step < 75; step++) {
    for (let i = 0; i < nodes.length; i++) {
      const idA = nodes[i];
      let xA = graph.getNodeAttribute(idA, "x");
      let yA = graph.getNodeAttribute(idA, "y");
      for (let j = i + 1; j < nodes.length; j++) {
        const idB = nodes[j];
        const xB = graph.getNodeAttribute(idB, "x");
        const yB = graph.getNodeAttribute(idB, "y");
        const dx = xB - xA;
        const dy = yB - yA;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < minDistance) {
          const overlap = (minDistance - dist) / 2;
          const nx = (dx / dist) * overlap;
          const ny = (dy / dist) * overlap;
          xA -= nx;
          yA -= ny;
          graph.setNodeAttribute(idB, "x", xB + nx);
          graph.setNodeAttribute(idB, "y", yB + ny);
        }
      }
      graph.setNodeAttribute(idA, "x", xA);
      graph.setNodeAttribute(idA, "y", yA);
    }
  }
}

function layoutGraph() {
  if (!graphModel || !graphModel.order) return;
  applySpaciousLayout(graphModel);
  graphRenderer?.refresh();
  fitVisibleGraph(260);
  toast("Graph layout recalculated with spacious clearance");
}

function showTooltip(nodeId) {
  const tooltip = $("#graphTooltip");
  if (!tooltip || !graphModel || !graphRenderer) return;
  const entity = state.network?.entities?.find(e => e.id === nodeId);
  if (!entity) return;

  const color = getNodeColor(entity);
  const badgeText = entity.occupation ? entity.occupation.toUpperCase() : (entity.type || "RECORD").toUpperCase();
  $("#tooltipBadge").textContent = badgeText;
  $("#tooltipBadge").style.color = color;
  $("#tooltipBadge").style.borderColor = color;
  $("#tooltipTitle").textContent = entity.name || nodeId;
  $("#tooltipLinks").textContent = `${entity.links || 0} direct links`;

  const meta = $("#tooltipMeta");
  meta.replaceChildren();
  if (entity.occupation) {
    const row = document.createElement("div");
    row.innerHTML = `<span style="color:var(--muted)">Role:</span> <strong style="color:${color}">${entity.occupation}</strong>`;
    meta.appendChild(row);
  }
  if (entity.city || entity.state) {
    const row = document.createElement("div");
    row.innerHTML = `<span style="color:var(--muted)">Location:</span> ${[entity.city, entity.state].filter(Boolean).join(", ")}`;
    meta.appendChild(row);
  }
  if (entity.age || entity.gender) {
    const row = document.createElement("div");
    row.innerHTML = `<span style="color:var(--muted)">Demographics:</span> ${[entity.age ? `${entity.age} yrs` : null, entity.gender].filter(Boolean).join(" · ")}`;
    meta.appendChild(row);
  }
  if (entity.type === "incident") {
    if (entity.location) {
      const row = document.createElement("div");
      row.innerHTML = `<span style="color:var(--muted)">Location:</span> ${entity.location}`;
      meta.appendChild(row);
    }
    if (entity.case_date) {
      const row = document.createElement("div");
      row.innerHTML = `<span style="color:var(--muted)">Recorded:</span> ${new Date(entity.case_date).toLocaleDateString()}`;
      meta.appendChild(row);
    }
  } else {
    const neighbors = [...(graphAdjacency.get(nodeId) || [])]
      .slice(0, 3)
      .map(id => state.network.entities.find(e => e.id === id)?.name || id);
    if (neighbors.length) {
      const row = document.createElement("div");
      row.innerHTML = `<span style="color:var(--muted)">Connected:</span> ${neighbors.join(", ")}${entity.links > 3 ? "…" : ""}`;
      meta.appendChild(row);
    }
  }

  const nodeData = graphRenderer.getNodeDisplayData(nodeId);
  if (!nodeData) return;
  const container = $("#graph");
  const rect = container.getBoundingClientRect();
  const pt = graphRenderer.graphToViewport({
    x: graphModel.getNodeAttribute(nodeId, "x"),
    y: graphModel.getNodeAttribute(nodeId, "y")
  });

  let left = pt.x + 18;
  let top = pt.y - 30;
  if (left + 260 > rect.width) left = Math.max(10, pt.x - 270);
  if (top + 140 > rect.height) top = Math.max(10, rect.height - 150);
  if (top < 10) top = 10;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.display = "block";
}

function hideTooltip() {
  const tooltip = $("#graphTooltip");
  if (!tooltip) return;
  tooltip.style.display = "none";
}

function createNetworkGraph(d) {
  const container = $("#graph");
  if (graphRenderer) {
    graphRenderer.kill();
    graphRenderer = null;
  }
  container.replaceChildren();
  graphModel = new Graph({ type: "undirected", multi: true });
  const entityById = new Map(d.entities.map(entity => [entity.id, entity]));
  graphAdjacency = new Map(d.entities.map(entity => [entity.id, new Set()]));

  const maxLinks = Math.max(1, ...d.entities.map(e => e.links || 0));

  d.entities.forEach(entity => {
    const isPerson = entity.type !== "incident" && entity.type !== "identifier";
    const color = getNodeColor(entity);
    const linkRatio = Math.sqrt((entity.links || 0) / maxLinks);
    // Balanced forensic sizes (squares for persons, circles for incidents/identifiers)
    const baseSize = isPerson ? 6.5 : entity.type === "incident" ? 7.0 : 5.0;
    const size = Math.round((baseSize + linkRatio * 3.0) * 10) / 10;
    const displayLabel = entity.occupation
      ? `${entity.name} · ${entity.occupation}`
      : entity.name;

    graphModel.addNode(entity.id, {
      label: displayLabel,
      displayName: entity.name,
      occupation: entity.occupation || "",
      type: isPerson ? "square" : "circle",
      entityType: entity.type,
      linksCount: entity.links || 0,
      x: 0,
      y: 0,
      size,
      baseSize: size,
      baseColor: color
    });
  });

  d.edgeDetails.forEach((edge, index) => {
    if (!graphModel.hasNode(edge.source) || !graphModel.hasNode(edge.target)) return;
    const key = `relationship-${index}`;
    const edgeColor = getEdgeColor(edge.relationship);
    graphModel.addEdgeWithKey(key, edge.source, edge.target, {
      label: edge.relationship,
      relationship: edge.relationship,
      identifierHint: edge.identifierHint || "",
      size: 0.9,
      baseColor: edgeColor,
      color: edgeColor
    });
    graphAdjacency.get(edge.source)?.add(edge.target);
    graphAdjacency.get(edge.target)?.add(edge.source);
  });

  applySpaciousLayout(graphModel);

  const selectedId = entityById.has(selectedEntityId)
    ? selectedEntityId
    : d.entities.filter(entity => entity.type !== "identifier").sort((a, b) => (b.links || 0) - (a.links || 0))[0]?.id || d.entities[0]?.id;
  selectedEntityId = selectedId;
  graphViewState = { mode: "all", selectedId, selected: new Set([selectedId]), visibleIds: new Set(), adjacent: new Set(graphAdjacency.get(selectedId) || []) };

  graphRenderer = new Sigma(graphModel, container, {
    nodeProgramClasses: {
      square: NodeSquareProgram
    },
    autoRescale: true,
    autoCenter: true,
    stagePadding: 90,
    renderLabels: true,
    renderEdgeLabels: true,
    labelDensity: 0.16,
    labelGridCellSize: 75,
    labelRenderedSizeThreshold: 2,
    labelSize: 11,
    labelFont: '"Segoe UI", system-ui, -apple-system, sans-serif',
    labelWeight: "700",
    labelColor: { color: "#ffffff" },
    edgeLabelColor: { color: "#cbd5e1" },
    edgeLabelSize: 9,
    edgeLabelFont: '"Segoe UI", system-ui, -apple-system, sans-serif',
    hideEdgesOnMove: false,
    hideLabelsOnMove: false,
    minCameraRatio: 0.05,
    maxCameraRatio: 8,
    nodeReducer: (node, attributes) => {
      const visible = graphViewState.mode === "all" || graphViewState.visibleIds.has(node);
      const isSelected = node === graphViewState.selectedId;
      const isHovered = node === hoveredNodeId;
      const isAdjacentToSelected = graphViewState.adjacent.has(node);
      const isAdjacentToHovered = hoveredAdjacent.has(node);

      if (!visible) return { ...attributes, hidden: true, label: null };

      let matchesFilter = true;
      if (activeTypeFilter === "person") matchesFilter = attributes.entityType !== "incident" && attributes.entityType !== "identifier";
      else if (activeTypeFilter === "incident") matchesFilter = attributes.entityType === "incident";
      else if (activeTypeFilter === "identifier") matchesFilter = attributes.entityType === "identifier";
      else if (activeTypeFilter === "hubs") matchesFilter = (attributes.linksCount || 0) >= 3;

      if (!matchesFilter) {
        return {
          ...attributes,
          color: "#1e293b",
          size: 3.0,
          label: null,
          forceLabel: false,
          highlighted: false
        };
      }

      if (isSelected) {
        return {
          ...attributes,
          hidden: false,
          color: attributes.baseColor,
          size: Math.round((attributes.baseSize + 2.2) * 10) / 10,
          forceLabel: true,
          highlighted: true
        };
      }

      if (isHovered) {
        return {
          ...attributes,
          hidden: false,
          color: attributes.baseColor,
          size: Math.round((attributes.baseSize + 1.4) * 10) / 10,
          forceLabel: true,
          highlighted: true
        };
      }

      if (isAdjacentToSelected || isAdjacentToHovered) {
        return {
          ...attributes,
          hidden: false,
          color: attributes.baseColor,
          size: Math.round((attributes.baseSize + 0.8) * 10) / 10,
          forceLabel: true,
          highlighted: false
        };
      }

      if (graphViewState.mode === "focus" && graphViewState.selectedId) {
        return {
          ...attributes,
          color: "#334155",
          size: Math.max(3.2, Math.round(attributes.baseSize * 0.65 * 10) / 10),
          label: null,
          forceLabel: false,
          highlighted: false
        };
      }

      return {
        ...attributes,
        hidden: false,
        color: attributes.baseColor,
        size: attributes.baseSize,
        forceLabel: false,
        highlighted: false
      };
    },
    edgeReducer: (edge, attributes) => {
      const [source, target] = graphModel.extremities(edge);
      const inView = graphViewState.mode === "all" || (graphViewState.visibleIds.has(source) && graphViewState.visibleIds.has(target));
      if (!inView) return { ...attributes, hidden: true, label: null };

      const touchesSelected = source === graphViewState.selectedId || target === graphViewState.selectedId;
      const touchesHovered = source === hoveredNodeId || target === hoveredNodeId;

      if (touchesSelected || touchesHovered) {
        return {
          ...attributes,
          hidden: false,
          color: "#ffffff",
          size: 2.2,
          label: attributes.label
        };
      }

      if (graphViewState.mode === "focus" && graphViewState.selectedId) {
        return {
          ...attributes,
          color: "rgba(255, 255, 255, 0.05)",
          size: 0.5,
          label: null
        };
      }

      return {
        ...attributes,
        hidden: false,
        color: "rgba(255, 255, 255, 0.22)",
        size: 0.9,
        label: graphModel.size <= 300 ? attributes.label : null
      };
    }
  });

  graphRenderer.on("clickNode", ({ node }) => {
    applyGraphView(graphViewState.mode, node, { zoom: graphViewState.mode === "focus" });
  });

  graphRenderer.on("doubleClickNode", ({ node }) => {
    applyGraphView("focus", node, { zoom: true });
  });

  graphRenderer.on("enterNode", ({ node }) => {
    hoveredNodeId = node;
    hoveredAdjacent = new Set(graphAdjacency.get(node) || []);
    container.style.cursor = "pointer";
    graphRenderer.refresh();
    showTooltip(node);
  });

  graphRenderer.on("leaveNode", () => {
    hoveredNodeId = null;
    hoveredAdjacent.clear();
    container.style.cursor = "grab";
    graphRenderer.refresh();
    hideTooltip();
  });

  const mouseCaptor = graphRenderer.getMouseCaptor();
  let draggedNode = null;
  graphRenderer.on("downNode", ({ node, event }) => {
    event.preventSigmaDefault();
    draggedNode = node;
    const move = coordinates => {
      if (!draggedNode) return;
      const point = graphRenderer.viewportToGraph({ x: coordinates.x, y: coordinates.y });
      graphModel.mergeNodeAttributes(draggedNode, point);
    };
    const up = () => {
      draggedNode = null;
      mouseCaptor.off("mousemovebody", move);
      mouseCaptor.off("mouseup", up);
    };
    mouseCaptor.on("mousemovebody", move);
    mouseCaptor.on("mouseup", up);
  });

  applyGraphView("all", selectedId, { zoom: true });
  updateFilterCounts();
}

function renderGraph(d) {
  if (graphModel && graphRenderer && state.network === d) {
    const query = $("#graphSearch").value.trim().toLocaleLowerCase();
    if (query) {
      const match = d.entities.find(entity => `${entity.name} ${entity.id} ${entity.type}`.toLocaleLowerCase().includes(query));
      if (match) {
        applyGraphView("focus", match.id, { zoom: true });
        return;
      }
    }
    applyGraphView(graphFocus ? "focus" : "all", selectedEntityId, { zoom: false });
    return;
  }
  createNetworkGraph(d);
}

function selectEntity(e) {
  selectedEntityId = e.id;
  const color = getNodeColor(e);
  const avatar = $("#avatar");
  if (avatar) {
    avatar.textContent = (e.name || e.id)[0].toUpperCase();
    avatar.style.color = color;
    avatar.style.borderColor = color;
    avatar.style.boxShadow = `0 0 20px ${color}33`;
  }
  if ($("#dossierId")) $("#dossierId").textContent = `ID: ${e.id}`;
  if ($("#entityName")) $("#entityName").textContent = e.name;
  if ($("#entityType")) {
    $("#entityType").textContent = (e.type || "RECORD").toUpperCase();
    $("#entityType").style.color = color;
    $("#entityType").style.borderColor = color;
  }
  const profTag = $("#entityProfession");
  if (profTag) {
    if (e.occupation) {
      profTag.textContent = e.occupation.toUpperCase();
      profTag.style.color = color;
      profTag.style.borderColor = color;
      profTag.style.display = "inline-block";
    } else {
      profTag.style.display = "none";
    }
  }

  const maxLinks = Math.max(1, ...(state.network?.entities?.map(item => item.links || 0) || [1]));
  const score = Math.min(100, Math.round(((e.links || 0) / maxLinks) * 100));
  if ($("#centralityScore")) $("#centralityScore").textContent = `${score}%`;
  if ($("#centralityFill")) {
    $("#centralityFill").style.width = `${score}%`;
    $("#centralityFill").style.background = `linear-gradient(90deg, #64748b 0%, ${color} 100%)`;
  }
  if ($("#links")) $("#links").textContent = e.links || 0;
  if ($("#centralityRank")) {
    const rankLabel = score >= 70 ? "PRIMARY CENTRALITY (RANK 1)" : score >= 35 ? "SECONDARY CONNECTOR (RANK 2)" : "PERIPHERAL ENTITY";
    $("#centralityRank").textContent = rankLabel;
  }

  const metaContainer = $("#dossierMetadata");
  if (metaContainer) {
    metaContainer.replaceChildren();
    const rows = [];
    rows.push({ label: "RECORD IDENTIFIER", val: e.id });
    rows.push({ label: "CLASSIFICATION", val: (e.type || "Unknown").toUpperCase() });
    if (e.occupation) rows.push({ label: "OCCUPATION / PROFESSION", val: e.occupation });
    if (e.city || e.state) rows.push({ label: "PRIMARY JURISDICTION", val: [e.city, e.state].filter(Boolean).join(", ") });
    if (e.age || e.gender) rows.push({ label: "DEMOGRAPHICS", val: [e.age ? `${e.age} years` : null, e.gender].filter(Boolean).join(" · ") });
    if (e.location) rows.push({ label: "PRIMARY LOCATION", val: e.location });
    if (e.case_date) rows.push({ label: "OBSERVATION DATE", val: new Date(e.case_date).toLocaleDateString() });
    if (e.identifierType) rows.push({ label: "IDENTIFIER CLASS", val: e.identifierType.toUpperCase() });

    rows.forEach(r => {
      const item = document.createElement("div");
      item.className = "metadataItem";
      item.innerHTML = `<span class="metadataLabel">${r.label}</span><span class="metadataValue">${r.val}</span>`;
      metaContainer.appendChild(item);
    });
  }

  const evidence = $("#entityEvidence");
  if (evidence) {
    evidence.replaceChildren();
    const related = (state.network?.edgeDetails || []).filter(edge => edge.source === e.id || edge.target === e.id);
    if ($("#connectedCountBadge")) $("#connectedCountBadge").textContent = related.length;

    related.slice(0, 80).forEach(edge => {
      const otherId = edge.source === e.id ? edge.target : edge.source;
      const other = state.network.entities.find(entity => entity.id === otherId);
      const item = document.createElement("div");
      item.className = "entityEvidenceItem";

      const left = document.createElement("div");
      left.className = "evidenceLeft";
      const name = document.createElement("span");
      name.className = "evidenceTargetName";
      name.textContent = other?.name || otherId;

      const badge = document.createElement("span");
      badge.className = "evidenceRelBadge";
      badge.textContent = edge.relationship;

      left.append(name, badge);
      if (edge.identifierHint) {
        const hint = document.createElement("small");
        hint.style.display = "block";
        hint.style.color = "var(--muted)";
        hint.style.font = "9px var(--mono)";
        hint.textContent = edge.identifierHint;
        left.appendChild(hint);
      }

      const jump = document.createElement("button");
      jump.className = "jumpBtn";
      jump.textContent = "Focus";
      jump.title = `Focus ${other?.name || otherId}`;
      jump.onclick = evt => {
        evt.stopPropagation();
        applyGraphView("focus", otherId, { zoom: true });
      };

      item.append(left, jump);
      evidence.appendChild(item);
    });

    if (!related.length) {
      const empty = document.createElement("small");
      empty.textContent = "No verified direct associations recorded.";
      empty.style.color = "var(--muted)";
      evidence.appendChild(empty);
    }
  }
}

async function loadNetwork() {
  if (!state.network) state.network = await api("/api/network");
  renderGraph(state.network);
}

function setupSearch() {
  const input = $("#graphSearch");
  const clearBtn = $("#clearSearch");
  const dropdown = $("#searchDropdown");
  if (!input || !dropdown) return;

  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      if (clearBtn) clearBtn.style.display = "none";
      dropdown.style.display = "none";
      applyGraphView(graphFocus ? "focus" : "all", selectedEntityId);
      return;
    }
    if (clearBtn) clearBtn.style.display = "block";
    if (!state.network?.entities) return;

    const matches = state.network.entities.filter(e =>
      `${e.name} ${e.id} ${e.type} ${e.occupation || ""} ${e.city || ""} ${e.state || ""} ${e.location || ""}`.toLowerCase().includes(q)
    ).slice(0, 8);

    dropdown.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "searchResultItem";
      empty.innerHTML = `<span class="searchResultMeta">No records match criteria</span>`;
      dropdown.appendChild(empty);
    } else {
      matches.forEach(m => {
        const item = document.createElement("div");
        item.className = "searchResultItem";
        const color = getNodeColor(m);
        const tag = m.occupation ? m.occupation.toUpperCase() : m.type === "incident" ? "CASE" : m.type === "identifier" ? "ID" : "PERSON";
        const metaLine = m.occupation
          ? `${m.id} · ${m.occupation} · ${m.city ? `${m.city} · ` : ""}${m.links || 0} links`
          : `${m.id} · ${m.links || 0} links`;
        item.innerHTML = `
          <div class="searchResultIcon" style="border-color: ${color}; color: ${color};">${m.type === "incident" ? "CASE" : m.type === "identifier" ? "ID" : "PERSON"}</div>
          <div class="searchResultInfo">
            <div class="searchResultTitle">${m.name}</div>
            <div class="searchResultMeta">${metaLine}</div>
          </div>
          <span class="searchResultBadge" style="color: ${color}; border-color: ${color}; background: rgba(255,255,255,0.06);">${tag}</span>
        `;
        item.onclick = () => {
          input.value = m.name;
          dropdown.style.display = "none";
          applyGraphView("focus", m.id, { zoom: true });
        };
        dropdown.appendChild(item);
      });
    }
    dropdown.style.display = "block";
  };

  input.onkeydown = e => {
    if (e.key === "Enter") {
      const first = dropdown.querySelector(".searchResultItem");
      if (first) first.click();
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  };

  if (clearBtn) {
    clearBtn.onclick = () => {
      input.value = "";
      clearBtn.style.display = "none";
      dropdown.style.display = "none";
      applyGraphView(graphFocus ? "focus" : "all", selectedEntityId);
    };
  }

  document.addEventListener("click", e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
    }
  });
}

function setupFilterChips() {
  $$(".filterChip").forEach(chip => {
    chip.onclick = () => {
      $$(".filterChip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeTypeFilter = chip.dataset.type;
      graphRenderer?.refresh();
      updateHudStats();
    };
  });
}

function updateFilterCounts() {
  if (!state.network?.entities) return;
  const ents = state.network.entities;
  if ($("#chipAllCount")) $("#chipAllCount").textContent = ents.length;
  if ($("#chipPersonCount")) $("#chipPersonCount").textContent = ents.filter(e => e.type !== "incident" && e.type !== "identifier").length;
  if ($("#chipIncidentCount")) $("#chipIncidentCount").textContent = ents.filter(e => e.type === "incident").length;
  if ($("#chipIdentifierCount")) $("#chipIdentifierCount").textContent = ents.filter(e => e.type === "identifier").length;
  if ($("#chipHubCount")) $("#chipHubCount").textContent = ents.filter(e => (e.links || 0) >= 3).length;
}

// Button Listeners
$("#modeFocus")?.addEventListener("click", () => {
  if (graphModel) {
    applyGraphView("focus", selectedEntityId, { zoom: true });
    toast("Target associations view active");
  }
});

$("#modeAll")?.addEventListener("click", () => {
  if (graphModel) {
    applyGraphView("all", selectedEntityId, { zoom: false });
    fitVisibleGraph(250);
    toast("Complete network topology active");
  }
});

$("#toggleInspector")?.addEventListener("click", () => {
  const container = $("#networkContainer");
  if (!container) return;
  container.classList.toggle("collapsedInspector");
  setTimeout(() => fitVisibleGraph(150), 180);
});

$("#graphFullscreen")?.addEventListener("click", () => {
  const container = $("#networkContainer");
  if (!container) return;
  const isFull = container.classList.toggle("fullscreenMode");
  $("#graphFullscreen").textContent = isFull ? "Exit Fullscreen" : "Fullscreen";
  toast(isFull ? "Fullscreen view enabled" : "Fullscreen view exited");
  setTimeout(() => fitVisibleGraph(150), 200);
});

$("#graphZoomIn")?.addEventListener("click", () => graphRenderer?.getCamera().animatedZoom({ factor: 1.4, duration: 160 }));
$("#graphZoomOut")?.addEventListener("click", () => graphRenderer?.getCamera().animatedUnzoom({ factor: 1.4, duration: 160 }));
$("#graphFit")?.addEventListener("click", () => fitVisibleGraph(260));
$("#graphCenterSelected")?.addEventListener("click", () => {
  if (selectedEntityId) centerOnNode(selectedEntityId, { ratio: 0.72, duration: 260 });
  else fitVisibleGraph(260);
});
$("#graphLayout")?.addEventListener("click", () => layoutGraph());

$("#dossierId")?.addEventListener("click", () => {
  if (!selectedEntityId) return;
  navigator.clipboard.writeText(selectedEntityId).then(() => {
    toast(`Record ID ${selectedEntityId} copied to clipboard`);
  }).catch(() => toast(`Record ID: ${selectedEntityId}`));
});

$("#trace")?.addEventListener("click", () => {
  if (!selectedEntityId) return toast("Select a record first");
  $("#graphSearch").value = "";
  applyGraphView("focus", selectedEntityId, { zoom: true });
  toast("Target direct links isolated");
});

$("#btnMatchFromInspector")?.addEventListener("click", () => {
  $("#addRelationship")?.click();
});

// JSON Export
$("#exportJsonBtn")?.addEventListener("click", () => {
  if (!state.network) return toast("No graph data to export");
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.network, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `nexora_network_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  toast("Network JSON exported");
});

// Cases & Ledger
async function loadCases() {
  if (!state.cases) state.cases = await api("/api/cases");
  const rows = $("#caseRows");
  rows.replaceChildren();
  state.cases.incidents.forEach(incident => {
    const row = document.createElement("tr");
    const values = [incident.id, incident.category, incident.location, new Date(incident.observedAt).toLocaleDateString(), incident.caseNumber, incident.linkedEntities];
    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value ?? "—";
      row.appendChild(cell);
    });
    rows.appendChild(row);
  });
}

async function loadLedger() {
  if (!state.ledger) state.ledger = await api("/api/ledger");
  $("#chain").textContent = state.ledger.valid ? "CHAIN VALID · SHA-256 INTEGRITY VERIFIED" : "CHAIN INTEGRITY COMPROMISED";
  $("#blocks").innerHTML = state.ledger.blocks.slice().reverse().map(b => `<div class="block"><b>#${b.index}</b><code>${b.hash}</code><small>${new Date(b.timestamp).toLocaleTimeString()}</small></div>`).join("");
}

async function load(id) {
  try {
    if (id === "sentinel") await loadSentinel();
    if (id === "network") await loadNetwork();
    if (id === "cases") await loadCases();
    if (id === "ledger") await loadLedger();
  } catch (e) {
    console.error(e);
    toast(e.message || "Backend unavailable");
  }
}

$("#refresh").onclick = () => {
  state = {};
  load($(".page.active").id);
  toast("Dataset refreshed");
};

$("#verify").onclick = async () => {
  const d = await api("/api/ledger/verify", { method: "POST" });
  toast(d.valid ? "Evidence ledger verified" : "Verification check failed");
  state.ledger = null;
  loadLedger();
};

// Modal Dialogs
const relationshipDialog = $("#relationshipDialog"), relationshipForm = $("#relationshipForm");
function closeRelationshipDialog() { relationshipDialog.close(); }
relationshipDialog.addEventListener("click", event => { if (event.target === relationshipDialog) closeRelationshipDialog(); });
$("#addRelationship").onclick = async () => {
  try {
    if (!state.network) state.network = await api("/api/network");
    const select = $("#identifierRecord");
    select.replaceChildren(...state.network.entities.filter(entity => entity.type !== "identifier").map(entity => {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = `${entity.name} · ${entity.id}`;
      return option;
    }));
    if (selectedEntityId) select.value = selectedEntityId;
    relationshipDialog.showModal();
  } catch (error) {
    toast(error.message || "Could not load network records");
  }
};
$("#closeRelationshipDialog").onclick = closeRelationshipDialog;
$("#cancelRelationship").onclick = closeRelationshipDialog;
relationshipForm.onsubmit = async event => {
  event.preventDefault();
  const submit = $("#saveRelationship");
  submit.disabled = true;
  submit.textContent = "Processing…";
  try {
    const details = Object.fromEntries(new FormData(relationshipForm));
    const result = await api("/api/network/identifiers", { method: "POST", body: JSON.stringify(details) });
    closeRelationshipDialog();
    relationshipForm.reset();
    state.network = null;
    await loadNetwork();
    toast(`${result.matches} matching record${result.matches === 1 ? "" : "s"} identified`);
  } catch (error) {
    toast(error.message || "Identifier could not be saved");
  } finally {
    submit.disabled = false;
    submit.textContent = "Find matches";
  }
};

const entityDialog = $("#entityDialog"), entityForm = $("#entityForm");
function closeEntityDialog() { entityDialog.close(); }
entityDialog.addEventListener("click", event => { if (event.target === entityDialog) closeEntityDialog(); });
$("#addEntity").onclick = () => entityDialog.showModal();
$("#closeEntityDialog").onclick = closeEntityDialog;
$("#cancelEntity").onclick = closeEntityDialog;
entityForm.onsubmit = async event => {
  event.preventDefault();
  const submit = $("#saveEntity");
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const details = Object.fromEntries(new FormData(entityForm));
    await api("/api/entities", { method: "POST", body: JSON.stringify(details) });
    closeEntityDialog();
    entityForm.reset();
    state.network = null;
    await loadNetwork();
    toast("Record added to network");
  } catch (error) {
    toast(error.message || "Record could not be saved");
  } finally {
    submit.disabled = false;
    submit.textContent = "Save record";
  }
};

const caseDialog = $("#caseDialog"), caseForm = $("#caseForm");
function closeCaseDialog() { caseDialog.close(); }
caseDialog.addEventListener("click", event => { if (event.target === caseDialog) closeCaseDialog(); });
$("#newCase").onclick = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#caseDate").value = date;
  caseDialog.showModal();
  $("#caseType").focus();
};
$("#closeCaseDialog").onclick = closeCaseDialog;
$("#cancelCase").onclick = closeCaseDialog;
caseForm.onsubmit = async event => {
  event.preventDefault();
  const submit = $("#saveCase");
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const details = Object.fromEntries(new FormData(caseForm));
    await api("/api/cases", { method: "POST", body: JSON.stringify(details) });
    closeCaseDialog();
    caseForm.reset();
    state.cases = null;
    state.network = null;
    await loadCases();
    toast("Incident added to network");
  } catch (error) {
    toast(error.message || "Incident could not be saved");
  } finally {
    submit.disabled = false;
    submit.textContent = "Save incident";
  }
};

$(".user").onclick = () => toast("Investigator profile active");

setupSearch();
setupFilterChips();
load("network");

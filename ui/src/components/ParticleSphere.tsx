import { useEffect, useRef } from 'react';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from 'd3-force';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

interface Node extends SimulationNodeDatum {
  id: number;
  degree: number;
  size: number;
  isHub: boolean;
}

// d3-force replaces the numeric ids with Node references when the simulation starts
interface Link extends SimulationLinkDatum<Node> {
  source: number | Node;
  target: number | Node;
}

export function ParticleSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId = 0;

    const N = 400;
    const nodes: Node[] = [];
    const links: Link[] = [];

    // Seed
    nodes.push({ id: 0, degree: 0, size: 1, isHub: false });
    nodes.push({ id: 1, degree: 0, size: 1, isHub: false });
    links.push({ source: 0, target: 1 });

    // Mark hub nodes (10%) — pre-decide which indices become hubs for consistent distribution
    const hubSet = new Set<number>();
    while (hubSet.size < Math.floor(N * 0.12)) hubSet.add(Math.floor(Math.random() * N));
    for (const id of hubSet) if (id < 2) hubSet.delete(id);

    for (let i = 2; i < N; i++) {
      const isHub = hubSet.has(i);
      const node: Node = {
        id: i,
        degree: 0,
        size: isHub ? 2 + Math.random() * 2.5 : 0.8 + Math.random() * 1.2,
        isHub,
      };
      const conns = 3 + Math.floor(Math.random() * (isHub ? 5 : 3));
      const totalDeg = nodes.reduce((s, n) => s + n.degree, 0);
      const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
      let added = 0;
      for (const candidate of sorted) {
        if (added >= conns) break;
        const prob = totalDeg > 0 ? candidate.degree / totalDeg : 0.5;
        if (Math.random() < prob * 5 || candidate.degree < 2) {
          links.push({ source: i, target: candidate.id });
          node.degree++;
          candidate.degree++;
          added++;
        }
      }
      if (added === 0) {
        const rand = nodes[Math.floor(Math.random() * nodes.length)];
        links.push({ source: i, target: rand.id });
        node.degree++;
        rand.degree++;
      }
      nodes.push(node);
    }

    // Final degree counts
    for (const n of nodes) n.degree = 0;
    for (const l of links) {
      const s = typeof l.source === 'number' ? l.source : l.source.id;
      const t = typeof l.target === 'number' ? l.target : l.target.id;
      const sn = nodes.find(n => n.id === s); if (sn) sn.degree++;
      const tn = nodes.find(n => n.id === t); if (tn) tn.degree++;
    }
    const maxDeg = Math.max(...nodes.map(n => n.degree));
    for (const n of nodes) n.degree = Math.max(1, n.degree);

    let dpr = 1;
    let W = 0, H = 0;

    function readContainerSize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { w: 600, h: 400 };
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    }

    function centerY() { return H * (window.innerWidth < 768 ? 0.50 : 0.48); }

    function updateSimulationCenter() {
      const cy = centerY();
      simulation
        .force('center', forceCenter(W / 2, cy))
        .force('x', forceX(W / 2).strength(0.02))
        .force('y', forceY(cy).strength(0.02));
      simulation.alpha(0.3).restart();
    }

    function createSimulation() {
      const cy = centerY();
      const sim = forceSimulation<Node>(nodes)
        .force('charge', forceManyBody<Node>().strength(-12))
        .force('link', forceLink<Node, Link>(links).distance(d => {
          const src = typeof d.source === 'number' ? d.source : d.source.id;
          const tgt = typeof d.target === 'number' ? d.target : d.target.id;
          const sd = nodes.find(n => n.id === src)?.degree || 1;
          const td = nodes.find(n => n.id === tgt)?.degree || 1;
          return 10 + 12 / Math.min(sd, td);
        }).strength(0.25))
        .force('center', forceCenter(W / 2, cy).strength(0.06))
        .force('collide', forceCollide<Node>(d => 1.5 + d.degree / maxDeg * 3))
        .force('x', forceX(W / 2).strength(0.015))
        .force('y', forceY(cy).strength(0.015))
        .alphaDecay(0.006)
        .velocityDecay(0.3)
        // alphaTarget > 0: la sim nunca se asienta del todo → deriva orgánica perpetua
        .alphaTarget(0.03);
      return sim;
    }

    let simulation = createSimulation();

    function resize() {
      const s = readContainerSize();
      W = s.w; H = s.h;
      // Cap DPR: en móvil el backing store a 3x + shadowBlur por nodo estrangula el
      // framerate de iOS hasta congelar la animación. 1.5x móvil / 2x desktop basta.
      const dprCap = window.innerWidth < 768 ? 1.5 : 2;
      dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateSimulationCenter();
    }

    resize();
    let reheatTimer = 0;
    let pulseAmp = 0;
    let lastPulseHit = 0;
    let punch = 0;
    // Escala de render: expande el cúmulo d3 (compacto) para llenar el contenedor.
    let renderScale = 1;

    function draw() {
      if (W === 0 || H === 0) { animId = requestAnimationFrame(draw); return; }
      ctx!.clearRect(0, 0, W, H);

      const hue = getComputedStyle(document.documentElement).getPropertyValue('--accent-hue').trim() || '0';
      const activity = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--activity')
      ) || 0;
      pulseAmp += (activity - pulseAmp) * 0.12;
      const hit = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--pulse-hit').trim()
      ) || 0;
      if (hit !== lastPulseHit) { punch = 1; lastPulseHit = hit; }
      punch *= 0.88;
      const t = performance.now() / 1000;
      const pulseBase = Math.sin(t * 4) * 0.7 + Math.sin(t * 8) * 0.3;
      // Ambient: respiración constante en reposo (sin voz/tokens el grafo no debe congelarse)
      const AMBIENT = 0.14;
      const pulse = (AMBIENT + pulseAmp) * pulseBase + punch * 0.5;
      const cx = W / 2;
      const cy = centerY();
      const maxDim = Math.min(W, H);

      // Expansión radial NO lineal: el núcleo denso se abre más que el halo, la malla
      // queda uniforme llenando el contenedor (estilo referencia).
      const radii: number[] = [];
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue;
        radii.push(Math.hypot(n.x - cx, n.y - cy));
      }
      radii.sort((a, b) => a - b);
      const rawRef = Math.max(1, radii[Math.floor(radii.length * 0.97)] || 1);
      // renderScale reutilizado como radio de referencia suavizado (anti-jitter)
      if (renderScale === 1) renderScale = rawRef;
      renderScale += (rawRef - renderScale) * 0.05;
      const refR = renderScale;
      const targetR = maxDim * 0.52;
      const POW = 0.62; // <1 = expande el centro más que la periferia
      const mapPoint = (x: number, y: number): [number, number] => {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) return [x, y];
        const norm = Math.min(1.4, d / refR);
        const nd = targetR * Math.pow(norm, POW);
        const f = nd / d;
        return [cx + dx * f, cy + dy * f];
      };
      // Factor de expansión típico del núcleo (norm≈0.3) para engordar nodos/links
      const coreExpand = (targetR * Math.pow(0.3, POW)) / (refR * 0.3);
      const sizeBoost = Math.max(1, Math.min(2.4, 1 + (coreExpand - 1) * 0.35));

      // Massive background glow
      const bgBoost = 1 + pulseAmp * 0.5;
      const bgGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.78);
      bgGrad.addColorStop(0, `hsla(${hue}, 60%, 55%, ${0.14 * bgBoost})`);
      bgGrad.addColorStop(0.4, `hsla(${hue}, 55%, 45%, ${0.07 * bgBoost})`);
      bgGrad.addColorStop(0.7, `hsla(${hue}, 50%, 35%, ${0.03 * bgBoost})`);
      bgGrad.addColorStop(1, 'transparent');
      ctx!.fillStyle = bgGrad;
      ctx!.fillRect(0, 0, W, H);

      // Links — draw as thin translucent mesh
      ctx!.lineWidth = 0.6 * Math.min(2, sizeBoost);
      for (const link of links) {
        const s = link.source as unknown as Node;
        const t = link.target as unknown as Node;
        if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) continue;
        const [sx2, sy2] = mapPoint(s.x, s.y);
        const [tx2, ty2] = mapPoint(t.x, t.y);
        const dist = Math.hypot(sx2 - tx2, sy2 - ty2) + 1;
        const alpha = Math.min(0.45, (8 * sizeBoost) / dist);
        ctx!.beginPath();
        ctx!.moveTo(sx2, sy2);
        ctx!.lineTo(tx2, ty2);
        ctx!.strokeStyle = `hsla(${hue}, 50%, 60%, ${alpha})`;
        ctx!.stroke();
      }

      // Nodes
      const avgSize = nodes.reduce((s, n) => s + n.size, 0) / nodes.length;
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const r = node.size * sizeBoost * (1 + pulse * 0.75);
        const [sxp, syp] = mapPoint(node.x, node.y);
        const distFromCenter = (Math.abs(sxp - cx) + Math.abs(syp - cy)) / maxDim;
        const depth = Math.max(0.15, 1 - distFromCenter * 1.1);
        const alpha = depth * 0.85;
        const dist = Math.hypot(sxp - cx, syp - cy);
        const ripple = 1 - Math.min(1, dist / (maxDim * 0.5));
        const push = pulse * 6 * (0.2 + ripple * 0.8);
        const angle = Math.atan2(syp - cy, sxp - cx);
        const shimmer = ((node.id * 7.3 + 13.7) % 1) * 2 - 1;
        const px = sxp + Math.cos(angle + shimmer * 0.15) * push;
        const py = syp + Math.sin(angle + shimmer * 0.15) * push;

        // Core glow — hubs get massive glow
        const glow = 1 + pulse * 1.0;
        if (node.isHub) {
          ctx!.shadowColor = `hsla(${hue}, 80%, 70%, ${0.6 * glow})`;
          ctx!.shadowBlur = 24 * glow;
        } else if (node.size > avgSize * 1.3) {
          ctx!.shadowColor = `hsla(${hue}, 70%, 60%, ${0.35 * glow})`;
          ctx!.shadowBlur = 14 * glow;
        } else {
          ctx!.shadowColor = `hsla(${hue}, 60%, 55%, ${(0.15 + depth * 0.25) * glow})`;
          ctx!.shadowBlur = (6 + depth * 8) * glow;
        }

        ctx!.beginPath();
        ctx!.arc(px, py, r, 0, Math.PI * 2);
        ctx!.fillStyle = node.isHub
          ? `hsla(${hue}, 85%, 80%, ${alpha})`
          : `hsla(${hue}, 70%, 72%, ${alpha})`;
        ctx!.fill();
        ctx!.shadowBlur = 0;
      }

      reheatTimer++;
      const reheatThreshold = activity > 0 ? 40 : 180;
      if (reheatTimer > reheatThreshold) {
        reheatTimer = 0;
        simulation.alpha(activity > 0 ? 0.12 : 0.05).restart();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    const appEl = canvas.closest('.app-container');
    const headerEl = appEl?.querySelector('header');
    const headerRo = headerEl ? new ResizeObserver(() => resize()) : null;
    if (headerEl && headerRo) headerRo.observe(headerEl);

    return () => {
      cancelAnimationFrame(animId);
      simulation.stop();
      ro.disconnect();
      if (headerRo) headerRo.disconnect();
    };
  }, []);

  // Desktop: fixed a viewport completo — los nodos viajan también detrás de los
  // sidebars (transparentes) en vez de cortarse en el borde de la columna central.
  // Móvil: absolute dentro de .graph-zone, ancla el grafo a su sección de la
  // página para que scrollee con el contenido. Posicionamiento en .particle-canvas.
  return <canvas ref={canvasRef} className="particle-canvas" style={{ pointerEvents: 'none' }} />;
}

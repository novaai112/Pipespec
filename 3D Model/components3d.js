/* Pipespec 3D component builders (units: mm, pipe axis = Y, like the flange viewer).
   Usage: const group = Pipespec3D.build(config, material);  config.kind === 'component'.
   Currently: ASME B16.9 butt-weld fittings Ftbw1..Ftbw11,
   non-metallic flat gaskets Gflt1..3 (ASME B16.21) and spiral-wound gaskets Gspr1..3 (ASME B16.20). */
(function (global) {
  'use strict';
  const T = global.THREE;
  const SEG = 64;

  // Hollow revolved solid from [r, y] profile pairs (closed loop, outer->inner).
  function lathe(points, mat, x0) {
    const g = new T.LatheGeometry(points.map(p => new T.Vector2(p[0], p[1])), SEG);
    const m = new T.Mesh(g, mat);
    m.material = mat.clone(); m.material.side = T.DoubleSide;
    return m;
  }

  // Straight hollow tube from y0 to y1.
  function tube(ro, wall, y0, y1, mat) {
    const ri = Math.max(ro - wall, 0.1);
    return lathe([[ri, y0], [ro, y0], [ro, y1], [ri, y1], [ri, y0]], mat);
  }

  // Hollow pipe bend: axis of bend centre at origin, sweeps angleDeg in XY plane.
  function bend(ro, wall, R, angleDeg, mat) {
    const ri = Math.max(ro - wall, 0.1), a = angleDeg * Math.PI / 180;
    const g = new T.Group();
    const outer = new T.Mesh(new T.TorusGeometry(R, ro, 32, 96, a), mat);
    const inner = new T.Mesh(new T.TorusGeometry(R, ri, 32, 96, a), mat.clone());
    inner.material.side = T.BackSide;
    g.add(outer, inner);
    [0, a].forEach(t => {
      const ring = new T.Mesh(new T.RingGeometry(ri, ro, 48), mat.clone());
      ring.material.side = T.DoubleSide;
      ring.position.set(R * Math.cos(t), R * Math.sin(t), 0);
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(-Math.sin(t), Math.cos(t), 0));
      g.add(ring);
    });
    return g;
  }


  // ---------- Gasket helpers (flat discs, axis = Y, bottom face at y = y0) ----------
  // Flat annulus with true sharp edges (extruded shape with a hole).
  function annulus(rIn, rOut, y0, thick, mat) {
    const s = new T.Shape();
    s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (rIn > 0) {
      const h = new T.Path();
      h.absarc(0, 0, rIn, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
    const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: SEG * 2 });
    geo.rotateX(-Math.PI / 2);          // extrusion axis z -> y
    geo.translate(0, y0, 0);
    return new T.Mesh(geo, mat);
  }

  // Non-metal material that still follows the viewer's section planes / wireframe mode.
  function softMat(color, rough, base) {
    return new T.MeshStandardMaterial({
      color: color, roughness: rough, metalness: 0, side: T.DoubleSide,
      clippingPlanes: base && base.clippingPlanes ? base.clippingPlanes : null,
      wireframe: !!(base && base.wireframe)
    });
  }
  function metalMat(base) {
    const m = base.clone(); m.side = T.DoubleSide; return m;
  }
  function need(cfg, keys) {
    keys.forEach(k => {
      if (!(Number(cfg[k]) > 0)) throw new Error('Gasket 3D model needs a positive "' + k + '" value.');
    });
  }

  // ASME B16.21 non-metallic flat ring gasket: ID, OD, thickness.
  function flatGasket(cfg, mat) {
    need(cfg, ['id', 'od', 'thickness']);
    if (!(cfg.id < cfg.od)) throw new Error('Flat gasket ID must be smaller than OD.');
    const g = new T.Group();
    g.add(annulus(cfg.id / 2, cfg.od / 2, 0, cfg.thickness, softMat(0xd4cdb8, 0.92, mat)));
    return g;
  }

  // ASME B16.20 spiral-wound gasket: inner ring, winding (steel strip + filler), centring ring.
  // d1 inner-ring ID, d2 winding ID, d3 winding OD, d4 centring-ring OD, thk winding thickness.
  function spiralGasket(cfg, mat) {
    need(cfg, ['d1', 'd2', 'd3', 'd4', 'thk']);
    if (!(cfg.d1 < cfg.d2 && cfg.d2 < cfg.d3 && cfg.d3 < cfg.d4)) {
      throw new Error('Spiral-wound gasket diameters must increase d1 < d2 < d3 < d4.');
    }
    const g = new T.Group();
    const thk = cfg.thk;
    const ringT = Math.min(cfg.ringThk > 0 ? cfg.ringThk : 3.2, thk * 0.95);
    const ringY = (thk - ringT) / 2;
    const metal = metalMat(mat);
    const r1 = cfg.d1 / 2, r2 = cfg.d2 / 2, r3 = cfg.d3 / 2, r4 = cfg.d4 / 2;

    g.add(annulus(r1, r2, ringY, ringT, metal));                  // inner ring
    g.add(annulus(r3, r4, ringY, ringT, metal.clone()));           // centring (outer) ring

    // Winding: alternating stainless strip and graphite filler across the sealing width.
    const w = r3 - r2;
    const n = Math.max(2, Math.round(w / 1.6));
    const per = w / n;
    const steel = new T.MeshStandardMaterial({
      color: 0xe3e7ec, metalness: 0.9, roughness: 0.28, side: T.DoubleSide,
      clippingPlanes: mat.clippingPlanes || null, wireframe: !!mat.wireframe
    });
    const filler = softMat(0x34373c, 0.85, mat);
    for (let k = 0; k < n; k++) {
      const a = r2 + k * per;
      g.add(annulus(a, a + per * 0.6, 0, thk, filler));
      g.add(annulus(a + per * 0.6, a + per, 0, thk, steel));
    }
    return g;
  }

  function build(cfg, mat) {
    mat = mat || new T.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.85, roughness: 0.35 });
    const t = cfg.type;
    if (/^gflt\d/.test(t)) return flatGasket(cfg, mat);
    if (/^gspr\d/.test(t)) return spiralGasket(cfg, mat);
    const g = new T.Group();
    const ro = cfg.od / 2, w = cfg.wall;

    if (t === 'ftbw1' || t === 'ftbw2' || t === 'ftbw4') {
      const ang = t === 'ftbw1' ? 45 : 90;
      const R = cfg.ctrEnd / (ang === 90 ? 1 : Math.tan(ang * Math.PI / 360));
      // Bend centred at (R,0): inlet at origin pointing +Y.
      const b = bend(ro, w, R, ang, mat);
      b.position.set(R, 0, 0); b.rotation.y = Math.PI;
      g.add(b);
    } else if (t === 'ftbw3' || t === 'ftbw5') {
      const R = cfg.ctrEnd; // return: 180deg, centre-to-centre = 2R
      const b = bend(ro, w, R, 180, mat);
      b.position.set(R, 0, 0); b.rotation.y = Math.PI;
      g.add(b);
    } else if (t === 'ftbw6' || t === 'ftbw7') {
      const c = cfg.ctrEnd, m = cfg.branch || cfg.ctrEnd;
      const bro = (cfg.smallOd || cfg.od) / 2, bw = cfg.smallWall || w;
      const run = tube(ro, w, -c, c, mat); run.rotation.z = Math.PI / 2;
      const br = tube(bro, bw, 0, m, mat);
      g.add(run, br);
      // Blend ring where branch meets run
      const ring = new T.Mesh(new T.TorusGeometry(bro + (ro - bro) * 0.15, ro * 0.04, 8, 48), mat);
      ring.rotation.x = Math.PI / 2; ring.position.y = ro * 0.7; g.add(ring);
    } else if (t === 'ftbw8') {
      // 2:1 elliptical cap, overall length E; straight section = E - 0.25*OD.
      const E = cfg.capLength, ri = ro - w, dome = ro * 0.5, straight = Math.max(E - dome, 0);
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI / 2;
        pts.push([ro * Math.cos(a), straight + dome * Math.sin(a)]);
      }
      for (let i = 24; i >= 0; i--) {
        const a = (i / 24) * Math.PI / 2;
        pts.push([ri * Math.cos(a), straight + (dome - w) * Math.sin(a)]);
      }
      pts.unshift([ri, 0], [ro, 0]);
      const cap = lathe(pts.slice(1).concat([pts[0]]), mat); g.add(cap);
    } else if (t === 'ftbw9' || t === 'ftbw10') {
      const L = cfg.length, sro = cfg.smallOd / 2, sw = cfg.smallWall || w;
      const pts = [[ro - w, 0], [ro, 0], [sro, L], [sro - sw, L], [ro - w, 0]];
      const red = lathe(pts, mat);
      if (t === 'ftbw10') {
        const off = (ro - sro), pos = red.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + off * (pos.getY(i) / L));
        pos.needsUpdate = true; red.geometry.computeVertexNormals();
      }
      g.add(red);
    } else if (t === 'ftbw11') {
      const L = cfg.stubLength, collar = cfg.collarOd / 2, lap = Math.max(w, 3);
      const pts = [[ro - w, 0], [collar, 0], [collar, lap], [ro, lap + (cfg.radius || 6)],
                   [ro, L], [ro - w, L], [ro - w, 0]];
      g.add(lathe(pts, mat));
    } else {
      throw new Error('No 3D builder for ' + t);
    }
    return g;
  }

  global.Pipespec3D = { build };
})(window);

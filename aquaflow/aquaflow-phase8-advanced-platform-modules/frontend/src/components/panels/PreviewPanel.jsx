import { useEffect, useRef, useState } from "react";
import { useShowStore } from "../../store/showStore";

export default function PreviewPanel() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { playbackState, playhead, timelineTracks } = useShowStore();

  useEffect(() => {
    if (!mountRef.current) return;
    let animId;
    let THREE, renderer, scene, camera, clock;
    let jets = [], lights = [];
    let pGeo, pMat, velocities, ages, lifetimes;
    const PARTICLE_COUNT = 1200;

    const resetParticle = (i, positions, pumpIntensity) => {
      const idx = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 3.5 * pumpIntensity;
      positions[idx]     = Math.cos(angle) * r * 0.4;
      positions[idx + 1] = 0.4 + Math.random() * (pumpIntensity * 6 + 0.5);
      positions[idx + 2] = Math.sin(angle) * r * 0.4;
      const speed = (2 + Math.random() * 4) * Math.max(0.3, pumpIntensity);
      velocities[idx]     = (Math.random() - 0.5) * 0.6;
      velocities[idx + 1] = speed;
      velocities[idx + 2] = (Math.random() - 0.5) * 0.6;
      ages[i] = 0;
      lifetimes[i] = 0.5 + Math.random() * 1.2;
    };

    const getTrackIntensity = (tracks, type, ph) => {
      if (!tracks || !tracks.length) return 0;
      const matchingTracks = tracks.filter((t) => t.type === type);
      if (!matchingTracks.length) return 0;
      let max = 0;
      for (const track of matchingTracks) {
        const clip = track.clips?.find((c) => c.start <= ph && ph < c.end);
        if (clip) max = Math.max(max, clip.intensity / 100);
      }
      return max;
    };

    const init = async () => {
      try {
        THREE = await import("three");
        setLoading(false);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        mountRef.current.appendChild(renderer.domElement);

        const resize = () => {
          if (!mountRef.current) return;
          renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
          camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", resize);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050807);
        scene.fog = new THREE.FogExp2(0x050807, 0.015);

        camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
        camera.position.set(10, 7, 13);
        camera.lookAt(0, 3, 0);
        clock = new THREE.Clock();
        resize();

        // Lighting — gold-tinted
        scene.add(new THREE.AmbientLight(0x0a1f10, 1.0));
        const sun = new THREE.DirectionalLight(0xffeedd, 0.5);
        sun.position.set(10, 20, 10);
        scene.add(sun);

        // Accent lights — gold and green
        const lightColors = [0xc9a227, 0x1a6b3a, 0xd4ac3a, 0x0f4a2e];
        lightColors.forEach((color, i) => {
          const a = (i / 4) * Math.PI * 2;
          const l = new THREE.PointLight(color, 2, 16);
          l.position.set(Math.cos(a) * 4.5, 2, Math.sin(a) * 4.5);
          scene.add(l);
          lights.push(l);
        });

        // Ground
        const g = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
          new THREE.MeshStandardMaterial({ color: 0x080c14, roughness: 0.95 }));
        g.rotation.x = -Math.PI / 2; scene.add(g);
        scene.add(new THREE.GridHelper(40, 40, 0x0f1624, 0x0f1624));

        // Pool
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.35, 64),
          new THREE.MeshStandardMaterial({ color: 0x0a2a14, roughness: 0.2, metalness: 0.7 }));
        pool.position.y = 0.17; scene.add(pool);

        const rim = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.18, 8, 64),
          new THREE.MeshStandardMaterial({ color: 0x8a6a1a, metalness: 0.9, roughness: 0.1 }));
        rim.rotation.x = Math.PI / 2; rim.position.y = 0.34; scene.add(rim);

        const water = new THREE.Mesh(new THREE.CircleGeometry(5.0, 64),
          new THREE.MeshStandardMaterial({ color: 0x082a15, roughness: 0.0, metalness: 0.3, transparent: true, opacity: 0.9 }));
        water.rotation.x = -Math.PI / 2; water.position.y = 0.35; scene.add(water);

        // Jets — built at unit height=1, scaled in animate loop
        const JET_CONFIGS = [
          { x: 0,    z: 0,    maxH: 9,  r: 0.10, color: 0xc9a227, speed: 1.2, phase: 0,   priority: 1.0 },
          { x: 1.5,  z: 0,    maxH: 6,  r: 0.07, color: 0xd4ac3a, speed: 1.0, phase: 0.5, priority: 0.85 },
          { x: -1.5, z: 0,    maxH: 6,  r: 0.07, color: 0xd4ac3a, speed: 1.0, phase: 1.0, priority: 0.85 },
          { x: 0,    z: 1.5,  maxH: 6,  r: 0.07, color: 0xd4ac3a, speed: 1.0, phase: 1.5, priority: 0.85 },
          { x: 0,    z: -1.5, maxH: 6,  r: 0.07, color: 0xd4ac3a, speed: 1.0, phase: 2.0, priority: 0.85 },
          ...Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return { x: Math.cos(a) * 3.5, z: Math.sin(a) * 3.5, maxH: 4, r: 0.055, color: 0xa88018, speed: 0.8, phase: i * 0.4, priority: 0.7 };
          }),
        ];

        JET_CONFIGS.forEach((cfg) => {
          // Build jet at height=1, scale it in animate
          const jet = new THREE.Mesh(
            new THREE.CylinderGeometry(cfg.r * 0.2, cfg.r, 1, 8, 1, true),
            new THREE.MeshStandardMaterial({ color: cfg.color, transparent: true, opacity: 0.8, emissive: cfg.color, emissiveIntensity: 0.5, side: 2 })
          );
          jet.position.set(cfg.x, 0.5, cfg.z); // pivot at base
          scene.add(jet);

          // Nozzle
          const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 8),
            new THREE.MeshStandardMaterial({ color: 0x2a4060, metalness: 0.9 }));
          nozzle.position.set(cfg.x, 0.42, cfg.z);
          scene.add(nozzle);

          jets.push({ mesh: jet, mat: jet.material, cfg });
        });

        // Decorative light rings
        [3.8, 4.6].forEach((r, ri) => {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 80),
            new THREE.MeshStandardMaterial({ color: 0xc9a227, emissive: 0x00d4ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.4 - ri * 0.1 }));
          ring.rotation.x = Math.PI / 2; ring.position.y = 0.36;
          scene.add(ring);
        });

        // Particles
        pGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        velocities = new Float32Array(PARTICLE_COUNT * 3);
        ages = new Float32Array(PARTICLE_COUNT);
        lifetimes = new Float32Array(PARTICLE_COUNT);
        for (let i = 0; i < PARTICLE_COUNT; i++) resetParticle(i, positions, 0.3);
        pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        pMat = new THREE.PointsMaterial({ color: 0xe8d5a0, size: 0.1, transparent: true, opacity: 0.5, sizeAttenuation: true });
        scene.add(new THREE.Points(pGeo, pMat));

        // Camera orbit
        let camAngle = 0.3;
        let camAutoOrbit = true;
        let isDragging = false, lastX = 0;
        renderer.domElement.addEventListener("mousedown", (e) => { isDragging = true; lastX = e.clientX; camAutoOrbit = false; });
        renderer.domElement.addEventListener("mousemove", (e) => { if (!isDragging) return; camAngle += (e.clientX - lastX) * 0.005; lastX = e.clientX; });
        renderer.domElement.addEventListener("mouseup", () => { isDragging = false; });
        renderer.domElement.addEventListener("wheel", (e) => {
          camera.position.setLength(Math.max(6, Math.min(28, camera.position.length() + e.deltaY * 0.02)));
        });

        sceneRef.current = { camera };

        const animate = () => {
          animId = requestAnimationFrame(animate);
          const delta = Math.min(clock.getDelta(), 0.05);
          const elapsed = clock.getElapsedTime();
          const store = useShowStore.getState();
          const isPlaying = store.playbackState === "playing";
          const ph = store.playhead;
          const tracks = store.timelineTracks;

          // Get live intensities from store every frame
          const pumpI  = getTrackIntensity(tracks, "pump",     ph);
          const lightI = getTrackIntensity(tracks, "lighting", ph);
          const flameI = getTrackIntensity(tracks, "flame",    ph);
          const valveI = getTrackIntensity(tracks, "valve",    ph);

          // Camera orbit
          if (camAutoOrbit) camAngle += delta * 0.1;
          const dist = camera.position.length();
          camera.position.x = Math.cos(camAngle) * dist * 0.82;
          camera.position.z = Math.sin(camAngle) * dist * 0.82;
          camera.lookAt(0, 3, 0);

          // Animate jets — scale Y = actual height in world units
          jets.forEach(({ mesh, mat, cfg }) => {
            const wave = Math.sin(elapsed * cfg.speed + cfg.phase) * 0.5 + 0.5;
            let targetHeight;
            if (isPlaying && pumpI > 0.01) {
              // Full dramatic range: 0.3 to maxH based on intensity
              targetHeight = cfg.maxH * pumpI * cfg.priority * (0.75 + wave * 0.25);
            } else {
              // Idle: gentle low animation
              targetHeight = cfg.maxH * 0.12 * (0.5 + wave * 0.5);
            }
            // Smooth lerp toward target
            const currentH = mesh.scale.y;
            mesh.scale.y = currentH + (targetHeight - currentH) * 0.08;
            // Position pivot at base
            mesh.position.y = mesh.scale.y / 2 + 0.35;
            mat.opacity = 0.5 + (mesh.scale.y / cfg.maxH) * 0.45;
            mat.emissiveIntensity = 0.3 + (mesh.scale.y / cfg.maxH) * 1.2;
          });

          // Particles
          const pos = pGeo.attributes.position.array;
          const currentPump = isPlaying ? pumpI : 0.2;
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            ages[i] += delta;
            if (ages[i] > lifetimes[i]) { resetParticle(i, pos, currentPump); continue; }
            const idx = i * 3;
            velocities[idx + 1] -= 5.5 * delta;
            pos[idx]     += velocities[idx]     * delta;
            pos[idx + 1] += velocities[idx + 1] * delta;
            pos[idx + 2] += velocities[idx + 2] * delta;
            if (pos[idx + 1] < 0.3) resetParticle(i, pos, currentPump);
          }
          pGeo.attributes.position.needsUpdate = true;
          pMat.opacity = 0.2 + currentPump * 0.55;
          pMat.size = 0.07 + currentPump * 0.07;

          // Lights
          lights.forEach((light, i) => {
            const pulse = Math.sin(elapsed * 2.2 + i * 1.4) * 0.5 + 0.5;
            if (isPlaying && lightI > 0.01) {
              light.intensity = 2 + lightI * 8 * (0.6 + pulse * 0.4);
            } else {
              light.intensity = 0.5 + pulse * 0.8;
            }
          });

          // Flame effect
          if (isPlaying && flameI > 0.05) {
            lights[0].color.setHex(0xff3300);
            lights[1].color.setHex(0xff7700);
            lights[0].intensity = 4 + flameI * 16;
            lights[1].intensity = 3 + flameI * 10;
          } else {
            lights[0].color.setHex(0x00d4ff);
            lights[1].color.setHex(0x8b5cf6);
          }

          renderer.render(scene, camera);
        };
        animate();

      } catch (e) {
        console.error(e);
        setError(e.message);
        setLoading(false);
      }
    };

    init();
    return () => {
      cancelAnimationFrame(animId);
      try { if (renderer) { renderer.dispose(); mountRef.current?.removeChild(renderer.domElement); } } catch {}
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#060810" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#060810", gap: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.3, animation: "pulse-glow 1s infinite" }}>◈</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--text-muted)", letterSpacing: "0.1em" }}>LOADING 3D ENGINE...</div>
        </div>
      )}

      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "var(--red)", fontSize: 12, padding: 20, textAlign: "center" }}>3D Error: {error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(6,8,16,0.85)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", backdropFilter: "blur(4px)" }}>
            <div style={{ color: "var(--text-accent)", marginBottom: 4, letterSpacing: "0.1em" }}>3D PREVIEW</div>
            <div>Drag to rotate · Scroll to zoom</div>
            <div style={{ marginTop: 4, color: playbackState === "playing" ? "var(--green)" : "var(--text-muted)" }}>
              {playbackState === "playing" ? "▶ LIVE" : "⏹ STOPPED"} · {playhead.toFixed(1)}s
            </div>
          </div>

          <div style={{ position: "absolute", top: 12, right: 12, background: "rgba(6,8,16,0.85)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 10, backdropFilter: "blur(4px)" }}>
            {[
              { label: "PUMP",   color: "#00d4ff", type: "pump" },
              { label: "LIGHTS", color: "#f59e0b", type: "lighting" },
              { label: "FLAME",  color: "#ef4444", type: "flame" },
            ].map(({ label, color, type }) => {
              const intensity = timelineTracks.filter(t => t.type === type)
                .reduce((max, t) => {
                  const clip = t.clips?.find(c => c.start <= playhead && playhead < c.end);
                  return clip ? Math.max(max, clip.intensity / 100) : max;
                }, 0);
              return (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ color: "var(--text-muted)", width: 44 }}>{label}</span>
                  <div style={{ width: 70, height: 4, background: "var(--border)", borderRadius: 2 }}>
                    <div style={{ width: `${intensity * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.15s", boxShadow: intensity > 0 ? `0 0 6px ${color}` : "none" }} />
                  </div>
                  <span style={{ color, width: 34, textAlign: "right", fontWeight: 600 }}>{Math.round(intensity * 100)}%</span>
                </div>
              );
            })}
          </div>

          <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, background: "rgba(6,8,16,0.85)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "6px 10px", backdropFilter: "blur(4px)" }}>
            {[["Top", [0,20,0.1]], ["Side", [18,5,0]], ["Front", [0,8,18]], ["Iso", [10,7,13]]].map(([name, pos]) => (
              <button key={name} className="btn" style={{ padding: "3px 10px", fontSize: 10 }}
                onClick={() => { const c = sceneRef.current?.camera; if (c) { c.position.set(...pos); c.lookAt(0,3,0); } }}>
                {name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

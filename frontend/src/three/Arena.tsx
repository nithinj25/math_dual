import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 2600;
const SPAN_X = 26;

export interface ArenaProps {
  /** -1 = opponent dominating, 0 = level, +1 = you dominating */
  balance: number;
  /** 0 idle .. 1 mid-match: drives drift speed and point size */
  energy: number;
  /** bump this to flash your side */
  meFlash: number;
  /** bump this to flash their side */
  themFlash: number;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform float uBalance;
attribute float aSeed;
varying float vSide;
varying float vSeed;

void main() {
  vec3 p = position;
  float t = uTime * (0.12 + aSeed * 0.22) * (0.5 + uEnergy);
  p.x += sin(t + aSeed * 6.2831) * 0.7;
  p.y += cos(t * 0.85 + aSeed * 3.1416) * 0.6;
  p.z += sin(t * 0.6 + aSeed * 1.7) * 0.5;

  vSide = position.x / (${(SPAN_X / 2).toFixed(1)});
  vSeed = aSeed;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.6 + aSeed * 2.6 + uEnergy * 2.2) * (16.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uMe;
uniform vec3 uThem;
uniform float uBalance;
uniform float uMeFlash;
uniform float uThemFlash;
varying float vSide;
varying float vSeed;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.05, d);

  // The frontier between the two colours slides with the score.
  float k = smoothstep(-0.35, 0.35, vSide - uBalance * 0.8);
  vec3 col = mix(uThem, uMe, k);

  // A correct answer brightens that half of the field.
  float flash = uMeFlash * k + uThemFlash * (1.0 - k);
  col = mix(col, vec3(1.0), clamp(flash, 0.0, 1.0) * 0.85);

  float alpha = soft * (0.10 + vSeed * 0.42 + flash * 0.35);
  gl_FragColor = vec4(col, alpha);
}
`;

function Field({ balance, energy, meFlash, themFlash }: ArenaProps) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Points>(null);
  const lastMe = useRef(meFlash);
  const lastThem = useRef(themFlash);
  const pointer = useRef({ x: 0, y: 0 });

  // Parallax. The canvas takes no pointer events, so listen on the window.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SPAN_X;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
      seed[i] = Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uBalance: { value: 0 },
      uMeFlash: { value: 0 },
      uThemFlash: { value: 0 },
      uMe: { value: new THREE.Color("#35dfff") },
      uThem: { value: new THREE.Color("#ff6f91") },
    }),
    [],
  );

  useFrame((_s, dt) => {
    const u = mat.current?.uniforms;
    if (!u) return;
    const step = Math.min(1, dt * 2.5);

    if (group.current) {
      const g = group.current;
      g.rotation.y += (pointer.current.x * 0.12 - g.rotation.y) * step * 0.5;
      g.rotation.x += (pointer.current.y * 0.08 - g.rotation.x) * step * 0.5;
    }

    u.uTime.value += dt;
    u.uBalance.value += (balance - u.uBalance.value) * step;
    u.uEnergy.value += (energy - u.uEnergy.value) * step;

    // A changed counter means "flash now"; then it decays on its own.
    if (meFlash !== lastMe.current) { u.uMeFlash.value = 1; lastMe.current = meFlash; }
    if (themFlash !== lastThem.current) { u.uThemFlash.value = 1; lastThem.current = themFlash; }
    u.uMeFlash.value = Math.max(0, u.uMeFlash.value - dt * 1.8);
    u.uThemFlash.value = Math.max(0, u.uThemFlash.value - dt * 1.8);
  });

  return (
    <points ref={group} geometry={geometry}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function Arena(props: ArenaProps) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="arena" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 16], fov: 55 }}
        dpr={[1, 1.6]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        frameloop={reduced ? "demand" : "always"}
      >
        <Field {...props} />
      </Canvas>
    </div>
  );
}

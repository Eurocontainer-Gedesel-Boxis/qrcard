/* ==========================================================================
   Visor 3D · Unidad Eurocontainer (BOX Integration Systems)
   Modelo propio del cliente (GLB con compresión Draco) + mejoras en tiempo
   de ejecución: normales con aristas, materiales PBR, tejado corrugado,
   sillines del silenciador, logotipos originales proyectados sobre la chapa,
   corte animado (exterior / interior / belly tank), selección con
   transparencia, selección de piezas por color-ID en GPU y cámara con
   transiciones suaves.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const MODEL_URL = './assets/3d/boxis-modelo.glb';
const DRACO_PATH = './vendor/three/addons/libs/draco/gltf/';
const DECAL_SIDE = './assets/3d/decal-eurocontainer-side.png';
const DECAL_END = './assets/3d/decal-eurocontainer-tower.png';
const FALLBACK_IMG = './assets/img/unidad-eurocontainer.webp';

const $ = (id) => document.getElementById(id);
const stage = $('modelStage');
const canvas = $('container3d');
const stateText = $('modelStateText');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEBUG = /[?&]debug\b/.test(location.search);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* --------------------------------------------------------------------------
   Piezas seleccionables, vistas y textos
   -------------------------------------------------------------------------- */
const PARTS = {
  shell: {
    id: 1, short: 'Contenedor', name: 'Contenedor Eurocontainer',
    desc: 'Envolvente de chapa corrugada con puertas de servicio y estructura reforzada. Aloja y protege todo el equipo y se transporta como una única unidad.'
  },
  tank: {
    id: 2, short: 'Belly tank', name: 'Belly tank',
    desc: 'Depósito de doble pared integrado bajo el suelo del contenedor. Sus tabiques internos transversales refuerzan la estructura y contienen el combustible.'
  },
  tower: {
    id: 3, short: 'Torre de extracción', name: 'Torre de extracción',
    desc: 'Dos módulos apilados sobre el extremo del contenedor. Canalizan hacia arriba el aire caliente del radiador y lo expulsan por encima de la unidad.'
  },
  engine: {
    id: 4, short: 'Motor', name: 'Motor del grupo',
    desc: 'Conjunto motor del grupo electrógeno, con sus colectores y tuberías, montado sobre bancada en el centro del contenedor.'
  },
  cooling: {
    id: 5, short: 'Radiador y ventilador', name: 'Radiador y ventilador de refrigeración',
    desc: 'Intercambiador y ventilador del circuito de refrigeración, situados bajo la torre para evacuar el aire caliente hacia arriba.'
  },
  exhaust: {
    id: 6, short: 'Escape y silenciador', name: 'Escape y silenciador',
    desc: 'Tubería de escape aislada que atraviesa el tejado y silenciador horizontal apoyado sobre sillines de acero.'
  },
  power: {
    id: 7, short: 'Cuadro de potencia', name: 'Cuadro de potencia',
    desc: 'Armario eléctrico de potencia del grupo, junto a la pared lateral del contenedor.'
  },
  control: {
    id: 8, short: 'Cuadros de control', name: 'Cuadros de control',
    desc: 'Cuadros de mando y control fijados a la pared interior: maniobra, protecciones y supervisión del equipo.'
  },
  filters: {
    id: 9, short: 'Filtros de aire', name: 'Filtros de aire de admisión',
    desc: 'Batería de filtros en el extremo opuesto a la torre. Depuran el aire que entra al contenedor para el motor y la refrigeración.'
  }
};
const PART_BY_ID = Object.fromEntries(Object.entries(PARTS).map(([k, p]) => [p.id, k]));

const MODES = {
  exterior: {
    chips: ['shell', 'tower', 'exhaust', 'tank'],
    title: 'Unidad completa',
    desc: 'Contenedor con belly tank integrado, torre de extracción y silenciador. Pulsa una zona para conocer su función.',
    cam: { theta: -2.38, phi: 1.3, dist: 28, target: [0, 3.6, -0.6] },
    clip: { roof: 10.8, wall: 2.6, tankWall: 2.6, floor: 10.8 },
    sun: [-10, 14, -5], lamps: 0
  },
  interior: {
    chips: ['engine', 'cooling', 'power', 'control', 'filters', 'exhaust'],
    title: 'Interior del contenedor',
    desc: 'Sección con el tejado, la torre y el lateral retirados: motor, radiador, cuadros eléctricos y filtros de aire.',
    cam: { theta: 1.72, phi: 1.0, dist: 23, target: [0, 1.5, 0.1] },
    clip: { roof: 'roofCut', wall: 1.56, tankWall: 2.6, floor: 10.8 },
    sun: [8, 17, -5], lamps: 1
  },
  tank: {
    chips: ['tank', 'shell'],
    title: 'Interior del belly tank',
    desc: 'Corte por el depósito inferior: tabiques transversales que refuerzan la estructura y limitan el movimiento del combustible.',
    cam: { theta: 1.5, phi: 1.12, dist: 23, target: [0, 1.2, 0.2] },
    clip: { roof: 'roofCut', wall: 1.56, tankWall: 1.56, floor: 10.8 },
    ghostBase: 'tank',
    sun: [8, 15, 3], lamps: 0.25
  }
};

/* Apariencia por material del GLB (los colores del archivo son de maqueta) */
const LOOKS = {
  'estructura-container':    { part: 'shell',   color: 0xdcd7c6, rough: 0.62, metal: 0.2,  weather: true },
  'torre-extraccion':        { part: 'tower',   color: 0xdcd7c6, rough: 0.62, metal: 0.2,  weather: true },
  'estructura-belly-tank':   { part: 'tank',    color: 0x8fa5b8, rough: 0.5,  metal: 0.45, weather: true },
  'motor':                   { part: 'engine',  color: 0xc8301a, rough: 0.42, metal: 0.4 },
  'ventilador-del-motor':    { part: 'cooling', color: 0x1a1c20, rough: 0.6,  metal: 0.35 },
  'aspas-ventilador':        { part: 'cooling', color: 0xc9d1d8, rough: 0.4,  metal: 0.5 },
  'silenciador-escape':      { part: 'exhaust', color: 0x1d2025, rough: 0.4,  metal: 0.7 },
  'aislamiento-tubo-escape': { part: 'exhaust', color: 0xaab0b6, rough: 0.42, metal: 0.85 },
  'cuadro-de-potencia':      { part: 'power',   color: 0x2d3136, rough: 0.4,  metal: 0.5 },
  'cuadros-de-control':      { part: 'control', color: 0xa3aab1, rough: 0.45, metal: 0.5 },
  'filtros-de-aire':         { part: 'filters', color: 0x3c4249, rough: 0.55, metal: 0.45 }
};

/* Logotipos originales: dónde se proyectan sobre la chapa */
const DECALS = [
  { url: DECAL_SIDE, aspect: 1400 / 248, axis: 'x', side: -1, along: -0.4, y: 3.36, width: 3.4, outerMin: 1.6 },
  { url: DECAL_END, aspect: 1000 / 601, axis: 'z', side: -1, along: 0, y: 1.5, width: 2.0, outerMin: 7.6 }
];

/* --------------------------------------------------------------------------
   Utilidades de geometría
   -------------------------------------------------------------------------- */
function positionsOf(geometry, matrix) {
  const p = geometry.attributes.position;
  const idx = geometry.index;
  const count = idx ? idx.count : p.count;
  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const useMatrix = matrix && !matrix.equals(new THREE.Matrix4());
  for (let i = 0; i < count; i++) {
    const j = idx ? idx.getX(i) : i;
    if (useMatrix) { v.fromBufferAttribute(p, j).applyMatrix4(matrix); out[3 * i] = v.x; out[3 * i + 1] = v.y; out[3 * i + 2] = v.z; }
    else { out[3 * i] = p.getX(j); out[3 * i + 1] = p.getY(j); out[3 * i + 2] = p.getZ(j); }
  }
  return out;
}

function concatFloat(list) {
  let n = 0;
  list.forEach((a) => { n += a.length; });
  const out = new Float32Array(n);
  let o = 0;
  list.forEach((a) => { out.set(a, o); o += a.length; });
  return out;
}

function geometryFrom(positions, crease = 0.6) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const withNormals = toCreasedNormals(g, crease);
  withNormals.computeBoundingBox();
  withNormals.computeBoundingSphere();
  return withNormals;
}

/* Chapa corrugada (trapecios) entre x0..x1 y z0..z1, con fase global en z para que las piezas encajen */
function corrugatedPanel(x0, x1, z0, z1, yBase, depth, pitch) {
  const bps = [0, 0.2, 0.5, 0.7];
  const h = (z) => {
    const f = ((z / pitch) % 1 + 1) % 1;
    if (f < 0.2) return f / 0.2;
    if (f < 0.5) return 1;
    if (f < 0.7) return 1 - (f - 0.5) / 0.2;
    return 0;
  };
  const zs = [z0];
  for (let k = Math.floor(z0 / pitch); k * pitch < z1; k++) {
    bps.forEach((b) => { const z = (k + b) * pitch; if (z > z0 + 1e-4 && z < z1 - 1e-4) zs.push(z); });
  }
  zs.push(z1);
  zs.sort((a, b) => a - b);
  const tri = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const za = zs[i], zb = zs[i + 1];
    const ya = yBase + depth * h(za + 1e-6), yb = yBase + depth * h(zb - 1e-6);
    tri.push(x0, ya, za, x1, ya, za, x1, yb, zb, x0, ya, za, x1, yb, zb, x0, yb, zb);
  }
  return new Float32Array(tri);
}

/* Sillín: placa de acero con muesca circular donde apoya el cilindro */
function saddleGeometry(halfWidth, centerY, radius, thickness, zCenter, baseY) {
  const s = new THREE.Shape();
  s.moveTo(-halfWidth, 0);
  s.lineTo(halfWidth, 0);
  s.lineTo(halfWidth, centerY);
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI * (i / steps);
    s.lineTo(Math.cos(a) * (radius + 0.012), centerY + Math.sin(a) * (radius + 0.012));
  }
  s.lineTo(-halfWidth, centerY);
  s.lineTo(-halfWidth, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, baseY, zCenter - thickness / 2);
  const plate = new THREE.BoxGeometry(halfWidth * 2 + 0.2, 0.035, thickness + 0.2);
  plate.translate(0, baseY + 0.0175, zCenter);
  const a = positionsOf(g);
  const b = positionsOf(plate);
  return concatFloat([a, b]);
}

/* --------------------------------------------------------------------------
   Texturas y entorno procedurales
   -------------------------------------------------------------------------- */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; void main(){
        float h = vD.y;
        vec3 top = vec3(0.20,0.36,0.58);
        vec3 hor = vec3(0.70,0.78,0.84);
        vec3 gnd = vec3(0.10,0.13,0.15);
        vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.35));
        gl_FragColor = vec4(c, 1.0);
      }`
    })
  );
  env.add(sky);
  const box = (w, h, color, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  box(46, 22, new THREE.Color(3.2, 3.15, 3.05), [0, 26, 0], [Math.PI / 2, 0, 0]);
  box(26, 8, new THREE.Color(3.0, 3.2, 3.6), [-34, 9, 0], [0, Math.PI / 2, 0]);
  box(26, 8, new THREE.Color(2.4, 2.6, 3.0), [34, 9, 0], [0, -Math.PI / 2, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02, 0.1, 120);
  pmrem.dispose();
  sky.geometry.dispose();
  return rt.texture;
}

/* Suciedad y desgaste por posición en el mundo (el modelo no tiene UV) */
const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
function applyWeathering(mat, roof = false) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wp = vWP;
          float big = vn(wp.xz * 0.55 + wp.y * 0.21);
          float fine = vn(wp.xz * 6.0 + wp.y * 2.3);
          float streak = vn(vec2((wp.x + wp.z) * 7.0, wp.y * 0.45));
          float ground = smoothstep(1.7, -0.95, wp.y);
          float rain = smoothstep(0.52, 0.95, streak) * smoothstep(0.2, 3.6, wp.y) * (0.35 + 0.65 * big);
          float k = ground * (0.42 + 0.3 * big) + rain * 0.3 + (fine - 0.5) * 0.05 + (big - 0.5) * 0.07;
          vec3 grime = vec3(0.40, 0.35, 0.28);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * grime, clamp(k, 0.0, 0.6)) + (fine - 0.5) * 0.012;
          ${roof ? `
          // chapa corrugada del tejado: bandas sombreadas que se funden con la distancia (evita el moaré)
          vec3 fn = normalize(cross(dFdx(wp), dFdy(wp)));
          if (abs(fn.y) > 0.9) {
            float t = wp.z / 0.22;
            float f = fract(t);
            float ridge = smoothstep(0.0, 0.28, f) * (1.0 - smoothstep(0.5, 0.78, f));
            float fade = clamp(1.0 - fwidth(t) * 1.7, 0.0, 1.0);
            diffuseColor.rgb *= 1.0 - 0.16 * (1.0 - ridge) * fade;
          }` : ''}
        }`);
  };
  mat.customProgramCacheKey = () => (roof ? 'boxis-weather-roof-v1' : 'boxis-weather-v1');
}

/* ==========================================================================
   Arranque
   ========================================================================== */
function fail(message) {
  stage.classList.remove('is-ready');
  stage.classList.add('is-error');
  stateText.textContent = message;
  if (!stage.querySelector('.viewer-fallback')) {
    const img = document.createElement('img');
    img.className = 'viewer-fallback';
    img.src = FALLBACK_IMG;
    img.alt = 'Fotografía de la unidad Eurocontainer con torre de extracción';
    stage.prepend(img);
  }
}

async function main() {
  const T0 = performance.now();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    fail('Tu navegador no puede mostrar el modelo 3D. Te mostramos una fotografía de la unidad.');
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.localClippingEnabled = true;

  let baseDpr = Math.min(window.devicePixelRatio || 1, 2);
  let dpr = baseDpr;
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 220);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;
  controls.minDistance = 4.5;
  controls.maxDistance = 46;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.5;
  controls.autoRotateSpeed = 1.1;
  canvas.style.touchAction = 'pan-y'; // el scroll vertical de la página sigue funcionando en móvil

  /* ---- Luces ---- */
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.035;
  sun.position.set(...MODES.exterior.sun);
  sun.target.position.set(0, 1.5, -0.3);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3f2, 0x2a3640, 0.25);
  const fill = new THREE.DirectionalLight(0xbcd6ee, 0.55);
  fill.position.set(7, 6, -12);
  scene.add(hemi, fill);
  const lamps = [[-1.2, 3.5, -3.6], [1.2, 3.5, 1.0], [-1.2, 3.5, 5.2]].map((p) => {
    const l = new THREE.PointLight(0xfff0d8, 0, 9, 1.6);
    l.position.set(...p);
    scene.add(l);
    return l;
  });

  /* ---- Planos de corte compartidos (se animan al cambiar de vista) ---- */
  const planes = {
    roof: new THREE.Plane(new THREE.Vector3(0, -1, 0), MODES.exterior.clip.roof),
    wall: new THREE.Plane(new THREE.Vector3(-1, 0, 0), MODES.exterior.clip.wall),
    tankWall: new THREE.Plane(new THREE.Vector3(-1, 0, 0), MODES.exterior.clip.tankWall),
    floor: new THREE.Plane(new THREE.Vector3(0, -1, 0), MODES.exterior.clip.floor)
  };

  /* ---- Carga ---- */
  stateText.textContent = 'Cargando modelo 3D…';
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await new Promise((resolve, reject) => {
    loader.load(MODEL_URL, resolve, (e) => {
      if (e.lengthComputable && e.total) stateText.textContent = 'Cargando modelo 3D… ' + Math.round((e.loaded / e.total) * 100) + ' %';
    }, reject);
  });
  const T1 = performance.now();
  stateText.textContent = 'Preparando materiales y superficies…';
  await nextFrame();

  /* ---- Agrupar por material ---- */
  const byMat = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const name = (o.material && o.material.name) || 'estructura-container';
    if (!byMat.has(name)) byMat.set(name, []);
    byMat.get(name).push(positionsOf(o.geometry, o.matrixWorld));
    o.geometry.dispose();
  });
  draco.dispose();

  const world = new THREE.Group();
  scene.add(world);
  const partState = {};
  Object.keys(PARTS).forEach((k) => {
    partState[k] = { key: k, entries: [], opacity: 1, target: 1, hover: 0, hoverTarget: 0, box: new THREE.Box3() };
  });
  const pickables = [];
  const decalMeshes = [];

  const makeMaterial = (look, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color: look.color, roughness: look.rough, metalness: look.metal, side: THREE.DoubleSide,
      transparent: true, envMapIntensity: 1.0, emissive: 0x2ab4d6, emissiveIntensity: 0,
      clipShadows: true, ...extra
    });
    if (look.weather) applyWeathering(m, !!look.roof);
    return m;
  };

  function addLayer(positions, look, partKey, { clip = [], order = 0, name = '', shadow = true } = {}) {
    const geometry = geometryFrom(positions);
    const material = makeMaterial(look, { clippingPlanes: clip });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name || partKey;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    world.add(mesh);
    const st = partState[partKey];
    st.entries.push({ mesh, material, order, clip });
    st.box.union(geometry.boundingBox);
    pickables.push({ mesh, partKey, clip });
    return mesh;
  }

  /* El suelo del contenedor y su faldón inferior (belly tank) comparten malla en el GLB: se separan por posición. */
  let shellPositions = byMat.get('estructura-container');
  if (!shellPositions) throw new Error('El modelo no contiene la estructura del contenedor');
  shellPositions = concatFloat(shellPositions);
  const skirt = [];
  const body = [];
  for (let i = 0; i < shellPositions.length; i += 9) {
    let maxY = -Infinity, minAbsX = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = shellPositions[i + 3 * k], y = shellPositions[i + 3 * k + 1], z = shellPositions[i + 3 * k + 2];
      if (y > maxY) maxY = y;
      if (Math.abs(x) < minAbsX) minAbsX = Math.abs(x);
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const perimeter = minAbsX > 1.7 || maxZ > 7.85 || minZ < -8.0;
    const target = maxY <= 0.085 && perimeter ? skirt : body;
    target.push(shellPositions.subarray(i, i + 9));
  }
  const shellBody = concatFloat(body);
  const shellSkirt = concatFloat(skirt);

  const wallClip = [planes.wall, planes.floor];
  const order = ['estructura-container', 'estructura-belly-tank', 'torre-extraccion', 'motor', 'ventilador-del-motor', 'aspas-ventilador',
    'silenciador-escape', 'aislamiento-tubo-escape', 'cuadro-de-potencia', 'cuadros-de-control', 'filtros-de-aire'];
  const clipFor = {
    'torre-extraccion': [planes.roof, planes.floor], 'estructura-belly-tank': [planes.tankWall],
    'silenciador-escape': [planes.roof, planes.floor], 'aislamiento-tubo-escape': [planes.roof, planes.floor]
  };

  for (const name of order) {
    const look = LOOKS[name];
    if (name === 'estructura-container') {
      addLayer(shellBody, look, 'shell', { clip: wallClip, name: 'contenedor' });
      if (shellSkirt.length) addLayer(shellSkirt, look, 'tank', { clip: [planes.tankWall, planes.floor], name: 'faldon-belly-tank' });
      continue;
    }
    const list = byMat.get(name);
    if (!list) continue;
    addLayer(concatFloat(list), look, look.part, { clip: clipFor[name] || [planes.floor], name });
    await nextFrame(); // deja respirar al navegador entre materiales pesados
  }
  byMat.clear();

  /* ---- Medidas reales del modelo ---- */
  const boxOf = (name) => {
    const layer = pickables.find((p) => p.mesh.name === name);
    return layer ? layer.mesh.geometry.boundingBox.clone() : null;
  };
  const towerBox = boxOf('torre-extraccion') || new THREE.Box3(new THREE.Vector3(-1.9, 4.08, -8.3), new THREE.Vector3(1.9, 9.5, -5.7));
  const pipeBox = boxOf('aislamiento-tubo-escape');
  const silBox = boxOf('silenciador-escape');
  const shellBox = new THREE.Box3().copy(partState.shell.box);

  /* Cota del borde superior de las paredes: la más alta con masa de vértices */
  let roofY = 4.08;
  {
    const bins = new Map();
    for (let i = 0; i < shellBody.length; i += 3) {
      const y = shellBody[i + 1];
      if (y < 3.6 || y > 4.4 || shellBody[i + 2] < -5.4) continue;
      const b = Math.round(y / 0.005);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    let best = -Infinity;
    bins.forEach((count, b) => { if (count >= 150 && b > best) best = b; });
    if (best > -Infinity) roofY = best * 0.005;
  }
  const roofCut = Math.min(roofY, towerBox.min.y) - 0.07;
  MODES.interior.clip.roof = roofCut;
  MODES.tank.clip.roof = roofCut;

  /* ---- Tejado corrugado (el modelo original está abierto por arriba) ---- */
  {
    const look = { ...LOOKS['estructura-container'], roof: true };
    const x0 = -1.88, x1 = 1.88;
    const zStart = towerBox.max.z + 0.01;
    const zEnd = Math.min(shellBox.max.z - 0.07, 8.2);
    const yBase = roofY - 0.03, depth = 0, pitch = 2;
    const hole = pipeBox
      ? { x0: pipeBox.min.x - 0.08, x1: pipeBox.max.x + 0.08, z0: pipeBox.min.z - 0.08, z1: pipeBox.max.z + 0.08 }
      : null;
    const pieces = [];
    if (hole) {
      pieces.push(corrugatedPanel(x0, x1, zStart, hole.z0, yBase, depth, pitch));
      pieces.push(corrugatedPanel(x0, x1, hole.z1, zEnd, yBase, depth, pitch));
      pieces.push(corrugatedPanel(x0, hole.x0, hole.z0, hole.z1, yBase, depth, pitch));
      pieces.push(corrugatedPanel(hole.x1, x1, hole.z0, hole.z1, yBase, depth, pitch));
    } else {
      pieces.push(corrugatedPanel(x0, x1, zStart, zEnd, yBase, depth, pitch));
    }
    // largueros de coronación: tapan el canto de la chapa corrugada
    const box = (cx, cy, cz, w, h, d) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(cx, cy, cz);
      return positionsOf(g);
    };
    const railH = 0.12, railY = roofY - 0.05 + railH / 2;
    pieces.push(box(-1.92, railY, (zStart + zEnd) / 2, 0.16, railH, zEnd - zStart));
    pieces.push(box(1.92, railY, (zStart + zEnd) / 2, 0.16, railH, zEnd - zStart));
    pieces.push(box(0, railY, zEnd, 3.84, railH, 0.1));
    addLayer(concatFloat(pieces), look, 'shell', { clip: [planes.wall, planes.roof, planes.floor], name: 'tejado' });
  }

  /* ---- Sillines del silenciador ---- */
  if (silBox) {
    const R = (silBox.max.y - silBox.min.y) / 2;
    const cy = (silBox.max.y + silBox.min.y) / 2;
    const cx = (silBox.max.x + silBox.min.x) / 2;
    const len = silBox.max.z - silBox.min.z;
    const parts = [0.5, 0.85].map((f) => {
      const g = saddleGeometry(R + 0.14, cy - roofY, R, 0.07, silBox.min.z + len * f, roofY - 0.02);
      for (let i = 0; i < g.length; i += 3) g[i] += cx;
      return g;
    });
    addLayer(concatFloat(parts), { color: 0x2a2e33, rough: 0.5, metal: 0.6 }, 'exhaust', { clip: [planes.roof, planes.floor], name: 'sillines-silenciador' });
  }

  /* ---- Logotipos originales sobre la chapa ---- */
  const texLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const raycaster = new THREE.Raycaster();
  const decalMat = (tex) => new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.55, metalness: 0.0, depthWrite: false, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, emissive: 0x2ab4d6, emissiveIntensity: 0
  });

  function wrapDecal(spec, tex) {
    const { axis, side, along, y, width, aspect, outerMin } = spec;
    const height = width / aspect;
    const N = Math.max(16, Math.round(width / 0.012));
    const a0 = along - width / 2, a1 = along + width / 2;
    const pad = 0.3;
    const keep = [];
    for (let i = 0; i < shellBody.length; i += 9) {
      let ok = true, yMin = Infinity, yMax = -Infinity, aMin = Infinity, aMax = -Infinity;
      for (let k = 0; k < 3; k++) {
        const x = shellBody[i + 3 * k], yy = shellBody[i + 3 * k + 1], z = shellBody[i + 3 * k + 2];
        const a = axis === 'x' ? z : x;
        if ((axis === 'x' ? x : z) * side < outerMin) { ok = false; break; }
        if (yy < yMin) yMin = yy;
        if (yy > yMax) yMax = yy;
        if (a < aMin) aMin = a;
        if (a > aMax) aMax = a;
      }
      // se conservan los triángulos que SOLAPAN la franja del logotipo (las costillas de la chapa son tiras altas)
      if (ok && yMax >= y - height / 2 - pad && yMin <= y + height / 2 + pad && aMax >= a0 - pad && aMin <= a1 + pad) keep.push(shellBody.subarray(i, i + 9));
    }
    if (!keep.length) return null;
    const probeGeo = new THREE.BufferGeometry();
    probeGeo.setAttribute('position', new THREE.BufferAttribute(concatFloat(keep), 3));
    const probe = new THREE.Mesh(probeGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    probe.updateMatrixWorld(true);
    const dir = axis === 'x' ? new THREE.Vector3(-side, 0, 0) : new THREE.Vector3(0, 0, -side);
    // el rayo parte desde fuera de la pared y mira hacia dentro
    const profile = new Array(N + 1).fill(null);
    const origin = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const a = lerp(a0, a1, i / N);
      const out = (axis === 'x' ? 6 : 12) * side;
      if (axis === 'x') origin.set(out, y, a); else origin.set(a, y, out);
      raycaster.set(origin, dir);
      raycaster.far = 12;
      const hit = raycaster.intersectObject(probe, false)[0];
      if (hit) profile[i] = axis === 'x' ? hit.point.x : hit.point.z;
    }
    probeGeo.dispose();
    const known = profile.filter((v) => v !== null);
    if (!known.length) return null;
    const fallback = known.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), known[0]);
    for (let i = 0; i <= N; i++) if (profile[i] === null) profile[i] = fallback;

    const lift = 0.004;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = axis === 'x' ? lerp(a0, a1, u) : lerp(a1, a0, u); // mirar la pared desde fuera: texto de izquierda a derecha
      const n = profile[axis === 'x' ? i : N - i] + side * lift;
      for (const yy of [y - height / 2, y + height / 2]) {
        if (axis === 'x') pos.push(n, yy, a); else pos.push(a, yy, n);
      }
      uv.push(u, 0, u, 1);
    }
    for (let i = 0; i < N; i++) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // orientar las caras hacia fuera
    const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0);
    const outward = axis === 'x' ? new THREE.Vector3(side, 0, 0) : new THREE.Vector3(0, 0, side);
    if (n0.dot(outward) < 0) {
      const flipped = [];
      for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i], idx[i + 2], idx[i + 1]);
      g.setIndex(flipped);
      g.computeVertexNormals();
    }
    g.computeBoundingBox();
    const mat = decalMat(tex);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return { mesh, mat, g };
  }

  await Promise.all(DECALS.map((spec) => new Promise((resolve) => {
    texLoader.load(spec.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      const d = wrapDecal(spec, tex);
      if (d) {
        world.add(d.mesh);
        partState.shell.entries.push({ mesh: d.mesh, material: d.mat, order: 1, clip: [], decal: true });
        decalMeshes.push(d.mesh);
      }
      resolve();
    }, undefined, () => resolve());
  })));

  /* ---- Suelo ---- */
  const floorY = Math.min(shellBox.min.y, partState.tank.box.min.y) - 0.005;
  const stageGroup = new THREE.Group();
  stageGroup.position.y = floorY;
  scene.add(stageGroup);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(17, 72),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0x5cc9e0, transparent: true, opacity: 0.2, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = -10;
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  catcher.renderOrder = -9;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5cc9e0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const ringA = new THREE.Mesh(new THREE.RingGeometry(11.0, 11.04, 128), ringMat);
  const ringB = new THREE.Mesh(new THREE.RingGeometry(14.2, 14.23, 128), ringMat.clone());
  ringB.material.opacity = 0.16;
  [ringA, ringB].forEach((r) => { r.rotation.x = -Math.PI / 2; r.position.y = 0.004; r.renderOrder = -8; });
  stageGroup.add(glow, catcher, ringA, ringB);

  /* ======================================================================
     Estado de la vista, selección y animaciones
     ====================================================================== */
  let mode = 'exterior';
  let selected = null;
  let hovered = null;
  let userAuto = !reduceMotion;
  let dirty = true;
  let shadowDirty = true;
  let tween = null;
  let modeAnim = null;
  let idleTimer = 0;
  let interacting = false;

  const cur = { roof: MODES.exterior.clip.roof, wall: MODES.exterior.clip.wall, tankWall: MODES.exterior.clip.tankWall, floor: MODES.exterior.clip.floor, lamps: 0, sun: new THREE.Vector3(...MODES.exterior.sun) };

  const partKeys = Object.keys(PARTS).filter((k) => partState[k].entries.length);
  const partBox = {};
  partKeys.forEach((k) => { partBox[k] = partState[k].box.clone(); });

  /* ---- Cámara ---- */
  const fitMul = () => clamp(1.3 / camera.aspect, 1, 1.6);
  const sph = new THREE.Spherical();
  const tmp = new THREE.Vector3();

  function applyView(v) {
    controls.target.set(v.tx, v.ty, v.tz);
    camera.position.setFromSpherical(sph.set(v.dist, v.phi, v.theta)).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    dirty = true;
  }
  function currentView() {
    tmp.copy(camera.position).sub(controls.target);
    sph.setFromVector3(tmp);
    return { tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, theta: sph.theta, phi: sph.phi, dist: sph.radius };
  }
  function flyTo(to, ms = 1300) {
    const from = currentView();
    tip.classList.remove('on');
    const goal = { ...from, ...to };
    goal.theta = from.theta + angDiff(from.theta, goal.theta);
    goal.phi = clamp(goal.phi, 0.2, 1.48);
    goal.dist = clamp(goal.dist, 4.8, 44);
    if (reduceMotion || ms <= 0) { tween = null; applyView(goal); return; }
    tween = { t0: performance.now(), ms, from, to: goal };
  }
  function stepTween(now) {
    if (!tween) return false;
    const k = clamp((now - tween.t0) / tween.ms, 0, 1);
    const e = ease(k);
    const f = tween.from, t = tween.to;
    applyView({
      tx: lerp(f.tx, t.tx, e), ty: lerp(f.ty, t.ty, e), tz: lerp(f.tz, t.tz, e),
      theta: lerp(f.theta, t.theta, e), phi: lerp(f.phi, t.phi, e), dist: lerp(f.dist, t.dist, e)
    });
    if (k >= 1) tween = null;
    return true;
  }
  const presetView = (m) => {
    const c = MODES[m].cam;
    return { tx: c.target[0], ty: c.target[1], tz: c.target[2], theta: c.theta, phi: c.phi, dist: c.dist * fitMul() };
  };
  function focusView(key) {
    const b = partBox[key];
    if (!b || mode !== 'exterior' && key === 'shell') return presetView(mode);
    const center = b.getCenter(new THREE.Vector3());
    const r = b.getBoundingSphere(new THREE.Sphere()).radius;
    const v = currentView();
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const out = { tx: center.x, ty: center.y, tz: center.z, dist: clamp((r / Math.sin(half)) * 0.8 * fitMul(), 6.5, 36), phi: clamp(v.phi, 0.7, 1.4), theta: v.theta };
    if (mode !== 'exterior' && Math.abs(angDiff(v.theta, MODES[mode].cam.theta)) > 1.2) out.theta = MODES[mode].cam.theta;
    if (key === 'shell' && mode === 'exterior') return presetView('exterior');
    return out;
  }

  /* ---- Modo (exterior / interior / belly tank) ---- */
  function setMode(next, { instant = false } = {}) {
    if (!MODES[next]) return;
    const m = MODES[next];
    mode = next;
    document.querySelectorAll('[data-model-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modelView === next)));
    select(null, { fly: false, quiet: true });
    setHover(null);
    buildChips();
    setInfo(m.title, m.desc);
    const to = { roof: m.clip.roof, wall: m.clip.wall, tankWall: m.clip.tankWall, floor: m.clip.floor, lamps: m.lamps, sun: new THREE.Vector3(...m.sun) };
    if (instant || reduceMotion) {
      Object.assign(cur, { roof: to.roof, wall: to.wall, tankWall: to.tankWall, floor: to.floor, lamps: to.lamps });
      cur.sun.copy(to.sun);
      modeAnim = null;
      syncScalars();
    } else {
      modeAnim = { t0: performance.now(), ms: 1500, from: { roof: cur.roof, wall: cur.wall, tankWall: cur.tankWall, floor: cur.floor, lamps: cur.lamps, sun: cur.sun.clone() }, to };
    }
    flyTo(presetView(next), instant ? 0 : 1500);
    shadowDirty = true;
    dirty = true;
  }
  function syncScalars() {
    planes.roof.constant = cur.roof;
    planes.wall.constant = cur.wall;
    planes.tankWall.constant = cur.tankWall;
    planes.floor.constant = cur.floor;
    lamps.forEach((l) => { l.intensity = cur.lamps * 16; });
    sun.position.copy(cur.sun);
    shadowDirty = true;
  }
  function stepMode(now) {
    if (!modeAnim) return false;
    const k = clamp((now - modeAnim.t0) / modeAnim.ms, 0, 1);
    const e = ease(k);
    const { from, to } = modeAnim;
    cur.roof = lerp(from.roof, to.roof, e);
    cur.wall = lerp(from.wall, to.wall, e);
    cur.tankWall = lerp(from.tankWall, to.tankWall, e);
    cur.floor = lerp(from.floor, to.floor, e);
    cur.lamps = lerp(from.lamps, to.lamps, e);
    cur.sun.lerpVectors(from.sun, to.sun, e);
    syncScalars();
    if (k >= 1) modeAnim = null;
    return true;
  }

  /* ---- Información y chips ---- */
  const nameEl = $('partName'), descEl = $('partDesc'), chipsEl = $('partChips');
  function setInfo(title, desc) {
    if (nameEl) nameEl.textContent = title;
    if (descEl) descEl.textContent = desc;
  }
  function buildChips() {
    if (!chipsEl) return;
    chipsEl.textContent = '';
    MODES[mode].chips.filter((k) => partState[k] && partState[k].entries.length).forEach((k) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = PARTS[k].short;
      b.dataset.part = k;
      b.setAttribute('aria-pressed', String(selected === k));
      b.addEventListener('click', () => select(selected === k ? null : k, { fly: true }));
      b.addEventListener('pointerenter', () => setHover(k));
      b.addEventListener('pointerleave', () => setHover(null));
      li.appendChild(b);
      chipsEl.appendChild(li);
    });
  }

  /* ---- Selección con transparencia ---- */
  function select(key, { fly = true, quiet = false } = {}) {
    if (key && !partState[key]) key = null;
    selected = key;
    const focusKey = key || MODES[mode].ghostBase || null;
    partKeys.forEach((k) => { partState[k].target = !focusKey || k === focusKey ? 1 : 0.13; });
    chipsEl && chipsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.part === key)));
    if (!quiet) {
      if (key) setInfo(PARTS[key].name, PARTS[key].desc); else setInfo(MODES[mode].title, MODES[mode].desc);
    }
    if (fly) flyTo(key ? focusView(key) : presetView(mode), 1100);
    shadowDirty = true;
    dirty = true;
  }

  function setHover(key) {
    if (hovered === key) return;
    hovered = key;
    partKeys.forEach((k) => { partState[k].hoverTarget = k === key ? 1 : 0; });
    canvas.style.cursor = key ? 'pointer' : '';
    dirty = true;
  }

  function stepFades(dt) {
    let busy = false;
    const kf = 1 - Math.exp(-dt * 9);
    partKeys.forEach((k) => {
      const st = partState[k];
      const dOp = st.target - st.opacity, dHv = st.hoverTarget - st.hover;
      if (Math.abs(dOp) > 0.002) { st.opacity += dOp * kf; busy = true; } else st.opacity = st.target;
      if (Math.abs(dHv) > 0.002) { st.hover += dHv * kf; busy = true; } else st.hover = st.hoverTarget;
      const faded = st.opacity < 0.97;
      st.entries.forEach((en) => {
        en.material.opacity = st.opacity;
        en.material.depthWrite = !en.decal && st.opacity > 0.97;
        en.material.emissiveIntensity = st.hover * 0.16;
        en.mesh.visible = st.opacity > 0.015;
        en.mesh.castShadow = !en.decal && st.opacity > 0.6;
        en.mesh.renderOrder = (faded ? 5 : 0) + en.order;
      });
    });
    if (busy) shadowDirty = true;
    return busy;
  }

  /* ---- Selección por color-ID en GPU ---- */
  const pickRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  const pickBuf = new Uint8Array(4);
  const pickMats = pickables.map((p) => new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(PARTS[p.partKey].id / 255, 0, 0, THREE.LinearSRGBColorSpace),
    side: THREE.DoubleSide, toneMapped: false, clippingPlanes: p.clip
  }));
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height || r.width < 2) return null;
    const saved = [];
    pickables.forEach((p, i) => {
      saved.push([p.mesh.material, p.mesh.visible]);
      p.mesh.material = pickMats[i];
      p.mesh.visible = saved[i][1] && partState[p.partKey].opacity > 0.4;
    });
    const hiddenDecals = decalMeshes.map((m) => { const v = m.visible; m.visible = false; return v; });
    const prevBg = scene.background, prevEnv = scene.environment;
    stageGroup.visible = false;
    scene.background = null;
    camera.setViewOffset(r.width, r.height, Math.floor(x), Math.floor(y), 1, 1);
    renderer.setRenderTarget(pickRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
    renderer.setRenderTarget(null);
    camera.clearViewOffset();
    stageGroup.visible = true;
    scene.background = prevBg; scene.environment = prevEnv;
    decalMeshes.forEach((m, i) => { m.visible = hiddenDecals[i]; });
    pickables.forEach((p, i) => { p.mesh.material = saved[i][0]; p.mesh.visible = saved[i][1]; });
    return PART_BY_ID[pickBuf[0]] || null;
  }

  /* ---- Etiqueta flotante ---- */
  const tip = document.createElement('div');
  tip.className = 'viewer-tip';
  tip.setAttribute('aria-hidden', 'true');
  stage.appendChild(tip);
  function moveTip(e) {
    const r = stage.getBoundingClientRect();
    tip.style.left = clamp(e.clientX - r.left, 8, r.width - 8) + 'px';
    tip.style.top = clamp(e.clientY - r.top, 8, r.height - 8) + 'px';
  }

  /* ---- Puntero ---- */
  let down = null;
  let hoverReq = 0;
  let lastPick = 0;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    tip.classList.remove('on');
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved < 6 && quick) {
      const key = pickAt(e.clientX, e.clientY);
      if (key && key === selected) select(null, { fly: true });
      else if (key) select(key, { fly: true });
      else if (selected) select(null, { fly: true });
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    moveTip(e);
    if (e.pointerType !== 'mouse' || e.buttons || tween) return;
    cancelAnimationFrame(hoverReq);
    hoverReq = requestAnimationFrame(() => {
      const now = performance.now();
      if (now - lastPick < 45 || tween || down) return;
      lastPick = now;
      const key = pickAt(e.clientX, e.clientY);
      setHover(key);
      if (key) { tip.textContent = PARTS[key].name; tip.classList.add('on'); } else tip.classList.remove('on');
    });
  });
  canvas.addEventListener('pointerleave', () => { setHover(null); tip.classList.remove('on'); });

  /* La rueda solo acerca el modelo cuando el visor tiene el foco (así no bloquea el scroll de la página) */
  canvas.addEventListener('wheel', (e) => {
    if (document.activeElement !== canvas) e.stopImmediatePropagation();
  }, { capture: true, passive: true });

  controls.addEventListener('start', () => { tween = null; interacting = true; clearTimeout(idleTimer); });
  controls.addEventListener('end', () => { interacting = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { dirty = true; }, 2500); });
  controls.addEventListener('change', () => { dirty = true; });

  /* ---- Controles de la barra ---- */
  const autoBtn = $('autoRotate');
  function paintAuto() {
    if (!autoBtn) return;
    autoBtn.setAttribute('aria-pressed', String(userAuto));
    const use = autoBtn.querySelector('use');
    const label = autoBtn.querySelector('span');
    if (use) use.setAttribute('href', userAuto ? '#i-pause' : '#i-play');
    if (label) label.textContent = userAuto ? 'Pausar' : 'Girar';
  }
  paintAuto();
  autoBtn && autoBtn.addEventListener('click', () => { userAuto = !userAuto; paintAuto(); dirty = true; });
  $('resetView') && $('resetView').addEventListener('click', () => { select(null, { fly: false }); flyTo(presetView(mode), 1100); });
  const zoomBy = (f) => { const v = currentView(); flyTo({ dist: clamp(v.dist * f, 5, 44) }, 450); };
  $('zoomIn') && $('zoomIn').addEventListener('click', () => zoomBy(0.78));
  $('zoomOut') && $('zoomOut').addEventListener('click', () => zoomBy(1.28));
  document.querySelectorAll('[data-model-view]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.modelView)));

  canvas.addEventListener('keydown', (e) => {
    const v = currentView();
    const step = 0.2;
    switch (e.key) {
      case '+': case '=': zoomBy(0.8); break;
      case '-': case '_': zoomBy(1.25); break;
      case 'ArrowLeft': flyTo({ theta: v.theta - step }, 250); break;
      case 'ArrowRight': flyTo({ theta: v.theta + step }, 250); break;
      case 'ArrowUp': flyTo({ phi: v.phi - step * 0.7 }, 250); break;
      case 'ArrowDown': flyTo({ phi: v.phi + step * 0.7 }, 250); break;
      case 'Escape': select(null, { fly: true }); break;
      case 'Home': select(null, { fly: false }); flyTo(presetView(mode), 900); break;
      case '1': setMode('exterior'); break;
      case '2': setMode('interior'); break;
      case '3': setMode('tank'); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---- Tamaño y rendimiento ---- */
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const wasAspect = camera.aspect;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (Math.abs(wasAspect - camera.aspect) > 0.3 && !tween && !selected && !interacting) {
      const v = currentView();
      const base = MODES[mode].cam.dist;
      if (Math.abs(v.dist - base * clamp(1.3 / wasAspect, 1, 1.6)) < 0.5) applyView({ ...v, dist: base * fitMul() });
    }
    dirty = true;
  }
  new ResizeObserver(resize).observe(stage);

  let running = true;
  let inView = true;
  new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; dirty = true; }, { rootMargin: '120px' }).observe(stage);
  document.addEventListener('visibilitychange', () => { dirty = true; });

  let last = performance.now();
  let slow = 0, fast = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const real = Math.min(1, (now - last) / 1000);
    const dt = Math.min(0.06, real);
    last = now;
    if (!inView || document.hidden || !running) return;

    let animating = false;
    animating = stepTween(now) || animating;
    animating = stepMode(now) || animating;
    animating = stepFades(real) || animating;

    const auto = userAuto && mode === 'exterior' && !selected && !interacting && !tween && !(down) && !hovered;
    controls.autoRotate = auto;
    const changed = controls.update(dt);
    controls.target.x = clamp(controls.target.x, -7, 7);
    controls.target.y = clamp(controls.target.y, -1, 9);
    controls.target.z = clamp(controls.target.z, -11, 11);

    if (!(changed || animating || dirty || auto)) return;
    dirty = false;
    if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
    const t0 = performance.now();
    renderer.render(scene, camera);
    const spent = performance.now() - t0 + 0; // tiempo de CPU; sirve para detectar GPU lenta junto al intervalo entre cuadros
    const interval = dt * 1000;
    if (interval > 30 && spent > 0) { slow++; fast = 0; } else if (interval < 19) { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 24 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); slow = 0; resize(); }
    else if (fast > 240 && dpr < baseDpr) { dpr = Math.min(baseDpr, dpr + 0.25); fast = 0; resize(); }
  }

  /* ---- Primera vista ---- */
  resize();
  buildChips();
  setInfo(MODES.exterior.title, MODES.exterior.desc);
  syncScalars();
  applyView(presetView('exterior'));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; fail('Se perdió el contexto gráfico. Recarga la página para ver el modelo 3D.'); });
  requestAnimationFrame(frame);
  await nextFrame();
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  stage.classList.add('is-ready');
  stateText.textContent = '';
  window.__viewerReady = true;
  window.__viewerTiming = { descargaYDraco: Math.round(T1 - T0), preparacion: Math.round(performance.now() - T1) };

  if (DEBUG) {
    window.__viewer = {
      THREE, scene, camera, controls, renderer, partState, planes, roofY, towerBox, pipeBox, silBox, shellBox,
      setMode, select, flyTo, applyView, currentView, pickAt, setHover,
      shot: (v) => { tween = null; applyView({ ...currentView(), ...v }); dirty = true; renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); }
    };
  }
}

main().catch((err) => {
  console.error('[visor 3D]', err);
  fail('No se pudo cargar el modelo 3D. Te mostramos una fotografía de la unidad.');
});

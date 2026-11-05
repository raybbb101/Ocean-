// HD-2D renderer: pixel-art sprites living inside a lit 3D diorama ocean.
// Gameplay stays on the z = 0 plane (world x → three x, world depth y → three -y);
// everything around it (terrain, rocks, kelp forests, distant fish) is real 3D,
// finished with depth of field, bloom, fog and colour grading.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WORLD, CREATURES, PLANTS, BUOYS, WATER, itemDef } from './data.js';
import { creatureSprite, itemSprite, diverSprite, RES } from './sprites.js';
import { mulberry32, makeNoise1D, clamp, lerp, smooth, hash2, mixHex, pickWeighted } from './util.js';

const FOV = 30;
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));
const MAX_GLOW_LIGHTS = 6;
const SPR = 1.4; // gameplay sprite scale (world units per sprite pixel)

function waterColor(y) {
  for (let i = 1; i < WATER.length; i++) {
    if (y <= WATER[i][0]) { const [y0, c0] = WATER[i - 1], [y1, c1] = WATER[i]; return mixHex(c0, c1, (y - y0) / (y1 - y0)); }
  }
  return WATER[WATER.length - 1][1];
}

// ---------------------------------------------------------------- textures & materials
const texCache = new WeakMap();
function tex(canvas) {
  let t = texCache.get(canvas);
  if (!t) {
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    texCache.set(canvas, t);
  }
  return t;
}

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = tex(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

const timeU = { value: 0 };
// Gentle swaying for plants, done on the GPU.
function addSway(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swayP = instanceMatrix[3].xyz;
      #else
        vec3 swayP = modelMatrix[3].xyz;
      #endif
      transformed.x += sin(uTime * 1.3 + swayP.x * 0.05 + swayP.z * 0.09) * ${amp.toFixed(3)} * uv.y * uv.y;`);
  };
  mat.customProgramCacheKey = () => `sway${amp}`;
}

const canvasIds = new WeakMap();
let nextCanvasId = 1;
const matCache = new Map();
function spriteMat(canvas, { glow = null, glowI = 1.8, sway = 0 } = {}) {
  let id = canvasIds.get(canvas);
  if (!id) { id = nextCanvasId++; canvasIds.set(canvas, id); }
  const key = `${id}|${glow || ''}|${glowI}|${sway}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex(canvas), alphaTest: 0.5, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    if (glow) { m.emissive = new THREE.Color(glow); m.emissiveMap = tex(canvas); m.emissiveIntensity = glowI; }
    if (sway) addSway(m, sway);
    matCache.set(key, m);
  }
  return m;
}

// Re-usable pool of sprite quads; anything not drawn this frame is hidden.
class SpritePool {
  constructor(parent) { this.parent = parent; this.geo = new THREE.PlaneGeometry(1, 1); this.list = []; this.i = 0; }
  begin() { this.i = 0; }
  add(canvas, x, y, z, flip = false, opts, scale = 1) {
    let m = this.list[this.i];
    if (!m) { m = new THREE.Mesh(this.geo); m.frustumCulled = false; this.parent.add(m); this.list.push(m); }
    this.i++;
    m.material = spriteMat(canvas, opts);
    m.position.set(x, y, z);
    m.scale.set((canvas.width / RES) * scale * (flip ? -1 : 1), (canvas.height / RES) * scale, 1);
    m.visible = true;
    return m;
  }
  end() { for (let j = this.i; j < this.list.length; j++) this.list[j].visible = false; }
}

// ---------------------------------------------------------------- post-processing shaders
const DIVER_GLOW = { glow: '#ffffff', glowI: 0.35 };
const FullscreenVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const DofShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, cameraNear: { value: 1 }, cameraFar: { value: 3000 },
    uFocus: { value: 380 }, uRange: { value: 260 }, uSharp: { value: 40 }, uMaxBlur: { value: 6 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: FullscreenVert,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float cameraNear, cameraFar, uFocus, uRange, uSharp, uMaxBlur; uniform vec2 uRes;
    varying vec2 vUv;
    float viewDist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
    void main() {
      float z = viewDist(vUv);
      float coc = clamp((abs(z - uFocus) - uSharp) / uRange, 0.0, 1.0);
      float r = coc * uMaxBlur;
      vec4 sum = texture2D(tDiffuse, vUv); float w = 1.0;
      if (r > 0.3) {
        for (int i = 1; i < 20; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          vec2 off = vec2(cos(a), sin(a)) * sqrt(fi / 20.0) * r / uRes;
          vec2 suv = vUv + off;
          // avoid sharp foreground bleeding into blurred background
          float zs = viewDist(suv);
          float cs = clamp((abs(zs - uFocus) - uSharp) / uRange, 0.0, 1.0);
          float k = zs < z - 10.0 ? cs : 1.0;
          sum += texture2D(tDiffuse, suv) * k; w += k;
        }
      }
      gl_FragColor = sum / w;
    }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uDanger: { value: 0 }, uTime: { value: 0 }, uDeep: { value: 0 } },
  vertexShader: FullscreenVert,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uDanger, uTime, uDeep; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.18);                       // richer colours
      c.rgb *= mix(vec3(1.04, 1.0, 0.94), vec3(0.9, 1.0, 1.12), uDeep); // warm shallows, cold deep
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.05, 1.25)));
      c.rgb *= mix(0.45, 1.0, v);                               // vignette
      c.rgb = mix(c.rgb, vec3(0.6, 0.0, 0.02), uDanger * (1.0 - v) * (0.65 + 0.35 * sin(uTime * 6.0)));
      gl_FragColor = c;
    }`,
};

class DofPass extends ShaderPass {
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}

// ---------------------------------------------------------------- renderer
export class Renderer3D {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    let q = null;
    try { q = localStorage.getItem('deepDiveExplorers.quality'); } catch {}
    this.quality = q || (this.isTouch ? 'medium' : 'high');

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1f7fb0, 0.001);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 5, 3000);
    this.scene.add(this.camera);

    // lights
    this.hemi = new THREE.HemisphereLight(0xbfefff, 0x203040, 1.5);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.5);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.lamp = new THREE.SpotLight(0xfff4dc, 0, 300, 0.62, 0.75, 1);
    this.lampTarget = new THREE.Object3D();
    this.lamp.target = this.lampTarget;
    this.aura = new THREE.PointLight(0xdff6ff, 0, 60, 1);
    this.scene.add(this.lamp, this.lampTarget, this.aura);
    this.otherLamps = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xfff0d0, 0, 150, 1); this.otherLamps.push(l); this.scene.add(l); }
    this.glowLights = [];
    for (let i = 0; i < MAX_GLOW_LIGHTS; i++) { const l = new THREE.PointLight(0xffffff, 0, 70, 1); this.glowLights.push(l); this.scene.add(l); }

    // sky / water backdrop glued to the camera
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uWater: { value: new THREE.Color() }, uSkyLow: { value: new THREE.Color('#d8f2ff') }, uSkyTop: { value: new THREE.Color('#4aa8ec') } },
      vertexShader: 'varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec3 uWater, uSkyLow, uSkyTop; varying float vY; void main(){ vec3 c = vY > 0.0 ? mix(uSkyLow, uSkyTop, clamp(vY / 500.0, 0.0, 1.0)) : uWater; gl_FragColor = vec4(c, 1.0); }',
      depthWrite: false,
    }));
    this.sky.position.z = -2600;
    this.sky.renderOrder = -10;
    this.camera.add(this.sky);

    this.pool = new SpritePool(this.scene);
    this.makeShared();

    // post-processing
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4) });
    this.composer = new EffectComposer(r, rt);
    // the cloned target must not share the depth texture's GPU storage (feedback loop)
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(4, 4);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dof = new DofPass(DofShader);
    this.composer.addPass(this.dof);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.time = 0;
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    try { localStorage.setItem('deepDiveExplorers.quality', q); } catch {}
    this.resize();
  }

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    const pr = this.quality === 'low' ? Math.min(1, window.devicePixelRatio) : Math.min(window.devicePixelRatio, this.isTouch ? 1.5 : 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(W, H, false);
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.depthTexture) { t.depthTexture.image.width = Math.floor(W * pr); t.depthTexture.image.height = Math.floor(H * pr); t.depthTexture.dispose(); }
    }
    this.composer.setPixelRatio(pr);
    this.composer.setSize(W, H);
    this.dof.uniforms.uRes.value.set(W * pr, H * pr);
    this.dof.uniforms.uMaxBlur.value = 5 * pr * (H / 720) + 1.5;
    this.camera.aspect = W / H;
    // keep ~210 world units of height on landscape, ~200 of width on portrait
    this.dist = clamp(Math.max(150 / (2 * TAN), 150 / (2 * TAN * this.camera.aspect)), 230, 720);
    this.tilt = this.dist * 0.13;
    this.camera.updateProjectionMatrix();
    this.viewH = 2 * this.dist * TAN;
    this.viewW = this.viewH * this.camera.aspect;
    const sh = 2 * 2600 * TAN * 1.4;
    this.sky.scale.set(sh * this.camera.aspect, sh, 1);
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.floor(W * dpr); this.overlay.height = Math.floor(H * dpr);
    this.odpr = dpr;
    this.dof.enabled = this.quality === 'high';
    this.bloom.enabled = this.quality !== 'low';
  }

  // ---------------------------------------------------------------- static scene
  makeShared() {
    this.grainTex = canvasTex(32, 32, (c, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 200 + Math.floor(hash2(x, y) * 55); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, 1, 1); }
    }, true);
    // light shaft
    const shaftTex = canvasTex(32, 128, (c, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = Math.pow(1 - y / h, 1.6) * Math.pow(Math.sin((x / (w - 1)) * Math.PI), 2);
        c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(x, y, 1, 1);
      }
    });
    this.shafts = [];
    const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xbff0ff, fog: false });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shaftMat.clone());
      m.userData = { bx: i * 137 + Math.random() * 90, z: -360 + Math.random() * 380, w: 30 + Math.random() * 70, ph: Math.random() * 6 };
      m.scale.set(m.userData.w, 620, 1);
      m.rotation.z = 0.22;
      this.scene.add(m); this.shafts.push(m);
    }
    // water surface (behind the play strip so it never hides the diver)
    const rip = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#7fd8f5'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { c.fillStyle = Math.random() < 0.5 ? '#c8f4ff' : '#5ec2e8'; c.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * h), 3 + Math.floor(Math.random() * 6), 1); }
    }, true);
    rip.repeat.set(40, 12);
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1200), new THREE.MeshStandardMaterial({ map: rip, transparent: true, opacity: 0.85, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide }));
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.set(0, 0, -615);
    this.scene.add(this.surface);
    this.surfLine = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1.2), new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: 0.7, fog: false }));
    this.surfLine.position.z = 1;
    this.scene.add(this.surfLine);

    // particles: bubbles/sparks + marine snow
    this.fxGeo = new THREE.BufferGeometry();
    this.fxPos = new Float32Array(600 * 3); this.fxCol = new Float32Array(600 * 3);
    this.fxGeo.setAttribute('position', new THREE.BufferAttribute(this.fxPos, 3));
    this.fxGeo.setAttribute('color', new THREE.BufferAttribute(this.fxCol, 3));
    this.fxPoints = new THREE.Points(this.fxGeo, new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.fxPoints.frustumCulled = false;
    this.scene.add(this.fxPoints);
    this.snowN = 900;
    this.snowBase = new Float32Array(this.snowN * 3);
    for (let i = 0; i < this.snowN; i++) { this.snowBase[i * 3] = Math.random() * 1000; this.snowBase[i * 3 + 1] = Math.random() * 700; this.snowBase[i * 3 + 2] = -420 + Math.random() * 540; }
    this.snowGeo = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(this.snowN * 3);
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(this.snowGeo, new THREE.PointsMaterial({ size: 1.4, color: 0xdff4ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // harpoon shots
    this.shotGeo = new THREE.BoxGeometry(7, 0.8, 0.8);
    this.shotMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f0, emissive: 0x9fdfff, emissiveIntensity: 1.5 });
    this.shotMeshes = [];
  }

  build(world, profile) {
    if (this.root) { this.scene.remove(this.root); this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.world = world;
    this.profile = profile;
    const rng = mulberry32(world.seed ^ 0x5eed);
    this.n1 = makeNoise1D(rng); this.n2 = makeNoise1D(rng); this.n3 = makeNoise1D(rng);
    this.buildTerrain();
    this.buildRocks(rng);
    this.buildDecor(rng);
    this.buildIsland();
    this.dfish = [];
  }

  // Depth (positive = down) of the ground at world x and diorama depth z.
  depthAt(x, z) {
    const w = this.world;
    const island = -(10 + clamp((-x - 80) * 0.1, 0, 12));
    let base = x < 0 ? lerp(w.floorAt(0), island, smooth(0, -45, x)) : w.floorAt(Math.min(x, WORLD.W));
    const az = Math.abs(z);
    const away = smooth(6, 40, az);
    let d = base;
    if (z < 0) {
      const k = -z / 460;
      const ridge = 0.35 + 0.65 * (0.5 + 0.5 * this.n1(x / 260 + z / 170));
      d -= k * k * (70 + Math.max(0, base) * 0.3) * ridge * 2;
      if (x > 80) d = Math.max(d, 8 + 4 * this.n3(x / 50));
    } else {
      d += (z / 110) * (z / 110) * 45;
    }
    d += (this.n2(x / 33 + z / 47) * 4 + this.n3(z / 29 + x / 91) * 4) * away;
    return d;
  }

  buildTerrain() {
    const X0 = -440, X1 = WORLD.W + 320, Z0 = -460, Z1 = 115;
    const nx = Math.ceil((X1 - X0) / 12), nz = 44;
    const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = this.depthAt(x, z);
      pos.setY(i, -d);
      uv.setXY(i, x / 9, z / 9);
      let hex;
      if (d < -13) hex = mixHex('#6cb84a', '#4f9a3a', hash2(i, 3));
      else if (d < 2) hex = '#ead7a0';
      else hex = mixHex(mixHex('#d6bd85', '#8a8f86', smooth(150, 900, d)), '#3a4458', smooth(900, 3000, d));
      c.set(mixHex(hex, '#000000', hash2(i, 7) * 0.18));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: this.grainTex, roughness: 0.95, flatShading: true }));
    this.root.add(mesh);
  }

  buildRocks(rng) {
    const variants = [];
    for (let v = 0; v < 5; v++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.78 + 0.35 * hash2(Math.round(p.getX(i) * 100) + v * 31, Math.round(p.getY(i) * 100 + p.getZ(i) * 37));
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      variants.push({ g, list: [] });
    }
    const add = (x, y, z, r, tint) => variants[Math.floor(rng() * variants.length)].list.push({ x, y, z, r, tint, ry: rng() * 6 });
    for (const r of this.world.rocks) add(r.x, -r.y, 0, r.r, r.tint);
    for (let i = 0; i < 700; i++) {
      const x = -300 + rng() * (WORLD.W + 200);
      const z = i < 560 ? -30 - Math.pow(rng(), 1.4) * 420 : 30 + rng() * 80;
      const d = this.depthAt(x, z);
      if (z > 0 && d < 40) continue;
      const r = 4 + rng() * (z < 0 ? 26 : 14);
      add(x, -d + r * 0.2, z, r, this.world.rockTint(Math.max(0, d)));
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true, map: this.grainTex });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (const v of variants) {
      const im = new THREE.InstancedMesh(v.g, mat, v.list.length);
      v.list.forEach((r, i) => {
        q.setFromEuler(e.set(0, r.ry, 0));
        m4.compose(p.set(r.x, r.y, r.z), q, s.set(r.r * 1.05, r.r * 0.9, r.r));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, c.set(r.tint));
      });
      this.root.add(im);
    }
  }

  buildDecor(rng) {
    // Background & foreground plant life — purely decorative, swaying on the GPU.
    const groups = new Map();
    const keys = Object.keys(PLANTS);
    const place = (x, z, scale, front = false) => {
      const d = this.depthAt(x, z);
      if (d < 3) return;
      const fy = this.world.floorAt(clamp(x, 0, WORLD.W));
      const cands = keys.filter((k) => fy >= PLANTS[k].min && fy <= PLANTS[k].max && !(front && k === 'kelp'));
      const key = pickWeighted(rng, cands, (k) => PLANTS[k].w * (k === 'kelp' ? 2.5 : 1));
      if (!key) return;
      const k = key === 'kelp' ? scale * (1.4 + rng() * 1.6) : scale * (0.9 + rng() * 0.8);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ x, y: -d, z, k, flip: rng() < 0.5 });
    };
    for (let i = 0; i < 2600; i++) place(60 + rng() * (WORLD.W - 80), -12 - Math.pow(rng(), 1.3) * 400, 1);
    for (let i = 0; i < 110; i++) place(60 + rng() * (WORLD.W - 80), 40 + rng() * 70, 0.9, true);
    const geo = new THREE.PlaneGeometry(1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [key, list] of groups) {
      const def = PLANTS[key];
      const spr = itemSprite(key, 0);
      const mat = spriteMat(spr, { glow: def.glow || null, glowI: 0.8, sway: key === 'kelp' ? 0.12 : 0.05 });
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((d, i) => {
        m4.compose(p.set(d.x, d.y + ((spr.height / RES) * d.k) / 2 - 1, d.z), q, s.set((spr.width / RES) * d.k * (d.flip ? -1 : 1), (spr.height / RES) * d.k, 1));
        im.setMatrixAt(i, m4);
      });
      this.root.add(im);
    }
  }

  buildIsland() {
    const g = (x) => -this.depthAt(x, 0);
    const box = (w, h, d, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts }));
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    const plank = canvasTex(16, 16, (c) => { c.fillStyle = '#b07a46'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#8a5a30'; for (let y = 0; y < 16; y += 4) c.fillRect(0, y, 16, 1); c.fillRect(7, 0, 1, 4); c.fillRect(3, 8, 1, 4); }, true);
    plank.repeat.set(4, 2);

    // shop hut
    const hx = -45, gy = g(hx);
    box(54, 26, 30, 0xffffff, hx, gy + 13, -6, { map: plank });
    for (const s of [-1, 1]) { const r = box(62, 2.5, 22, 0xc8463a, hx, gy + 32, -6 + s * 8.5); r.rotation.x = s * 0.62; }
    box(12, 16, 1, 0x3a2412, hx, gy + 8, 9.2);
    for (const wx of [-17, 17]) box(10, 7, 1, 0xffe9a0, hx + wx, gy + 15, 9.2, { emissive: 0xffc860, emissiveIntensity: 1.2 });
    const signT = canvasTex(64, 20, (c) => { c.fillStyle = '#1d2c47'; c.fillRect(0, 0, 64, 20); c.fillStyle = '#ffd23a'; c.font = 'bold 15px monospace'; c.textAlign = 'center'; c.fillText('SHOP', 32, 15); });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(32, 10), new THREE.MeshStandardMaterial({ map: signT, emissive: 0xffffff, emissiveMap: signT, emissiveIntensity: 0.6 }));
    sign.position.set(hx, gy + 44, 4);
    this.root.add(sign);
    // palm trees
    for (const [px, pz] of [[-150, -20], [-110, -60], [-200, -10]]) {
      const by = -this.depthAt(px, pz);
      for (let i = 0; i < 10; i++) box(3.5, 4, 3.5, 0x8a5a2b, px + Math.sin(i * 0.15) * 6, by + 2 + i * 4, pz);
      const top = new THREE.Vector3(px + Math.sin(1.35) * 6, by + 42, pz);
      for (let a = 0; a < 7; a++) {
        const leaf = box(26, 1.5, 5, a % 2 ? 0x3f9a3a : 0x52b347, top.x, top.y, top.z);
        leaf.rotation.set(0, (a / 7) * Math.PI * 2, -0.4);
        leaf.translateX(11);
      }
    }
    // dock
    box(WORLD.DOCK_X + 80, 2, 20, 0xffffff, (WORLD.DOCK_X + 80) / 2 - 40, 6, -2, { map: plank });
    for (let x = -30; x < WORLD.DOCK_X + 40; x += 30) for (const z of [-11, 7]) { const fy = this.depthAt(Math.max(0, x), z); box(2.5, fy + 6, 2.5, 0x6a4526, x, 6 - (fy + 6) / 2, z); }

    // boats + buoys
    this.boats = [];
    this.buoyMeshes = [];
    const mkBoat = (x) => {
      const grp = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(-26, 4); shape.lineTo(28, 4); shape.lineTo(22, -5); shape.lineTo(-22, -5); shape.lineTo(-26, 4);
      const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 16, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, flatShading: true, roughness: 0.6 }));
      hull.position.z = -8;
      grp.add(hull);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(50, 1.5, 16.4), new THREE.MeshStandardMaterial({ color: 0x2a6fd0 }));
      stripe.position.y = 1; grp.add(stripe);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }));
      cab.position.set(-2, 9, 0); grp.add(cab);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 2, 14), new THREE.MeshStandardMaterial({ color: 0xd24a3a }));
      roof.position.set(-2, 15, 0); grp.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 12.4), new THREE.MeshStandardMaterial({ color: 0x7fd7ff, emissive: 0x2a7090, emissiveIntensity: 0.8 }));
      win.position.set(-2, 10, 0); grp.add(win);
      grp.position.set(x, 0, -22);
      this.root.add(grp);
      return grp;
    };
    this.boats.push({ grp: mkBoat(WORLD.DOCK_X + 70), id: 'dock', ph: 0 });
    for (const b of BUOYS) {
      if (b.id === 'dock') continue;
      const grp = new THREE.Group();
      const red = new THREE.MeshStandardMaterial({ color: 0xe33333, roughness: 0.5 });
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 6, 10), red); grp.add(fl);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 4.7, 1.6, 10), new THREE.MeshStandardMaterial({ color: 0xffffff })); grp.add(band);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), new THREE.MeshStandardMaterial({ color: 0x333333 })); pole.position.y = 10; grp.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 0.6), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa000, emissiveIntensity: 0.6 })); flag.position.set(4, 15.5, 0); grp.add(flag);
      grp.position.set(b.x, 0, -16);
      this.root.add(grp);
      this.buoyMeshes.push({ grp, red, flag, id: b.id, x: b.x });
      this.boats.push({ grp: mkBoat(b.x + 34), id: b.id, ph: b.x });
    }
  }

  // ---------------------------------------------------------------- per frame
  screenToWorld(cx, cy) {
    const ndc = new THREE.Vector3((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = -this.camera.position.z / dir.z;
    const p = this.camera.position.clone().addScaledVector(dir, t);
    return { x: p.x, y: -p.y };
  }

  project(x, y, z = 0) {
    const v = new THREE.Vector3(x, -y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  render(g, dt) {
    this.time += dt;
    const t = (timeU.value = this.time);
    const cam = this.camera, cx = g.cam.x, cy = g.cam.y;
    const shake = g.shake > 0 ? (Math.random() - 0.5) * 3 : 0;
    cam.position.set(cx + shake, -cy + this.tilt, this.dist);
    cam.lookAt(cx, -cy - 2, 0);
    cam.updateMatrixWorld();
    const depth = Math.max(0, cy);
    const me = g.me;

    // ---- environment by depth
    const wc = new THREE.Color(waterColor(depth));
    this.scene.fog.color.copy(wc);
    this.scene.fog.density = 0.0006 + 0.0009 * smooth(0, 1800, depth);
    this.sky.material.uniforms.uWater.value.copy(wc);
    this.hemi.intensity = lerp(1.7, 0.05, smooth(0, 2300, depth));
    this.hemi.color.set(mixHex('#d8f6ff', '#5a8cc8', smooth(0, 1200, depth)));
    this.hemi.groundColor.set(mixHex('#3a5a70', '#05080f', smooth(0, 1500, depth)));
    this.sun.intensity = lerp(2.8, 0, smooth(0, 1500, depth));
    this.sun.position.set(cx + 200, 700, 380);
    this.sun.target.position.set(cx, -cy, 0);
    this.surface.position.x = cx;
    this.surface.material.map.offset.x = t * 0.01;
    this.surfLine.position.x = cx;
    this.surfLine.position.y = Math.sin(t * 2) * 0.4;
    const shaftA = 0.18 * (1 - smooth(0, 900, depth));
    for (const s of this.shafts) {
      const u = s.userData;
      s.visible = shaftA > 0.005;
      s.position.set(cx - 650 + ((((u.bx * 9 - cx * 0.15) % 1300) + 1300) % 1300), -300, u.z);
      s.material.opacity = shaftA * (0.55 + 0.45 * Math.sin(t * 0.6 + u.ph));
    }
    for (const b of this.boats) {
      b.grp.visible = b.id === 'dock' || g.profile.buoys.includes(b.id);
      b.grp.position.y = 1 + Math.sin(t * 1.6 + b.ph) * 0.9;
      b.grp.rotation.z = Math.sin(t * 1.2 + b.ph) * 0.03;
    }
    for (const b of this.buoyMeshes) {
      const on = g.profile.buoys.includes(b.id);
      b.red.color.set(on ? 0xe33333 : 0x777777);
      b.flag.visible = on;
      b.grp.position.y = Math.sin(t * 2 + b.x) * 1.2;
    }

    // ---- sprites
    const pool = this.pool;
    pool.begin();
    const vx0 = cx - this.viewW * 0.75, vx1 = cx + this.viewW * 0.75, vy0 = cy - this.viewH * 0.8, vy1 = cy + this.viewH * 0.8;
    const glows = [];
    for (const it of g.world.items) {
      if (it.taken || it.x < vx0 || it.x > vx1 || it.y < vy0 || it.y > vy1) continue;
      const def = itemDef(it.key);
      const spr = itemSprite(it.key, Math.floor(t * 1.5 + it.id) % 2);
      const opts = def.glow ? { glow: def.glow, glowI: 1.0 } : def.legendary ? { glow: '#ffe27a', glowI: 1.6 } : it.treasure ? { glow: '#ffffff', glowI: 0.35 } : { sway: 0.06 };
      pool.add(spr, it.x, -it.y + ((spr.height / RES) * SPR) / 2 - 1, 0.5, false, opts, SPR);
      if (def.glow) glows.push([it.x, it.y - 5, def.glow, 1]);
      else if (def.legendary) glows.push([it.x, it.y - 5, '#ffe27a', 1.6]);
      else if (it.treasure) glows.push([it.x, it.y - 4, '#ffe8a0', 0.45]);
    }
    for (const c of g.creatures.values()) {
      if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
      const def = CREATURES[c.key];
      if (c.hurt > 0 && Math.floor(t * 30) % 2) continue;
      pool.add(creatureSprite(c.key, Math.floor(c.t * 4) % 2), c.x, -c.y, 1, c.face < 0, def.glow ? { glow: def.glow, glowI: def.kind === 'angler' ? 0.35 : 0.55 } : undefined, SPR);
      if (def.glow) glows.push([c.x + (def.kind === 'angler' ? c.face * def.size * 0.4 : 0), c.y - (def.kind === 'angler' ? 6 : 0), def.glow, def.kind === 'angler' ? 1.6 : 0.8]);
    }
    this.drawDecorFish(dt, cx, cy, pool);
    let oi = 0;
    for (const l of this.otherLamps) l.intensity = 0;
    for (const o of g.others.values()) {
      if (o.tx === undefined) continue;
      pool.add(diverSprite(o.color || '#ffcc33', Math.floor(o.anim) % 2), o.x, -o.y, 2, o.face < 0, DIVER_GLOW, 1.1);
      const l = this.otherLamps[oi++];
      if (l) { l.position.set(o.x + (o.face || 1) * 14, -o.y, 26); l.distance = (o.lamp || 60) * 2.6; l.intensity = 30 * smooth(80, 900, o.y); }
    }
    if (!(me.invuln > 0 && Math.floor(t * 20) % 2)) pool.add(diverSprite(g.profile.color, Math.floor(me.anim) % 2), me.x, -me.y, 3, me.face < 0, DIVER_GLOW, 1.1);
    pool.end();

    // ---- lights
    const dark = smooth(60, 1400, me.y);
    const lampR = g.st.lamp;
    this.lamp.position.set(me.x - me.face * 4, -me.y + 3, 36);
    this.lampTarget.position.set(me.x + me.face * 90, -me.y - 6, 0);
    this.lamp.distance = lampR * 3.4;
    this.lamp.intensity = 90 * dark;
    this.aura.position.set(me.x, -me.y, 22);
    this.aura.distance = 40 + lampR * 0.6;
    this.aura.intensity = 25 * dark;
    glows.sort((a, b) => (a[0] - me.x) ** 2 + (a[1] - me.y) ** 2 - ((b[0] - me.x) ** 2 + (b[1] - me.y) ** 2));
    this.glowLights.forEach((l, i) => {
      const gl = glows[i];
      if (!gl) { l.intensity = 0; return; }
      l.position.set(gl[0], -gl[1], 12);
      l.color.set(gl[2]);
      l.intensity = gl[3] * (6 + dark * 22);
    });

    // ---- shots
    while (this.shotMeshes.length < g.shots.length) { const m = new THREE.Mesh(this.shotGeo, this.shotMat); this.scene.add(m); this.shotMeshes.push(m); }
    this.shotMeshes.forEach((m, i) => {
      const s = g.shots[i];
      m.visible = !!s;
      if (s) { m.position.set(s.x, -s.y, 2); m.rotation.z = Math.atan2(-s.vy, s.vx); }
    });

    // ---- particles
    let n = 0;
    const col = new THREE.Color();
    for (const f of g.fx) {
      if (n >= 600) break;
      this.fxPos[n * 3] = f.x; this.fxPos[n * 3 + 1] = -f.y; this.fxPos[n * 3 + 2] = f.type === 'bubble' ? 4 : 3;
      col.set(f.type === 'bubble' ? '#d8f6ff' : f.color);
      this.fxCol[n * 3] = col.r; this.fxCol[n * 3 + 1] = col.g; this.fxCol[n * 3 + 2] = col.b;
      n++;
    }
    this.fxGeo.setDrawRange(0, n);
    this.fxGeo.attributes.position.needsUpdate = true;
    this.fxGeo.attributes.color.needsUpdate = true;
    for (let i = 0; i < this.snowN; i++) {
      const bx = this.snowBase[i * 3], by = this.snowBase[i * 3 + 1];
      const x = cx - 500 + ((((bx - cx) % 1000) + 1000) % 1000);
      const yy = cy - 350 + ((((by - cy + t * 4) % 700) + 700) % 700);
      this.snowPos[i * 3] = x; this.snowPos[i * 3 + 1] = yy < 2 ? -9999 : -yy; this.snowPos[i * 3 + 2] = this.snowBase[i * 3 + 2];
    }
    this.snowGeo.attributes.position.needsUpdate = true;

    // ---- post
    const danger = me.y > g.st.depth ? 0.55 : me.o2 <= 0 ? 0.45 : 0;
    this.grade.uniforms.uDanger.value = danger;
    this.grade.uniforms.uTime.value = t;
    this.grade.uniforms.uDeep.value = smooth(200, 2500, depth);
    this.dof.uniforms.cameraNear.value = cam.near;
    this.dof.uniforms.cameraFar.value = cam.far;
    this.dof.uniforms.uFocus.value = Math.hypot(this.dist, this.tilt);
    this.dof.uniforms.uRange.value = this.dist * 0.75;
    this.dof.uniforms.uSharp.value = this.dist * 0.07;
    this.bloom.strength = lerp(0.35, 0.9, smooth(300, 2000, depth));
    if (this.quality === 'low') this.renderer.render(this.scene, cam);
    else this.composer.render(dt);

    this.drawOverlay(g);
  }

  // Distant fish schools swimming in the background layers.
  drawDecorFish(dt, cx, cy, pool) {
    const keys = Object.keys(CREATURES);
    while (this.dfish.length < 34) this.dfish.push(null);
    for (let i = 0; i < this.dfish.length; i++) {
      let f = this.dfish[i];
      if (!f || Math.abs(f.x - cx) > 650 || Math.abs(f.y - cy) > 420) {
        const y = clamp(cy - 200 + Math.random() * 400, 20, WORLD.D - 50);
        const cands = keys.filter((k) => !CREATURES[k].legendary && y >= CREATURES[k].min && y <= CREATURES[k].max);
        const key = pickWeighted(Math.random, cands, (k) => CREATURES[k].w);
        if (!key) { this.dfish[i] = null; continue; }
        const dir = Math.random() < 0.5 ? -1 : 1;
        const z = -70 - Math.random() * 300;
        f = this.dfish[i] = { key, x: cx + (f ? -dir * (450 + Math.random() * 150) : Math.random() * 1000 - 500), y, z, vx: dir * CREATURES[key].speed * (0.4 + Math.random() * 0.3), t: Math.random() * 5 };
        if (this.depthAt(f.x, z) < y + 10) { this.dfish[i] = null; continue; }
      }
      f.x += f.vx * dt; f.t += dt;
      const def = CREATURES[f.key];
      pool.add(creatureSprite(f.key, Math.floor(f.t * 4) % 2), f.x, -f.y + Math.sin(f.t) * 3, f.z, f.vx < 0, def.glow ? { glow: def.glow, glowI: 0.6 } : undefined, def.kind === 'shark' || def.size > 30 ? 1.2 : 1);
    }
  }

  drawOverlay(g) {
    const c = this.octx, s = this.odpr;
    c.setTransform(s, 0, 0, s, 0, 0);
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const px = window.innerHeight / this.viewH; // screen px per world unit
    c.textAlign = 'center';
    c.font = `bold ${Math.round(clamp(px * 6, 11, 18))}px ui-monospace, Menlo, Consolas, monospace`;
    for (const o of g.others.values()) {
      if (o.tx === undefined) continue;
      const p = this.project(o.x, o.y - 10, 2);
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillText(o.name || '', p.x + 1, p.y + 1);
      c.fillStyle = o.color || '#fff'; c.fillText(o.name || '', p.x, p.y);
    }
    if (g.grabTarget) {
      const ref = g.grabTarget.ref;
      const p = this.project(ref.x, (g.grabTarget.type === 'item' ? ref.y - 14 : ref.y - 12) + Math.sin(this.time * 6) * 1.5, 1);
      const k = clamp(px * 1.4, 3, 6);
      c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(p.x - k * 1.5, p.y - k); c.lineTo(p.x + k * 1.5, p.y - k); c.lineTo(p.x, p.y + k); c.closePath(); c.stroke(); c.fill();
    }
    for (const pu of g.popups) {
      const p = this.project(pu.x, pu.y, 3);
      c.globalAlpha = clamp(pu.life, 0, 1);
      c.fillStyle = '#000'; c.fillText(pu.text, p.x + 1.5, p.y + 1.5);
      c.fillStyle = pu.color; c.fillText(pu.text, p.x, p.y);
    }
    c.globalAlpha = 1;
  }
}

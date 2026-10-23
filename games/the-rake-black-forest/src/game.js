import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const container = document.querySelector("#game");
const intro = document.querySelector("#intro");
const startButton = document.querySelector("#start");
const toast = document.querySelector("#toast");
const warning = document.querySelector("#asset-warning");
const objective = document.querySelector("#objective b");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071016);
scene.fog = new THREE.FogExp2(0x0b1417, 0.0105);

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 800);
camera.position.set(0, 3.5, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x879bad, 0x121710, 0.78));
const moon = new THREE.DirectionalLight(0x9bb5ce, 1.15);
moon.position.set(-35, 65, -25);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -42;
moon.shadow.camera.right = 42;
moon.shadow.camera.top = 42;
moon.shadow.camera.bottom = -42;
scene.add(moon);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 700),
  new THREE.MeshStandardMaterial({ color: 0x273329, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const trail = new THREE.Mesh(
  new THREE.PlaneGeometry(5.2, 420),
  new THREE.MeshStandardMaterial({ color: 0x171b18, roughness: 0.98 })
);
trail.rotation.x = -Math.PI / 2;
trail.position.set(0, 0.018, -175);
scene.add(trail);

// Performance-friendly fallback forest. Swap this instanced silhouette pass for licensed
// tree GLBs in the asset integration milestone; it avoids thousands of individual draw calls.
const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.38, 5.5, 7);
trunkGeometry.translate(0, 2.75, 0);
const crownGeometry = new THREE.ConeGeometry(2.0, 6.3, 7, 2);
crownGeometry.translate(0, 6.8, 0);
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x292b25, roughness: 1 });
const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x14251d, roughness: 1 });
const treeCount = 1250;
const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
trunks.frustumCulled = false;
crowns.frustumCulled = false;
const dummy = new THREE.Object3D();
let randomSeed = 8191;
function random() {
  randomSeed = (randomSeed * 16807) % 2147483647;
  return (randomSeed - 1) / 2147483646;
}
for (let i = 0; i < treeCount; i++) {
  let x = (random() - 0.5) * 270;
  const z = 30 - random() * 420;
  if (Math.abs(x) < 5.3) x += x < 0 ? -5.6 : 5.6;
  const scale = 0.72 + random() * 1.2;
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, random() * Math.PI * 2, 0);
  dummy.scale.set(scale, scale * (0.9 + random() * 0.25), scale);
  dummy.updateMatrix();
  trunks.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, random() * Math.PI * 2, 0);
  dummy.scale.set(scale, scale, scale);
  dummy.updateMatrix();
  crowns.setMatrixAt(i, dummy.matrix);
}
scene.add(trunks, crowns);

// Player stand-in is intentionally temporary. Add a licensed survivor GLB at assets/models/player.glb.
const player = new THREE.Group();
scene.add(player);
const placeholderPlayerMaterial = new THREE.MeshStandardMaterial({ color: 0x333d3c, roughness: 0.96 });
const placeholderBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.78, 5, 8), placeholderPlayerMaterial);
placeholderBody.position.y = 1.0;
placeholderBody.castShadow = true;
player.add(placeholderBody);
const placeholderHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 12, 10),
  new THREE.MeshStandardMaterial({ color: 0x777b73, roughness: 1 })
);
placeholderHead.position.y = 1.68;
player.add(placeholderHead);

const flashlight = new THREE.SpotLight(0xd5e6ff, 78, 42, Math.PI / 7, 0.62, 1.25);
flashlight.castShadow = false;
const flashlightTarget = new THREE.Object3D();
scene.add(flashlight, flashlightTarget);
flashlight.target = flashlightTarget;

const loader = new GLTFLoader();
const assetStatus = { player: false, rake: false, cabin: false };
function refreshAssetWarning() {
  const missing = Object.keys(assetStatus).filter((name) => !assetStatus[name]);
  warning.textContent = missing.length
    ? "MODEL SETUP: Add licensed GLB files under assets/models/: " + missing.map((name) => name + ".glb").join(", ") + ". Temporary stand-ins remain until then."
    : "";
}
function loadModel(name, file, onLoad) {
  const path = new URL("../assets/models/" + file, import.meta.url).href;
  loader.load(path, (gltf) => {
    const model = gltf.scene;
    model.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ("roughness" in material && material.roughness < 0.15) material.roughness = 0.15;
          }
        }
      }
    });
    onLoad(model, gltf);
    assetStatus[name] = true;
    refreshAssetWarning();
  }, undefined, () => {
    assetStatus[name] = false;
    refreshAssetWarning();
  });
}

loadModel("player", "player.glb", (model) => {
  player.remove(placeholderBody);
  player.remove(placeholderHead);
  model.scale.setScalar(1);
  player.add(model);
});

const rake = new THREE.Group();
scene.add(rake);
const placeholderRakeMaterial = new THREE.MeshStandardMaterial({ color: 0x9ca09a, roughness: 0.86 });
function makeCreatureStandIn() {
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 1.08, 5, 9), placeholderRakeMaterial);
  torso.position.y = 1.28;
  torso.rotation.z = -0.18;
  rake.add(torso);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), placeholderRakeMaterial);
  skull.position.set(0, 2.13, -0.1);
  rake.add(skull);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 1.28, 7), placeholderRakeMaterial);
    arm.position.set(side * 0.49, 1.15, -0.02);
    arm.rotation.z = side * -0.42;
    rake.add(arm);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.95, 7), placeholderRakeMaterial);
    leg.position.set(side * 0.2, 0.45, 0.06);
    rake.add(leg);
  }
}
makeCreatureStandIn();
rake.position.set(10, 0, -62);
loadModel("rake", "rake.glb", (model) => {
  rake.clear();
  model.scale.setScalar(1.05);
  rake.add(model);
});

loadModel("cabin", "cabin.glb", (model) => {
  model.position.set(13, 0, -92);
  model.scale.setScalar(1.8);
  scene.add(model);
});

const keys = new Set();
let started = false;
let yaw = 0;
let pitch = -0.08;
let flashlightOn = true;
let elapsed = 0;
let distanceTravelled = 0;
let lastScareMessage = -30;
const clock = new THREE.Clock();
const move = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const targetCamera = new THREE.Vector3();
const targetLook = new THREE.Vector3();
const lightAim = new THREE.Vector3();

function notify(message, milliseconds = 2600) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), milliseconds);
}

startButton.addEventListener("click", () => {
  started = true;
  intro.classList.add("hidden");
  renderer.domElement.requestPointerLock();
  notify("STAY ON THE TRAIL. IF YOU HEAR IT, DON'T LOOK BACK.", 4200);
});
renderer.domElement.addEventListener("click", () => {
  if (started && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener("mousemove", (event) => {
  if (!started || document.pointerLockElement !== renderer.domElement) return;
  yaw -= event.movementX * 0.0021;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0016, -0.42, 0.25);
});
document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "KeyF" && !event.repeat) {
    flashlightOn = !flashlightOn;
    flashlight.visible = flashlightOn;
    notify(flashlightOn ? "FLASHLIGHT ON" : "FLASHLIGHT OFF", 900);
  }
});
document.addEventListener("keyup", (event) => keys.delete(event.code));
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== renderer.domElement && started) {
    // Escape releases the mouse; click the game window to capture it again.
  }
});

function update(dt) {
  if (!started) return;
  elapsed += dt;
  const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const forwardInput = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const sideInput = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  move.set(0, 0, 0);
  if (forwardInput || sideInput) {
    move.addScaledVector(forward, forwardInput);
    move.addScaledVector(right, sideInput);
    move.normalize().multiplyScalar(sprinting ? 8.0 : 4.2);
    player.position.addScaledVector(move, dt);
    distanceTravelled += move.length() * dt;
    player.rotation.y = yaw;
  }
  player.position.x = THREE.MathUtils.clamp(player.position.x, -125, 125);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -405, 24);

  // Shoulder camera follows smoothly, with look pitch controlling the aim point.
  targetCamera.set(
    player.position.x + Math.sin(yaw) * 4.6,
    player.position.y + 3.0 + pitch * 1.6,
    player.position.z + Math.cos(yaw) * 4.6
  );
  camera.position.lerp(targetCamera, 1 - Math.exp(-5.5 * dt));
  targetLook.set(
    player.position.x - Math.sin(yaw) * 1.5,
    player.position.y + 1.25 + pitch * 4,
    player.position.z - Math.cos(yaw) * 1.5
  );
  camera.lookAt(targetLook);

  flashlight.position.copy(camera.position);
  lightAim.copy(targetLook).add(forward.clone().multiplyScalar(13));
  flashlightTarget.position.copy(lightAim);
  flashlight.visible = flashlightOn;

  const targetRake = new THREE.Vector3(
    player.position.x + Math.sin(yaw + 0.8) * 10,
    0,
    player.position.z - 19 - Math.min(distanceTravelled * 0.16, 48)
  );
  const distance = rake.position.distanceTo(player.position);
  if (distance > 5) rake.position.lerp(targetRake, Math.min(1, dt * (sprinting ? 0.95 : 0.55)));
  rake.lookAt(player.position.x, 1, player.position.z);

  if (distance < 18 && elapsed - lastScareMessage > 16) {
    notify("SOMETHING IS MOVING BETWEEN THE TREES.", 2600);
    lastScareMessage = elapsed;
  }
  if (distance < 2.5) {
    notify("IT FOUND YOU. KEEP RUNNING.", 1800);
    rake.position.set(player.position.x + 18, 0, player.position.z - 26);
  }
  if (player.position.z < -70) objective.textContent = "Search for the ranger station";
  if (player.position.z < -96) objective.textContent = "Find a way to survive until dawn";
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.04);
  update(dt);
  renderer.render(scene, camera);
}
frame();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
});
refreshAssetWarning();
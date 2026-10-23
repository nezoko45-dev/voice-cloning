# THE RAKE: BLACK FOREST

A separate third-person horror game project inside the existing repository. It does not replace or modify the Voice Studio application.

## Run on Windows
1. Install Node.js LTS from https://nodejs.org/ if it is not already installed.
2. Open a terminal in this folder: \`voice-cloning\games\the-rake-black-forest\`.
3. Run:
   \`\`\`bat
   npm install
   npm start
   \`\`\`
4. Click **ENTER THE FOREST**. Controls: WASD to move, mouse to look, Shift to sprint, F to toggle the flashlight, Escape to release the mouse. Click the game window to recapture it.

## Build a Windows installer
Run in the same folder:
\`\`\`bat
npm run dist:win
\`\`\`
The installer will be written to \`dist\`. The first build downloads Electron and Three.js dependencies.

## Current state
This is an actual runnable starter, not a finished photorealistic game. It includes the desktop shell, Three.js scene, third-person camera, movement, sprinting, flashlight, atmospheric fog, moonlight, an instanced large-forest layout, an approaching creature loop, and starter objective messages.

For performance, the current forest uses instanced silhouette geometry as temporary stand-ins. The player and creature also have temporary stand-ins. These are explicitly marked as placeholders; the project attempts to load GLB files when present.

## Add real 3D models
Put licensed GLB/glTF files here:
- \`assets/models/player.glb\` — survivor character.
- \`assets/models/rake.glb\` — Rake creature.
- \`assets/models/cabin.glb\` — ranger station.
- \`assets/models/tree.glb\` — detailed pine tree for the next forest-instancing pass.

The player, Rake, and cabin loaders are wired up. The tree file is currently a placeholder for the next milestone; integrating a high-quality tree mesh into instanced placement is not implemented yet. Animated GLB clips are not yet driven by an AnimationMixer.

## Asset sources and licensing
Use assets that permit your intended use and redistribution. Check the license for each individual download before shipping it in an installer:
- Poly Haven: https://polyhaven.com/
- Kenney: https://kenney.nl/assets
- Sketchfab: https://sketchfab.com/ (check each model's license)
- Fab: https://www.fab.com/ (check the listing's license)

Do not bundle assets with unclear licenses. For a convincing low-cost art pass, prioritize a forest environment kit, forest-floor PBR textures, rocks, a cabin, and a rigged pale humanoid creature with crawl/stalk/run animations.

## Performance notes
- Three.js InstancedMesh keeps the temporary forest draw-call count low.
- Device pixel ratio is capped at 1.5.
- Shadow mapping is limited to moonlight; the flashlight currently has no shadow map.
- The forest currently has no physical tree collision, terrain height variation, or foliage interaction.

## Next milestones
1. Add a proper licensed survivor and Rake GLB; wire up AnimationMixer clips.
2. Replace temporary forest silhouettes with instanced detailed tree meshes and PBR ground textures.
3. Add forest obstacles/collisions, cabin interior, battery pickups, objectives, and a real game-over/restart flow.
4. Add spatial audio and more robust enemy perception (hearing and line of sight).
5. Test the packaged Windows build on a Windows machine before calling it release-ready.
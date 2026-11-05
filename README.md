# 🤿 Deep Dive Explorers

An **HD-2D** ocean adventure for **PC and mobile**, solo or **online co-op (up to 4 divers)**. Pixel-art divers and sea creatures swim through a lit 3D diorama ocean, with depth-of-field blur, bloom, light shafts, fog and a dive lamp that lights up the dark.

You're an adventurer diving from a small island. Hunt for sunken treasure, catch rare sea creatures and harvest glowing plants. Then get back up before your oxygen runs out, sell what you found at the dock shop, and upgrade your gear so you can dive deeper.

## Play / deploy

The game is plain HTML/JS with no build step. three.js and PeerJS are bundled in `vendor/`. **Accounts and cloud saves** run on Cloudflare too: Pages Functions in `functions/api/` with a free **D1** database. No other server is needed.

### Cloudflare Pages: Option A (automatic, recommended)
`.github/workflows/deploy-cloudflare.yml` creates the database, connects it and deploys on every push.
1. Cloudflare dashboard → *My Profile → API Tokens → Create Token → Custom token*. Give it these **Account** permissions: **Cloudflare Pages: Edit** and **D1: Edit**.
2. Copy your **Account ID**. It's in *Workers & Pages*, right sidebar.
3. In GitHub, go to *Settings → Secrets and variables → Actions*. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Re-run the latest workflow under the **Actions** tab, or push anything. The repo's **default branch** is the live site, `https://deep-dive-explorers.pages.dev`. Other branches get a preview link, shown in the workflow log.

### Cloudflare Pages: Option B (dashboard only)
1. *Workers & Pages → Create → Pages → Connect to Git* → pick this repo.
2. Build command: `bash build.sh`. Build output directory: `dist`.
3. Create the database: *Storage & Databases → D1 → Create*. Name it, for example, `deep-dive-saves`.
4. In the Pages project, go to *Settings → Bindings → Add → D1 database*. Set the variable name to **`DB`** and select the database. Do this for both Production and Preview, then redeploy. Tables are created automatically.

### Install as an app
The game is a Progressive Web App. Players press **📲 Install the app** on the title screen, which also shows instructions for iPhone/iPad, Android and desktop. It then gets its own icon, opens full screen and works offline. Accounts and co-op still need internet. Each deploy stamps a new version into `sw.js`, so installed copies update themselves.

### Locally
Run `python3 -m http.server` in this folder and open http://localhost:8000.

### Graphics
Pause menu → **Graphics: High / Medium / Low**.
- **High:** depth of field + bloom.
- **Medium:** bloom only. This is the default on phones.
- **Low:** no post-processing, for older devices.

## Gameplay

| | |
|---|---|
| 🌊 **Big ocean** | 8000 px wide and about 2400 m deep, split into four zones: Sunlit, Twilight, Midnight and the Abyss. Each zone has its own creatures, plants and treasure. |
| 🫧 **Oxygen** | Drains faster the deeper you are. Surface anywhere to refill. |
| ⚖️ **Weight** | The deeper you go, the heavier you get, so you sink and swim slower. Cargo adds weight too. |
| 🎒 **Carry limit** | Your bag holds a limited number of kg. If you black out, you lose your cargo. |
| 🧪 **Pressure** | Going below your suit's safe depth damages you. |
| 🔱 **Hostiles** | Jellyfish, barracudas, sharks, anglerfish and the giant squid. Fight them off with the harpoon; some drop valuable trophies. |
| 🪙 **Shop** | Sell your finds at the Home Dock, then upgrade Fins, Oxygen Tank, Cargo Bag, Pressure Suit, Harpoon and Dive Lamp. |
| ⚓ **Boat stops** | Surface next to a buoy to unlock fast travel. |
| 📖 **Journal** | Discover all 37 species, plants, treasures and trophies. Includes legendary finds like the Golden Seadragon and the Crown of the Deep. |

### Controls
- **PC:** `WASD`/arrows to swim · `E`/`Space` to grab · mouse click or `F` to fire the harpoon · `B` for shop/boat · `Esc` for the menu
- **Mobile:** drag the left side to swim · ✋ to grab · 🔱 to fire the harpoon (auto-aims) · a SHOP/BOAT button appears at the surface

## Saving

- **Account (online):** create an account on the title screen, with a username and password. Progress uploads automatically a few seconds after each change, and again when you leave the page. Log in on any phone or PC to continue. If the connection drops, the game keeps saving on the device and retries.
- **Guest:** play without an account. The save stays in that browser. *Export / Import* save codes move it between devices.

How accounts work: passwords are hashed with PBKDF2 and never stored. A login gives a random session token, valid for 90 days, and the database stores only a hash of it. Saves are trusted from the player's device, so this suits a casual game, not a competitive leaderboard.

Accounts need the Cloudflare deployment. On GitHub Pages or a local `python3 -m http.server`, the game detects that there's no account server and offers guest play only. To test accounts locally, use `./build.sh && npx wrangler pages dev` with a `wrangler.toml` that has a D1 binding named `DB`.

## Multiplayer: how it works without a server

Online co-op uses **WebRTC peer-to-peer** through [PeerJS](https://peerjs.com/). The host's browser runs the creatures and seabed items. The free public PeerJS broker only introduces the players to each other, so you don't run any server of your own. Each player keeps their own coins and upgrades. Some strict school or office networks block peer-to-peer connections.

## Code layout
```
index.html      UI screens + HUD
css/style.css   styling, touch controls
js/data.js      all content & balance (creatures, plants, treasure, upgrades)
js/world.js     seeded procedural seabed, rocks, item placement
js/sprites.js   procedural pixel-art sprites (used as lit billboards)
js/game.js      simulation & co-op sync
js/render3d.js  HD-2D renderer (three.js diorama, lights, DOF, bloom, grading)
vendor/         bundled three.js r160 + PeerJS
js/net.js       PeerJS wrapper
js/input.js     keyboard / mouse / touch joystick
js/save.js      local profiles + export/import codes
js/cloud.js     account + cloud save client
sw.js, manifest.webmanifest, assets/icons/   installable app (PWA)
functions/api/  Cloudflare Pages Functions: register, login, logout, me, save
server/lib.js   password hashing, sessions, D1 schema
js/main.js      menus, shop, boot
```

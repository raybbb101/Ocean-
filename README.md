# 🤿 Deep Dive Explorers

An **HD-2D** ocean adventure for **PC and mobile**, solo or **online co-op (up to 4 divers)**. Pixel-art divers and sea creatures swim through a lit 3D diorama ocean, with depth-of-field blur, bloom, light shafts, fog and a dive lamp that lights up the dark.

You're an adventurer diving from a small island. Hunt for sunken treasure, catch rare sea creatures and harvest glowing plants. Then get back up before your oxygen runs out, sell what you found at the dock shop, and upgrade your gear so you can dive deeper.

## Play / deploy

The game is plain HTML/JS with no build step. three.js and PeerJS are bundled in `vendor/`, so it needs no CDN.

### Cloudflare Pages (recommended)
**Option A: connect the repo (easiest, no keys needed)**
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick this repository.
3. Framework preset: *None*. Build command: *(empty)*. Build output directory: `/`.
4. Deploy. Every push now redeploys automatically, and you get a `*.pages.dev` link.

**Option B: GitHub Actions** (`.github/workflows/deploy-cloudflare.yml` is already included)
1. Create a Cloudflare API token with **Cloudflare Pages: Edit** permission, and copy your **Account ID**.
2. In GitHub: *Settings → Secrets and variables → Actions*. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Push (or run the workflow by hand). The game deploys to `https://deep-dive-explorers.pages.dev`.

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

## Saving: why it's local, not account-based

Account saves need a server, or a hosted backend such as Firebase or Supabase, to store each player's data and check who they are. GitHub Pages only serves static files. It can't store data per player, and writing to the repo from the game would mean putting a secret token in public code. So this version saves to **the browser (localStorage) under a diver name**, and has **Export / Import save codes** for moving a diver to another phone or PC.

To add real accounts later, swap `js/save.js` for a version backed by Firebase Auth + Firestore or Supabase. Both have free tiers and still work with GitHub Pages hosting. The rest of the game only calls `Save.load / store / list`.

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
js/main.js      menus, shop, boot
```

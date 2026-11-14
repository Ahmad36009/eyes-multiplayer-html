# Implementation and verification status

This release is not a complete or exact Unity port. No native EXE/APK is included, consistent with the decision to remain on HTML. The GitHub repo and Cloudflare service have not been deployed; follow README.md.

| Requested area | Implementation | Remaining limit |
|---|---|---|
| Original code/assets | All 271 embedded asset entries carried over and split for hosting. Original C# informs JS. | Unity C# is not executing; not every system is translated. |
| Flashlight/map lighting | Prior normals/mirror fixes retained. Removed arbitrary .48/.52 multipliers; fixed attenuation patch that never matched renderer source. Serialized intensity/range/cookie with distance falloff. | Falloff approximates Unity lookup texture; visual comparison pending. |
| Fog/shaders | Lightmap formula, ambient and cone retained; cone depth-tests. Source global fog disabled. | Full shader set not ported. |
| Push doors/collision | Collider contact applies angular impulses at the contact point. Source spring, target and damper drive return motion. Swing is checked against survivors. | Not PhysX; exact mass/inertia response unverified. |
| Krasue door restrictions | Host, guest prediction and navigation now obey closed-door barriers. | Original permitted-door exceptions remain unverified; currently all doors block her. |
| Original AI | Source-informed patrol/chase/speed ramp/repath/turning retained. Weighted A* with door-filtered graph. | Ray occlusion instead of exact spherecast; original serialized graph not executed. |
| Behind-wall vision | Segment/triangle occlusion retained. | Edge cases require playtesting. |
| Spawns | Only source upper/basement corridor markers with clearance validation. | Logic tests pass; visual check pending. |
| Pickups | Narrower center targeting based on source 0.1m spherecast and 2.5m reach; doors ignore E. | Target-bounds approximation, not collider spherecast. |
| Sounds/shaking | Original extracted sounds, event loops and same-floor shaking retained. Individual death doesn't clear all players' audio. | Complete audio audit remains. |
| UI/font/RUN/stamina | Original font/HUD sprites retained; no stamina bar; main menu rebuilt with separate screens and pause arranged from extracted widget coordinates; game-over controls corrected. | Adapted HTML, not pixel-exact NGUI. |
| Death/spectating | 1.75s scare then fade; menu/replay/difficulty replaces incorrect escape conversation. Co-op victim waits for scare/fade before following survivor. | Visual and live peer tests pending; no free-camera mode. |
| Mobile/fullscreen | Independent stick/look pointer ownership, multitouch action buttons, larger targets and fullscreen option. | Physical phone test pending. |
| Anti-camp | Conservative exit-guard pressure responds to objective readiness, proximity and contesting survivors. | Custom multiplayer rule, not original code. |
| Lag compensation | 150ms attack rewind retained; simulation acknowledgements fixed; bounded unacknowledged-input replay; swept corrections. | Not rollback networking; no measured latency test. |
| False departure messages | 30s host grace and 25s guest reconnect retries preserve player token/identity. Explicit host exit distinguished. | No host migration. |
| Names/chat/feed | Tags/feed retained; lobby chat clock and separate lobby chat UI fixed. | Two-device verification pending. |
| Public named lobbies | Worker/D1 server and publication/listing client with difficulty, mode, count, status and monster-slot info. | Deploy backend and configure site/config.json; Pages alone can't run it. |
| Live updates | Check every visible minute/on focus; notice and voluntary reload; version-matched joining; fingerprinted assets/modules. | No mid-match hot swapping or replacement of old downloaded HTML. |

## Verification

Seven logic tests cover difficulty/items, spawn clearance/floor, every filtered monster edge obeying collision, lobby chat timing, actual shader replacement, idle identities, and corridor connectivity between basement/upper floor. Structural client smoke covers initialization, intro, start, frame, pause/resume, map and replay with WebGL stubbed. The Node harness cannot load GLTF image textures and takes the fallback model path.

Browser preview was blocked by ERR_CONNECTION_REFUSED to the local server. No visual screenshot verification or live two-peer networking test was completed. The included two-device checklist is in README.md.

Source references: Environment.Update (pickup spherecast/click), Girl.dieHarder (1.75s then Over), AIPath (path following), scene hinge m_Spring fields, serialized flashlight fields, presentation level2 game over versus level3 escape chat.

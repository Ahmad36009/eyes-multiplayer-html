# Eyes HTML — GitHub setup

This package continues the supplied Eyes 2.2 recreation. It uses extracted assets and JavaScript translations of some original behavior. It is not the original Unity engine and is not a verified 1:1 port. Read STATUS.md for the remaining differences.

## 1. Publish to your new GitHub repository

Download and extract `eyes-github.zip`. The extracted `eyes-github` folder contains `site`, `.github`, `lobby-server`, and this guide. Do not upload the ZIP itself as the website.

Use an empty or existing **new** repository. On your Linux PC, replace YOURNAME and YOURREPO below with the owner and repository name. These commands assume the ZIP is in Downloads:

```bash
cd ~/Downloads
unzip -o eyes-github.zip
git clone https://github.com/YOURNAME/YOURREPO.git ~/eyes-repo
cp -a ~/Downloads/eyes-github/. ~/eyes-repo/
cd ~/eyes-repo
git add .
git commit -m "Add Eyes game and automatic Pages deployment"
git push origin HEAD:main
```

Git must already be authenticated for pushes. If it asks for a GitHub password, use GitHub's supported Git authentication (e.g. `gh auth login` and `gh auth setup-git`), not your account password. If ~/eyes-repo already exists, use a new folder name in all three relevant commands.

In your repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open **Actions → Publish game → Run workflow → main → Run workflow**. Later pushes to main run it automatically.
4. Wait for a successful green deployment. Open the URL shown in the deployment summary, normally `https://YOURNAME.github.io/YOURREPO/`.
5. Share that website address with players. They do not need a local server or downloaded game files.

The first deployment may have failed if Pages was not enabled yet; rerunning after step 2 resolves that configuration issue. If your default branch isn't main, change the workflow branch or use main for this package.

## 2. Automatic updates

Change source files under `site/`, then commit and push. Example:

```bash
cd ~/eyes-repo
git add .
git commit -m "Update game"
git push origin HEAD:main
```

The workflow creates a release ID from the Git commit, fingerprints all assets, versions JavaScript imports, and publishes `dist/`. Don't edit or commit generated dist files. You don't need to change version.json manually when publishing through Actions.

Open games check version.json every minute while visible and when returning to the tab. A new version produces an update button. Players choose when to reload; they are not thrown out of a match. New and old releases cannot join each other's lobbies. Cached unchanged assets retain their filenames; modified assets get new names.

This is automatic update discovery and deployment, not live replacement of a running match. Nothing can silently overwrite an old downloaded HTML on someone's computer. Use the website address going forward.

## 3. Multiplayer by room code

This works without the optional directory below:

- Choose Co-op or Versus, enter a display name, create a room, and share the six-character code.
- Other players open the same website, select the mode, and join with the code.
- Versus needs one monster and at least one survivor. The host starts the round.
- The host keeps the tab open. This is host-authoritative peer-to-peer multiplayer, not a dedicated game server.
- Brief broken connections trigger reconnection; the host retains the player for up to 30 seconds. Closing the host intentionally still ends the lobby. Host migration is not implemented.
- PeerJS signaling and the configured public STUN/TURN services are external dependencies. Cross-network connectivity is not guaranteed on every network; a production release should use your own provisioned TURN service.

## 4. Optional public lobby browser

GitHub Pages only serves static files. To list shared named lobbies, deploy the included small Cloudflare Worker and D1 database. Room-code joining remains available without this.

You need a Cloudflare account, Node.js and npm installed. In your local repository:

```bash
cd ~/eyes-repo/lobby-server
npx wrangler@latest login
npx wrangler@latest d1 create eyes-lobbies
```

Copy the returned database ID into `database_id` in `lobby-server/wrangler.jsonc`. Keep the binding `DB` and database_name `eyes-lobbies`.

In the same config, set ALLOWED_ORIGIN to your website **origin**, for example:

```json
"ALLOWED_ORIGIN": "https://YOURNAME.github.io"
```

Do not include `/YOURREPO/` or a trailing slash. For a custom domain, use that domain's origin instead.

Then run:

```bash
npx wrangler@latest d1 execute eyes-lobbies --remote --file=./schema.sql
npx wrangler@latest deploy
```

Copy the HTTPS workers.dev URL printed by deploy. Edit `site/config.json` in your repository:

```json
{"lobbyApi":"https://eyes-lobbies.YOUR-SUBDOMAIN.workers.dev"}
```

Commit and push those configuration changes, then wait for Pages to deploy. All players reload. Public hosts publish their name, difficulty, mode, player count, monster-slot state and round status. Hosts refresh listings every 20 seconds; abandoned listings expire after 90 seconds. Unlisted lobbies use codes only. The Worker stores lobby metadata, not gameplay or player positions.

The lobby browser does not make the host independent of the game: closing the host still ends play. Server tokens are created per lobby by the client; there are no account passwords or cloud API keys to put in site/config.json.

## 5. Verify with two devices

1. Load the same release on PC and phone. Create Co-op; join by code; start.
2. Move while pressing Use/Eye/Run on phone. Test pushing both sides of a closed door.
3. Test Versus: Krasue must not cross room door barriers even while the survivor holds a door open.
4. Move between basement and upper corridor. Check monster AI in solo and Co-op.
5. Temporarily interrupt the guest connection, then restore it within 25 seconds. Check that player identity survives and no false departure feed appears.
6. Kill one of two survivors: the victim should get the scare and fade, then spectate a living survivor. Kill the last survivor: finish the scare and fade before the game-over screen.
7. Push a new commit while a match runs: the update notice should appear without an automatic reload.
8. With the Worker configured, verify another device sees a named lobby and its difficulty.

## Local checks (optional for development)

From the repository root:

```bash
node --test test.mjs
node client-smoke.mjs
node build.mjs
```

The smoke harness stubs WebGL and does not verify graphics, GLTF textures or actual peer connections. Test commands are configured to work from the repository root.

## References

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/get-started/start-your-journey/deploying-your-website-automatically
- https://developers.cloudflare.com/d1/get-started/

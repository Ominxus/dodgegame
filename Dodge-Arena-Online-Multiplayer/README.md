# Dodge Arena Online 🕹️

A complete, real-time, **two-player** browser dodge game built with vanilla JavaScript and a lightweight Node.js server. One player creates a six-character private room code and sends the invitation link to their partner. Both see each other's arenas live and dodge **the same hazard sequence** in a best-of-three competition.

## What's included

- Private two-player rooms and invitation links (no accounts)
- Three difficulty options: **Chill** (44s / 4 hearts), **Classic** (53s / 3 hearts), **Chaos** (62s / 2 hearts)
- Same meteor waves, gates, gem positions, movement speed and cooldowns for both players
- Three-round competition with survival, gem and health scoring
- Side-by-side live arenas, keyboard and touch controls, optional sound and emoji reactions
- Brief reconnection pause and automatic 3-second resume countdown
- Rematches in the same room
- Server-authoritative positions, collisions and points (no trust in client-sent scores)
- Zero external npm dependencies and an included `package-lock.json`

## Quick local start (Mac, Windows or Linux)

Requires **Node.js 22 or newer**.

1. Open a terminal in the folder with `package.json`.
2. Run `npm ci`.
3. Run `npm start`.
4. Open **http://localhost:3000**.
5. Create a room. To simulate a second player locally, open the invite link in another browser or private window (separate session).

For two people on different computers, deploy the project to a public server using the instructions below. Sending the HTML alone **will not** enable online multiplayer.

## Deploy to GitHub + Render

**IMPORTANT: Upload the contents of this project, not an extra containing folder.** At the top level of the GitHub repository, you should see `public/`, `server/`, `tests/`, `package.json`, `package-lock.json` and `render.yaml`.

1. Create a **new GitHub repository** (for example, `dodge-arena-online`).
2. In the GitHub repository, choose **Add file → Upload files**. Drag the *contents* of the extracted project folder into the upload area. Commit the upload.
3. In [Render](https://dashboard.render.com), choose **New → Web Service** and connect the new repository.
4. Use the following settings:

   | Setting | Value |
   | --- | --- |
   | Language | Node |
   | Branch | `main` |
   | Root Directory | **Leave blank** when `package.json` is at repository root |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Instance | Free (if offered) or another suitable plan |

5. Deploy. Your public game will be available at a Render `onrender.com` link. Health check: `/health`.
6. Open the link, enter your callsign, click **Create private room**, then share the code or invitation link with your girlfriend/friend.
7. Both players press **I'm Ready**. The host picks a mode and clicks **Start Match**.

**If your GitHub repository already contains a parent folder**, enter that relative folder under Render's **Root Directory** instead of leaving it blank. Example: if `package.json` is in `dodge-arena-online/package.json`, set Root Directory to `dodge-arena-online`.

### Render free-tier caveat

Active matches are **only held in server memory**. If Render suspends/restarts the service, rooms and matches disappear. The first visitor after a suspension may see a cold-start delay. Both players must connect to the **same deployed instance**. For this two-player game, one instance is recommended.

## Controls

| Action | Desktop | Phone/tablet |
| --- | --- | --- |
| Move left/right | ← → or A / D | Hold ◀ / ▶ |
| Temporary shield | Space | Tap **Shield** |
| Emoji reactions | Click icons | Tap icons |
| Sounds | Click sound toggle | Tap sound toggle |

Shield lasts **0.64 seconds**, and goes on cooldown after use. Taking damage grants approximately **1.12 seconds** of invulnerability.

Each round awards **100 points per second survived**, **450 per gem collected** and a **120-point bonus per remaining heart**. The top score wins the round. The player with more round wins takes the match; total points break a tie.

## Testing

Run `npm test`. This includes deterministic obstacle generation, symmetrical difficulty and movement, shields, scoring, round outcomes, room creation, two real WebSocket connections, starting, reconnection and HTTP serving. The UI has also been exercised and visually checked using simulated browser network events. **A full public-hosting playtest with two external connections remains recommended.**

## Project structure

```text
public/
  index.html       Main game UI
  styles.css       Responsive graphics + layout
  app.js           WebSocket client, keyboard/touch controls and canvas renderer
  favicon.svg
server/
  index.js         HTTP server, private rooms, WebSocket protocol, reconnection
  engine.js        Shared server-authoritative game logic
 tests/
  game.test.js     Automated unit + multiplayer integration tests
package.json
package-lock.json
render.yaml
README.md
```

## Reconnect and privacy notes

A refresh in the **same browser tab** can rejoin the existing room using a random session token saved in that tab's session storage. A room can hold only two players. A third player cannot join. This is a private casual game and not intended as a hardened tournament service.

If the server restarts, the room code becomes invalid and both players should create a new room. Rooms with no connected players expire after 45 minutes of inactivity.

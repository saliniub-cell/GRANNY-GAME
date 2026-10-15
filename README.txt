GRANNY'S HOUSE - MULTIPLAYER (play with friends anywhere)

The game needs ONE server that is reachable from the internet. Your friends just open its link
in any browser (phone or PC, any network) - nothing to install for them.

=== OPTION A: quick, from your own PC (free, works right now) ===
1. Install Node.js (v18+). In this folder run:   npm install   then   npm start
2. In a second terminal, run a tunnel:
      cloudflared tunnel --url http://localhost:3000
   (get cloudflared free from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ ;
    or use ngrok:  ngrok http 3000)
3. It prints a public link like  https://something.trycloudflare.com
   Send that link to your friends. Everyone opens it, enters a username and joins.
   Your PC must stay on and the two terminals open while you play.

=== OPTION B: always-on link (free hosting, PC can be off) ===
Render.com (free):
1. Put these files in a GitHub repo (granny.html, server.js, package.json, render.yaml).
2. On render.com: New + > Web Service > pick the repo. Build: npm install   Start: node server.js
   (render.yaml already contains this.)
3. You get a link like https://grannys-house.onrender.com - send it to friends.
   Free plans "sleep" when idle: the first visit after a break takes ~30-60 seconds to wake up.
Railway, Fly.io, or any Node host work the same way (a Dockerfile is included).

=== PLAYING ===
- Open the link, enter a username, optionally a room name, click JOIN GAME.
- Friends in the same room see each other. On the start screen click COPY INVITE LINK to send a link
  that drops them straight into your room.
- Every player picks their own difficulty; Granny treats each player accordingly and hunts the nearest one.
- Controls: WASD move, Shift run, C crouch, E interact/hide, Q drop, T chat (Enter = send, Esc = cancel).
- PLAY SOLO works without a server.
- Up to 8 players per room.

# Final demo rehearsal

Use the existing build. Prioritize the real room, an agent demonstration, and recording over adding more features. This checklist does not replace the Ottawa participant portal's current deadline or submission requirements.

## Hardware and room (10 minutes)

- Put `http://127.0.0.1:4188/display/` on the laptop/projector. The port follows `.env`.
- Open `/station/` on two real phones using the laptop's LAN IP and the same Wi-Fi. Each phone receives a separate identity automatically. Verify each can visibly change its assigned control. `127.0.0.1` on a phone points to the phone, not the laptop.
- If venue Wi-Fi isolates devices, use an available trusted hotspot. Test this before recording; local browser tabs alone do not prove the venue connection.
- Use `/admin/` on the laptop and sign in privately. Keep `.env` and passwords out of the recording.
- Keep the shared display on `127.0.0.1` for its microphone permission. Enable its microphone and play a little music; demonstrate a native sketch because the inherited p5 library does not consume audio yet. If sound is unreliable, choose Just watch and demonstrate the core shared controls.

## Complete interaction (10 minutes)

1. Show the shared artwork and both participants before they touch controls.
2. Change a category on one device and a numeric value on another; show the wall responding.
3. In the creator desk choose Remix this piece. Ask for one recognizable change while retaining the composition. The old piece should keep playing. Reload the creator page once to show the job continues.
4. When complete, check the new controls on both phones, then Undo last change.
5. Choose Create a new piece and give a different visual idea. Check the result, then undo if the previous piece is stronger for the presentation.
6. Keep a completed, good-looking piece ready before the live presentation. A generation timeout retains the idea and uses fallback content; undo can return to the preceding piece.

## Make the agent visible (10 minutes)

The local preview currently has `FACILITATOR_ENABLED=false`. For the agent rehearsal, set it to `true` in the local `.env`, restart the server, and reload connected pages. This permits autonomous Gemini calls. Let participants make a few changes, then leave controls untouched for at least 90 seconds plus generation time. The facilitator checks every 10 seconds and should initiate its own new piece without an admin prompt. Record that transition and its room-activity explanation from the server log, keeping credentials out of view. Restore the toggle to `false` afterward if you want the presentation to remain on a chosen piece.

## Record and submit (remaining time)

- Rehearse a two-minute explanation: shared surface → two people change it → agent acts → creator remix and undo. Use a pre-recorded autonomous transition if the live idle wait would dominate the allotted presentation.
- Describe Gemini as generating executable drawing code. Be explicit that the 31 inherited templates are fallback content, separately attributed in README.
- Record a short backup video on the actual hardware. Confirm screen visibility and audio before the final take.
- Run `npm run verify`; confirm the intended commits are on the public repository before sharing that link. Local commits are not automatically pushed.
- Check the participant portal for the actual video limit, submission deadline, links, and sponsor-tagging instructions. Submit only after checking the repository/video for secrets.

Leave MIDI, multi-room join codes, additional APIs, and inherited-template audio retrofits for after the demo.

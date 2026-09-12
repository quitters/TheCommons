/**
 * The Commons -- sketch contract.
 *
 * A "sketch" is the one unit both the generator (server/generate.js) and the
 * display runtime (client/display/display.js) agree on:
 *
 *   {
 *     id: string,
 *     name: string,                 // short display name
 *     promptTemplate: string,       // e.g. "a {{mood}} field of {{shape}}s, {{palette}}"
 *     variables: [
 *       { name: string, label: string, values: [{ text: string, weight: number }] }
 *     ],
 *     code: string                  // JS statements -- NOT a full function --
 *                                    // run every frame as the body of
 *                                    // (ctx, frame, getVar, audio) => { ...code... }
 *   }
 *
 * `code` runs once per animation frame with:
 *   ctx      -- CanvasRenderingContext2D, already sized to the display canvas
 *   frame    -- { t: seconds since sketch start, width, height, dt: seconds since last frame }
 *   getVar   -- (variableName) => the currently selected value's `text`, or null
 *   audio    -- { level, bass, mid, treble } each 0..1, plus `beat` (boolean,
 *                a simple bass-onset heuristic -- see client/display/display.js)
 *
 * Deliberately absent from this contract: any image or video generation call.
 * `code` only ever draws with the native 2D canvas API -- that's the whole point.
 */
export const SKETCH_JSON_SHAPE = `{
  "name": "<short name>",
  "promptTemplate": "<one sentence with {{var}} placeholders>",
  "variables": [
    { "name": "<snake_case>", "label": "<Human Label>",
      "values": [ { "text": "<value>", "weight": 1 } ] }
  ],
  "code": "<JS statements using ctx, frame, getVar, audio -- no function wrapper>"
}`;

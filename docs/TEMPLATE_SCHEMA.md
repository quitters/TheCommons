# Inherited template schema (trimmed)

This is a cut-down copy of `synthograsizer-suite/docs/SCHEMA.md`, scoped to only the parts that describe the `templates/*.json` files this project actually loads (`server/templates.js`). The source document is ~1600 lines and covers a much larger surface — a Story Engine, a 16-step PromptCraft sequencer, five batch-export formats, and separate generation modes for AI image/video/text-prompt templates. None of that applies here: this project never calls an image or video generation model, has no narrative/story mode, and has no sequencer. Everything below is the subset that does apply, kept close to the original wording. See [inherited-p5-generation-prompt.md](inherited-p5-generation-prompt.md) for the actual system prompt this schema was designed for.

## Top-level structure

```jsonc
{
  "promptTemplate": "A {{style}} generative animation with {{color_palette}}.", // REQUIRED
  "variables": [ /* ... */ ],   // REQUIRED — array of Variable objects
  "p5Code": "...",              // the field that matters for this project — see below
  "tags": [ /* ... */ ]         // OPTIONAL — provenance metadata, several inherited files carry this
}
```

Two fields from the original spec are dropped entirely here: `story` (Story Engine narrative structure) and `_promptcraft` (16-step sequencer state). Neither is used by, or meaningful to, this project.

| Field | Type | Required | Description |
|---|---|---|---|
| `promptTemplate` | `string` | Yes | Natural language sentence with `{{variable_name}}` placeholders. Must read naturally with any combination of substituted values. |
| `variables` | `Variable[]` | Yes | Array of variable definitions — these become the knobs a table station renders. |
| `p5Code` | `string` | Yes, for this project | The actual p5.js instance-mode sketch. See [inherited-p5-generation-prompt.md](inherited-p5-generation-prompt.md) for the runtime contract it was written against. |
| `tags` | `Tag[]` | No | Provenance metadata — see below. Several inherited templates use this to credit their own further upstream sources. |

## Variable object

```jsonc
{
  "name": "color_palette",       // Token ID — used in {{color_palette}} placeholders
  "feature_name": "Palette",     // Display label — shown as the knob's name on a table station
  "values": [                    // Array of Value objects
    {"text": "warm embers", "weight": 3},
    {"text": "cool arctic", "weight": 3},
    {"text": "acid neon", "weight": 2}
  ]
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | Yes | `snake_case`. Must **exactly** match the `{{placeholder}}` in `promptTemplate` and every lookup-map key the sketch code reads it against. |
| `feature_name` | `string` | Yes | **Title Case** display label (1-3 words). `server/templates.js`'s `normalizeVariables()` falls back to a title-cased version of `name` if this is missing, but the inherited files all supply it directly. |
| `values` | `Value[]` | Yes | Minimum 6, the generation prompt targets 8-12. |

## Value object

```jsonc
{"text": "golden hour sunset", "weight": 3}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `text` | `string` | Yes | The label shown on a station's knob button, and the exact string a sketch's lookup map must key against. |
| `weight` | `integer` | No | Rarity tier (see below). Defaults to `1` if omitted. This project's station UI doesn't currently do weighted-random selection — a person picks explicitly — but the weight is preserved on every loaded template in case that changes. |

**Weight tiers:**

| Weight | Tier | Usage |
|---|---|---|
| `3` | Common | Default values, broadly useful options |
| `2` | Uncommon | Interesting alternatives |
| `1` | Rare | Exotic, unusual, or niche options |

**Weight distribution guideline**, for whatever count of values a variable has:

| Values | Common (3) | Uncommon (2) | Rare (1) |
|---|---|---|---|
| 6 | 2 | 2 | 2 |
| 8 | 3 | 3 | 2 |
| 10 | 4 | 4 | 2 |
| 12 | 5 | 4 | 3 |

**Critical rule, carried over unchanged:** values must always be `{text, weight}` objects. Never bare strings, never a separate parallel `weights` array on the variable. (This matters less here than in the source project, since `server/templates.js` only loads files that are already in this canonical shape — see "What was deliberately left out" below.)

## Tags and provenance

```jsonc
{
  "id": "tag_flow_field_01",
  "type": "source",
  "label": "GenerativeArtGallery — artwork1 (Flow Field Particles)",
  "description": "Adapted from the 6-mode flow field particle system in GenerativeArtGallery."
}
```

Several inherited templates (e.g. `flow-field.json`) carry a `tags` array crediting a further upstream source. This project preserves those files verbatim specifically so that attribution chain isn't lost — see the root [README.md](../README.md#whats-inherited-vs-built) for the full disclosure this project makes in turn.

| Type | Purpose |
|---|---|
| `source` | Reference material the template was adapted from |
| `creator` | Attribution to an artist or author |
| `remix` | Auto-generated lineage tracking |

(`collection`, `event`, and `custom` tag types exist in the original spec for NFT/blockchain provenance and historical context — not relevant here, omitted.)

## Validation rules a generated or hand-authored template should satisfy

Trimmed from the original's base-template validation rules (its story-block validation branch is dropped — no story block exists in this project):

| Rule | Check |
|---|---|
| Has `promptTemplate` | present and non-empty |
| Has `variables` array | present, and non-empty |
| Variables have names | every variable has a `name` |
| No duplicate names | no two variables share a `name` (case-insensitive) |
| Placeholder matching | every `{{name}}` in `promptTemplate` matches a variable's `name`, and every variable has a corresponding placeholder |
| Value format | every value is `{"text": string, "weight": 1\|2\|3}` — never a bare string |
| `feature_name` format | Title Case |

Fresh native output is validated separately by `server/validate-sketch.js`: it requires `code`, rejects `p5Code`, checks 2–6 distinct named controls, matches prompt placeholders, and compiles JavaScript without executing it. Categorical controls have 3–6 distinct weighted choices. A numeric control instead declares `{"name":"speed","label":"Speed","type":"number","min":0,"max":2,"step":0.1,"default":0.3}`, without a `values` array. Its finite bounds must have min < max, positive step, and max/default aligned to the step grid. `getVar` returns numbers for these explicit numeric controls, including zero; all choices still return text. A missing label defaults to the variable name with spaces; a missing weight defaults to 1. These native-generation checks never rewrite or validate inherited files against a new contract.

## What was deliberately left out, and why

| Section in the original `SCHEMA.md` | Why it's not here |
|---|---|
| Story Template Schema (bespoke beats, acts, character anchors, progressions) | No narrative/sequential-shot mode in this project |
| PromptCraft Sequencer Schema (`_promptcraft`, 16-step data) | No sequencer |
| Batch Export Formats (plain text, numbered list, JSON, AI Studio batch, Story JSON) | No batch export feature |
| Backend API models for `/api/generate/image`, `/api/generate/video`, image analysis, Smart Transform, narrative generation | This project never calls an image or video generation model — a scope decision documented in the root README, not a gap |
| Legacy template format + migration guide | None of the 28 templates this project loads use the legacy bare-string format — they were already canonical. The listed legacy files are all non-p5 text-prompt templates (band names, taglines, character concepts) that were never copied into this project in the first place |
| Model reference table (Gemini/Imagen/Veo model IDs) | Live code generation has its own Gemini/OpenAI configuration; inherited model tables do not apply and no image/video model is called |

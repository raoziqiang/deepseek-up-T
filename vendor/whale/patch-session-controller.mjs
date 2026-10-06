// Patch dsh-api-session-controller/lib/index.js in the packed app to add
// automatic vision-model routing: when an admitted prompt contains an image and
// the Session's current model accepts text only, the controller switches the
// Session to the first vision-capable model advertised by the same provider
// instead of refusing the prompt.
//
// Two exact replacements, each asserted unique so a version bump fails loudly:
//   1. Add a `resolveVisionModel(ctx, provider)` helper beside `modelAvailable`.
//   2. Replace the `MODEL_DOES_NOT_SUPPORT_IMAGES` throw in `prompt()` with an
//      auto-switch fallback. When no vision model exists the original refusal is
//      preserved verbatim, so the only behavior change is the graceful switch.
//
// Usage: node vendor/whale/patch-session-controller.mjs <inIndexJs> <outIndexJs>
import { readFile, writeFile } from 'node:fs/promises'

const [src, out] = process.argv.slice(2)
if (src === undefined || out === undefined) {
  console.error('usage: node patch-session-controller.mjs <inIndexJs> <outIndexJs>')
  process.exit(2)
}

let text = await readFile(src, 'utf8')

/** Apply one replacement, asserting the anchor is present exactly once. */
function replaceOnce(label, anchor, replacement) {
  const first = text.indexOf(anchor)
  if (first === -1) throw new Error(`patch-session-controller: anchor not found (${label})`)
  const second = text.indexOf(anchor, first + anchor.length)
  if (second !== -1) throw new Error(`patch-session-controller: anchor is not unique (${label})`)
  text = text.slice(0, first) + replacement + text.slice(first + anchor.length)
  console.log(`patch-session-controller: applied ${label}`)
}

// ── 1. Add the vision-model resolver after modelAvailable ────────────────────
const HELPER = `
/**
 * Resolve the first vision-capable model advertised by one provider route.
 * The image-admission policy switches the Session to this model when the current
 * model accepts text only. Returns undefined when the provider advertises no
 * image-capable model, so the caller can keep its original refusal.
 * @param ctx - Host LLM registry.
 * @param provider - provider route whose catalog is searched.
 * @returns a selection carrying the vision model, or undefined when none exists.
 */
async function resolveVisionModel(ctx, provider) {
	let models;
	try {
		models = await ctx.llm.listModels(provider);
	} catch {
		return void 0;
	}
	const vision = models.find((model) => model.inputModalities !== void 0 && model.inputModalities.includes("image"));
	if (vision === void 0) return void 0;
	return { provider, model: vision.id };
}`
replaceOnce(
  'resolveVisionModel helper',
  '\treturn models.some((model) => model.id === selection.model);\n}',
  `\treturn models.some((model) => model.id === selection.model);\n}${HELPER}`,
)

// ── 2. Auto-switch instead of refusing when the current model cannot see ─────
replaceOnce(
  'auto vision switch',
  '\t\t\t\t\tif (hasImage) {\n\t\t\t\t\t\tconst current = this.agents.selectionFor(agent).current;\n\t\t\t\t\t\tconst model = await this.ctx.llm.resolveModelInfo(current.provider, current.model);\n\t\t\t\t\t\tif (model.inputModalities !== void 0 && !model.inputModalities.includes("image")) throw new RemoteError("session/attachment-invalid", `Model "${current.model}" does not support image input.`, { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" });\n\t\t\t\t\t}',
  '\t\t\t\t\tif (hasImage) {\n\t\t\t\t\t\tconst selection = this.agents.selectionFor(agent);\n\t\t\t\t\t\tconst current = selection.current;\n\t\t\t\t\t\tconst model = await this.ctx.llm.resolveModelInfo(current.provider, current.model);\n\t\t\t\t\t\tif (model.inputModalities === void 0 || !model.inputModalities.includes("image")) {\n\t\t\t\t\t\t\tconst vision = await resolveVisionModel(this.ctx, current.provider);\n\t\t\t\t\t\t\tif (vision === void 0) throw new RemoteError("session/attachment-invalid", `Model "${current.model}" does not support image input.`, { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" });\n\t\t\t\t\t\t\tthis.agents.selectForNextRequest(agent, vision);\n\t\t\t\t\t\t}\n\t\t\t\t\t}',
)

await writeFile(out, text, 'utf8')
console.log(`patch-session-controller: wrote ${out} (${text.length} bytes)`)

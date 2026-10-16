import type { Blueprint } from './blueprint';
import { ALIGNS, ARRANGEMENTS, SIDES } from './layout';
import { pickLibraryExamples } from './library';
import { PART_MATERIALS, PART_SHAPES } from './parts';
import { promptTokens, similarity } from './similarity';

export interface FeedbackExample {
  prompt: string;
  liked: boolean;
  /** Present for results that came from a blueprint. */
  blueprint: Blueprint | null;
  comment: string | null;
  /** True when the current user gave this rating. */
  own: boolean;
}

export interface DesignRequest {
  prompt: string;
  mode: '3d' | '2d';
  /** Plain-language description of the reference image, if one was given. */
  imageSummary: string | null;
  examples: FeedbackExample[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You design 3D game assets out of simple primitive parts. You describe how parts connect; the app computes exact positions.

First write "parts_plan": one or two sentences listing the object's recognizable parts and how they connect. Then list the parts in that order.

Each part:
- shape: ${PART_SHAPES.join(', ')}. cylinder, cone and capsule stand upright. torus is a flat ring (rotate [90,0,0] to stand it up facing front). dome is half a sphere. wedge is a ramp.
- size: [width, height, depth] in meters at real-world scale (a key is about 0.07 m long, a mug 0.1 m, a chair 0.9 m tall, a car 4 m long).
- attach_to: "ground" for the first part, otherwise the name of an EARLIER part.
- side: where the part goes relative to attach_to: ${SIDES.join(', ')} ("center" = same center, e.g. a gem set into a ring).
- align: ${ALIGNS.join(', ')}. Slides the part to that edge of what it attaches to (a chair backrest is on_top of the seat with align "back"; a door is on the front of the walls with align "bottom").
- arrangement: ${ARRANGEMENTS.join(', ')}. "pair" = two copies (left and right), "corners" = four copies at the corners (table legs), "ring3"/"ring6" = copies around a circle.
- rotation: degrees [x, y, z], usually [0, 0, 0]. Use [0, 0, 90] to lay a cylinder sideways along x and [90, 0, 0] to point it toward the front.
- color: #rrggbb. material: ${PART_MATERIALS.join(', ')} ("glow" emits light).

Rules:
- 3 to 15 parts. Capture the silhouette people recognize, then add 1 to 3 characteristic details.
- The user's words are the main instruction. A reference image description only fills in what the words leave open (colors, proportions).
- If the text only describes a style or material ("rusty metal, wide") and names no object, set text_names_object to false.
- Reply with JSON only.`;

/** Builds the chat for one design request, including feedback-derived guidance. */
export function buildDesignMessages(req: DesignRequest): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }];

  // The closest reference designs come last, nearest the request, where small models weigh them most.
  const references = pickLibraryExamples(promptTokens(req.prompt), similarity, promptTokens).reverse();
  for (const design of references) {
    messages.push({ role: 'user', content: describe(design.name, req.mode, null) });
    messages.push({ role: 'assistant', content: JSON.stringify(design) });
  }

  // Liked results for similar prompts are shown as worked examples.
  for (const ex of req.examples.filter((e) => e.liked && e.blueprint?.layout).slice(0, 2)) {
    messages.push({ role: 'user', content: describe(ex.prompt, req.mode, null) });
    messages.push({ role: 'assistant', content: JSON.stringify(ex.blueprint!.layout) });
  }

  const guidance: string[] = [];
  const liked = req.examples.filter((e) => e.liked);
  if (liked.length) {
    guidance.push(
      `Users liked results for similar requests: ${liked
        .slice(0, 3)
        .map((e) => `"${e.prompt}"${e.own ? ' (this user)' : ''}`)
        .join(', ')}. Keep what made those work.`,
    );
  }
  // Small models over-react to "be different" and drift off the object, so dislikes are phrased as
  // a specific fix while keeping the object recognizable.
  for (const ex of req.examples.filter((e) => !e.liked).slice(0, 3)) {
    const parts = ex.blueprint?.layout?.parts ?? ex.blueprint?.parts;
    const what = parts ? ` That design had: ${parts.map((p) => `${p.name} (${p.shape})`).join(', ')}.` : '';
    const fix = ex.comment
      ? ` Their reason: "${ex.comment}". Apply that change`
      : ' Improve it, for example with better proportions, colors or one more characteristic detail,';
    guidance.push(`${ex.own ? 'This user' : 'A user'} disliked the result for "${ex.prompt}".${what}${fix} while keeping it a clearly recognizable ${req.prompt}.`);
  }

  messages.push({ role: 'user', content: describe(req.prompt, req.mode, req.imageSummary, guidance) });
  return messages;
}

function describe(prompt: string, mode: '3d' | '2d', imageSummary: string | null, guidance: string[] = []): string {
  const lines = [`Design: ${prompt}`];
  if (mode === '2d') lines.push('(It will be shown as a 2D game sprite, so make the front view read clearly.)');
  if (imageSummary) lines.push(`Reference image: ${imageSummary}`);
  if (guidance.length) lines.push('Feedback from earlier results:', ...guidance.map((g) => `- ${g}`));
  return lines.join('\n');
}

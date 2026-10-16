import type { Blueprint } from '../src/generators/llm/blueprint';
import { LIBRARY } from '../src/generators/llm/library';
import type { TextModel } from '../src/generators/llm/ollama';
import type { DesignRequest } from '../src/generators/llm/prompt';

/** What a text model might return for "key". */
export const KEY: Blueprint = {
  name: 'old brass key',
  summary: 'A ring bow, a long shaft and two teeth.',
  textNamesObject: true,
  parts: [
    { name: 'bow', shape: 'torus', size: [0.03, 0.006, 0.03], position: [0, 0.07, 0], rotation: [90, 0, 0], color: '#c9a64a', material: 'metal' },
    { name: 'shaft', shape: 'cylinder', size: [0.006, 0.06, 0.006], position: [0, 0.03, 0], rotation: [0, 0, 0], color: '#c9a64a', material: 'metal' },
    { name: 'tooth 1', shape: 'box', size: [0.012, 0.005, 0.004], position: [0.006, 0.006, 0], rotation: [0, 0, 0], color: '#b8933c', material: 'metal' },
    { name: 'tooth 2', shape: 'box', size: [0.009, 0.005, 0.004], position: [0.005, 0.015, 0], rotation: [0, 0, 0], color: '#b8933c', material: 'metal' },
  ],
  // Real model output carries the relative layout it was resolved from.
  layout: { ...LIBRARY.find((e) => e.keywords.includes('key'))!.design, name: 'old brass key' },
};

/** In-memory stand-in for a language model that records what it was asked. */
export function fakeTextModel(blueprint: Blueprint | ((req: DesignRequest) => Blueprint), available = true) {
  const calls: DesignRequest[] = [];
  const model: TextModel & { calls: DesignRequest[] } = {
    provider: 'fake',
    model: 'fake-1',
    calls,
    status: async () => (available ? { available: true } : { available: false, reason: 'Fake model is off.' }),
    design: async (req) => {
      calls.push(req);
      return typeof blueprint === 'function' ? blueprint(req) : blueprint;
    },
  };
  return model;
}

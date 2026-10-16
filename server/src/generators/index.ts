import { mockGenerator } from './mock';
import type { AssetGenerator } from './types';

const GENERATORS: Record<string, AssetGenerator> = {
  mock: mockGenerator,
  // Add real backends here, e.g. meshy: meshyGenerator, then set GENERATOR=meshy.
};

export function getGenerator(id = process.env.GENERATOR || 'mock'): AssetGenerator {
  const generator = GENERATORS[id];
  if (!generator) throw new Error(`Unknown GENERATOR "${id}". Available: ${Object.keys(GENERATORS).join(', ')}`);
  return generator;
}

export type * from './types';

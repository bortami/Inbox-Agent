import { ClaudeExtractor } from './claude-extractor.js';
import type { AIExtractor } from './types.js';

export function getExtractor(): AIExtractor {
  return new ClaudeExtractor();
}

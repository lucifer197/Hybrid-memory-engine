import { EntityType } from "@hybrid-memory/shared-types";

export interface ExtractedEntity {
  entity_type: EntityType;
  entity_value: string;
  confidence: number;
}

/**
 * MVP entity extractor — deterministic, no LLM.
 *
 * Strategies:
 *  1. Known tool/product dictionary
 *  2. Capitalized multi-word phrases (simple NER proxy)
 *  3. Hashtag-style tags
 *  4. Explicit tags passed from the write request
 */
export function extractEntities(
  text: string,
  tags?: string[]
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const add = (type: EntityType, value: string, confidence: number) => {
    const key = `${type}:${value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ entity_type: type, entity_value: value, confidence });
    }
  };

  // ── 1. Known tool/product dictionary ─────────────────────
  for (const [pattern, name] of KNOWN_TOOLS) {
    if (pattern.test(text)) {
      add(EntityType.Tool, name, 0.9);
    }
  }

  // ── 2. Capitalized phrases (2-3 words) ───────────────────
  const capsRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = capsRegex.exec(text)) !== null) {
    const phrase = match[1];
    // Skip common English phrases
    if (!SKIP_PHRASES.has(phrase.toLowerCase())) {
      add(EntityType.Topic, phrase, 0.6);
    }
  }

  // ── 3. Hashtags ──────────────────────────────────────────
  const hashtagRegex = /#([A-Za-z0-9_-]+)/g;
  while ((match = hashtagRegex.exec(text)) !== null) {
    add(EntityType.Topic, match[1], 0.8);
  }

  // ── 4. Explicit tags from write request ──────────────────
  if (tags?.length) {
    for (const tag of tags) {
      add(EntityType.Topic, tag, 1.0);
    }
  }

  return entities;
}

// ── Known tools dictionary ──────────────────────────────────

const KNOWN_TOOLS: [RegExp, string][] = [
  [/\bVS\s?Code\b/i, "VS Code"],
  [/\bVisual\s+Studio\s+Code\b/i, "VS Code"],
  [/\bNeovim\b/i, "Neovim"],
  [/\bVim\b/i, "Vim"],
  [/\bIntelliJ\b/i, "IntelliJ"],
  [/\bWebStorm\b/i, "WebStorm"],
  [/\bReact\b/i, "React"],
  [/\bNext\.?js\b/i, "Next.js"],
  [/\bTypeScript\b/i, "TypeScript"],
  [/\bPython\b/i, "Python"],
  [/\bPostgres(?:ql)?\b/i, "PostgreSQL"],
  [/\bRedis\b/i, "Redis"],
  [/\bDocker\b/i, "Docker"],
  [/\bKubernetes\b/i, "Kubernetes"],
  [/\bGitHub\b/i, "GitHub"],
  [/\bSlack\b/i, "Slack"],
  [/\bFigma\b/i, "Figma"],
  [/\bLinear\b/i, "Linear"],
  [/\bJira\b/i, "Jira"],
  [/\bNotion\b/i, "Notion"],
  [/\bTailwind\b/i, "Tailwind CSS"],
  [/\bNode\.?js\b/i, "Node.js"],
  [/\bGPT[-\s]?4\b/i, "GPT-4"],
  [/\bClaude\b/i, "Claude"],
  [/\bOpenAI\b/i, "OpenAI"],
  [/\bAnthropic\b/i, "Anthropic"],
];

const SKIP_PHRASES = new Set([
  "the user",
  "got it",
  "let me",
  "thank you",
  "no problem",
  "sounds good",
  "for example",
]);

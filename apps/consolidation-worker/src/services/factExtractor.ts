import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("consolidation-worker", "factExtractor");

// ── Type-specific default starting confidence ──────────────────
export const DEFAULT_CONFIDENCE: Record<string, number> = {
  preference: 0.70,
  profile: 0.70,
  project: 0.60,
  rule: 0.55,
  note: 0.50,
};

/** Returns the default starting confidence for a fact type. */
export function defaultConfidence(factType: string): number {
  return DEFAULT_CONFIDENCE[factType] ?? 0.50;
}

// ── Explicit confirmation detection ────────────────────────────
const CONFIRM_PATTERNS = [
  /\byes\b/i,
  /\bcorrect\b/i,
  /\bthat'?s?\s+right\b/i,
  /\bconfirm(?:ed)?\b/i,
  /\bexactly\b/i,
  /\babsolutely\b/i,
  /\byep\b/i,
  /\byeah\b/i,
];

/** Check if content contains explicit user confirmation language. */
export function isExplicitConfirmation(content: string): boolean {
  return CONFIRM_PATTERNS.some((p) => p.test(content));
}

/**
 * A candidate fact extracted from raw memory content.
 */
export interface ExtractedFact {
  fact_type: "preference" | "profile" | "project" | "rule" | "note";
  subject: string;
  predicate: string;
  value_text: string;
  value_json?: unknown;
  confidence: number;
  source: "user" | "assistant" | "tool";
}

/**
 * Context passed to the extractor alongside the raw text.
 */
export interface ExtractionContext {
  memoryType: string;
  tags: string[];
  entities: string[];
  hints: string[];
}

// ── Sentence-level regex patterns ──────────────────────────────

interface Pattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => ExtractedFact | null;
}

// ── Rule Group A — Preferences ─────────────────────────────────

const PREFERENCE_PATTERNS: Pattern[] = [
  // "I prefer dark mode" / "I like dark theme"
  {
    regex: /\b(?:I|i)\s+(?:prefer|like|love|enjoy|want|use)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: inferPreferencePredicate(m[1]),
      value_text: clean(m[1]),
      confidence: 0.7,
      source: "user",
    }),
  },
  // "My favorite X is Y" / "My preferred X is Y" / "My default X is Y"
  {
    regex: /\bmy\s+(?:favorite|preferred|default)\s+(\w[\w\s]*?)\s+is\s+(.+)/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: normalize(m[1]),
      value_text: clean(m[2]),
      confidence: 0.8,
      source: "user",
    }),
  },
  // "Set X to Y" / "Change X to Y"
  {
    regex: /\b(?:set|change|switch)\s+(?:my\s+)?(\w[\w\s]*?)\s+to\s+(.+)/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: normalize(m[1]),
      value_text: clean(m[2]),
      confidence: 0.75,
      source: "user",
    }),
  },
  // Keyword-specific: "dark mode" / "light mode"
  {
    regex: /\b(dark|light)\s*mode\b/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: "ide_theme",
      value_text: m[1].toLowerCase(),
      confidence: 0.85,
      source: "user",
    }),
  },
  // Keyword-specific: timezone
  {
    regex: /\b(?:my\s+)?timezone\s+(?:is\s+)?([A-Za-z_/+-]+\d*)/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: "timezone",
      value_text: m[1].trim(),
      confidence: 0.85,
      source: "user",
    }),
  },
  // Keyword-specific: favorite/preferred programming language
  {
    regex: /\b(?:favorite|preferred|main)\s+(?:programming\s+)?language\s+(?:is\s+)?(\w+)/i,
    extract: (m) => ({
      fact_type: "preference",
      subject: "user",
      predicate: "favorite_language",
      value_text: m[1].trim().toLowerCase(),
      confidence: 0.85,
      source: "user",
    }),
  },
];

// ── Rule Group B — Project facts ───────────────────────────────

const PROJECT_PATTERNS: Pattern[] = [
  // "Project X deadline is Y" / "Project X due Y"
  {
    regex: /\bproject\s+(\w[\w\s-]*?)\s+(?:deadline|due\s*(?:date)?)\s+(?:is\s+)?(.+)/i,
    extract: (m) => ({
      fact_type: "project",
      subject: `project:${normalize(m[1])}`,
      predicate: "deadline",
      value_text: clean(m[2]),
      confidence: 0.8,
      source: "user",
    }),
  },
  // "Project X uses Y" / "Project X stack is Y"
  {
    regex: /\bproject\s+(\w[\w\s-]*?)\s+(?:uses?|stack\s+(?:is\s+)?|built\s+with)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "project",
      subject: `project:${normalize(m[1])}`,
      predicate: "tech_stack",
      value_text: clean(m[2]),
      confidence: 0.75,
      source: "user",
    }),
  },
  // "Project X has component Y" / "Project X includes Y"
  {
    regex: /\bproject\s+(\w[\w\s-]*?)\s+(?:has|includes?|contains?)\s+(?:a\s+)?(?:component|service|module)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "project",
      subject: `project:${normalize(m[1])}`,
      predicate: "component",
      value_text: clean(m[2]),
      confidence: 0.7,
      source: "user",
    }),
  },
  // Generic: "Project X is/needs Y"
  {
    regex: /\b(?:the\s+)?project\s+(\w[\w\s-]*?)\s+(?:is|needs?|requires?)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "project",
      subject: `project:${normalize(m[1])}`,
      predicate: "attribute",
      value_text: clean(m[2]),
      confidence: 0.6,
      source: "user",
    }),
  },
];

// ── Rule Group C — Rules / procedures ──────────────────────────

const RULE_PATTERNS: Pattern[] = [
  // "Always X" / "Never X"
  {
    regex: /\b(always|never)\s+(use|do|include|add|write|run|deploy|test|commit)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "rule",
      subject: "user",
      predicate: `${m[1].toLowerCase()}_${m[2].toLowerCase()}`,
      value_text: clean(m[3]),
      confidence: 0.85,
      source: "user",
    }),
  },
  // "Before X, do Y" / "After X, do Y"
  {
    regex: /\b(before|after)\s+(.+?),?\s+(?:always\s+)?(?:do|run|execute)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "rule",
      subject: `workflow:${normalize(m[2])}`,
      predicate: `${m[1].toLowerCase()}_step`,
      value_text: clean(m[3]),
      confidence: 0.7,
      source: "user",
    }),
  },
  // "The workflow for X is: step1, step2, step3"
  {
    regex: /\b(?:the\s+)?(?:workflow|process|procedure)\s+(?:for\s+)?(\w[\w\s-]*?)\s+(?:is|:)\s*(.+)/i,
    extract: (m) => {
      const steps = m[2]
        .split(/[,;]|\bthen\b/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return {
        fact_type: "rule",
        subject: `workflow:${normalize(m[1])}`,
        predicate: "steps",
        value_text: steps.join(", "),
        value_json: steps,
        confidence: 0.75,
        source: "user",
      };
    },
  },
];

// ── Profile patterns ───────────────────────────────────────────

const PROFILE_PATTERNS: Pattern[] = [
  // "I am a X" / "I'm a X"
  {
    regex: /\b(?:I am|I'm)\s+(?:a\s+)?(.+)/i,
    extract: (m) => ({
      fact_type: "profile",
      subject: "user",
      predicate: "self_description",
      value_text: clean(m[1]),
      confidence: 0.6,
      source: "user",
    }),
  },
  // "My name is X"
  {
    regex: /\bmy\s+name\s+is\s+(.+)/i,
    extract: (m) => ({
      fact_type: "profile",
      subject: "user",
      predicate: "name",
      value_text: clean(m[1]),
      confidence: 0.9,
      source: "user",
    }),
  },
  // "I work at X" / "I work on X"
  {
    regex: /\bI\s+work\s+(?:at|on|for)\s+(.+)/i,
    extract: (m) => ({
      fact_type: "profile",
      subject: "user",
      predicate: "workplace",
      value_text: clean(m[1]),
      confidence: 0.7,
      source: "user",
    }),
  },
];

// ── Combine all pattern groups ─────────────────────────────────

const ALL_PATTERNS: Pattern[] = [
  ...PREFERENCE_PATTERNS,
  ...PROJECT_PATTERNS,
  ...RULE_PATTERNS,
  ...PROFILE_PATTERNS,
];

// ── Entity-based extraction ────────────────────────────────────

/**
 * Extract facts from entity list entries (e.g. "project:neptune").
 * Entities provide high-confidence structured subjects.
 */
function extractFromEntities(
  content: string,
  entities: string[]
): ExtractedFact[] {
  const results: ExtractedFact[] = [];

  for (const entity of entities) {
    if (!entity.includes(":")) continue;

    const [entityType, entityName] = entity.split(":", 2);

    if (entityType === "project") {
      // Try to find project-related content near the entity name
      const projectRegex = new RegExp(
        `\\b${escapeRegex(entityName)}\\s+(?:uses?|stack|built\\s+with|deadline|due)\\s+(.+)`,
        "i"
      );
      const match = content.match(projectRegex);
      if (match) {
        const predicate = inferProjectPredicate(match[0]);
        results.push({
          fact_type: "project",
          subject: `project:${normalize(entityName)}`,
          predicate,
          value_text: clean(match[1]),
          confidence: 0.8,
          source: "user",
        });
      }
    }

    if (entityType === "tool") {
      const toolRegex = new RegExp(
        `\\b${escapeRegex(entityName)}\\s+(?:version|setting|config)\\s+(?:is\\s+)?(.+)`,
        "i"
      );
      const match = content.match(toolRegex);
      if (match) {
        results.push({
          fact_type: "preference",
          subject: `tool:${normalize(entityName)}`,
          predicate: "config",
          value_text: clean(match[1]),
          confidence: 0.7,
          source: "user",
        });
      }
    }
  }

  return results;
}

// ── Hint/tag-based boosting ────────────────────────────────────

/**
 * Apply confidence adjustments based on memory type, tags, and hints.
 */
function applyContextBoosts(
  fact: ExtractedFact,
  ctx: ExtractionContext
): ExtractedFact {
  const adjusted = { ...fact };
  const allHints = [...ctx.tags, ...ctx.hints].map((h) => h.toLowerCase());

  // Memory type boosts
  if (ctx.memoryType === "preference" && adjusted.fact_type === "preference") {
    adjusted.confidence = Math.min(adjusted.confidence + 0.15, 1.0);
  }
  if (ctx.memoryType === "procedural" && adjusted.fact_type === "rule") {
    adjusted.confidence = Math.min(adjusted.confidence + 0.1, 1.0);
  }

  // Tag/hint boosts
  if (allHints.includes("preference") && adjusted.fact_type === "preference") {
    adjusted.confidence = Math.min(adjusted.confidence + 0.1, 1.0);
  }
  if (allHints.includes("important") || allHints.includes("pinned")) {
    adjusted.confidence = Math.min(adjusted.confidence + 0.1, 1.0);
  }
  if (allHints.includes("uncertain") || allHints.includes("maybe")) {
    adjusted.confidence = Math.max(adjusted.confidence - 0.15, 0.1);
  }

  return adjusted;
}

// ── Procedural memory → workflow facts ─────────────────────────

/**
 * For procedural memories, attempt to extract the full content as a
 * multi-step workflow fact even if no regex matches.
 */
function extractProceduralFallback(content: string): ExtractedFact | null {
  // Look for numbered steps or bullet points
  const stepPatterns = content.match(/(?:^|\n)\s*(?:\d+[.)]\s*|-\s*|\*\s*)(.+)/g);
  if (stepPatterns && stepPatterns.length >= 2) {
    const steps = stepPatterns.map((s) =>
      s.replace(/^\s*(?:\d+[.)]\s*|-\s*|\*\s*)/, "").trim()
    );
    return {
      fact_type: "rule",
      subject: "workflow:procedure",
      predicate: "steps",
      value_text: steps.join(", "),
      value_json: steps,
      confidence: 0.65,
      source: "user",
    };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════

/**
 * Extract candidate facts from raw memory content.
 *
 * Extraction pipeline:
 *   1. Sentence-level regex matching (rule groups A/B/C + profile)
 *   2. Entity-based extraction (structured subjects)
 *   3. Procedural fallback (for procedural memory_type)
 *   4. Context-based confidence boosting (tags, hints, memory_type)
 *   5. Deduplication by (subject, predicate)
 */
export function extractFacts(
  content: string,
  memoryType: string,
  tags: string[] = [],
  entities: string[] = [],
  hints: string[] = []
): ExtractedFact[] {
  const ctx: ExtractionContext = { memoryType, tags, entities, hints };
  const results: ExtractedFact[] = [];

  // ── 1. Sentence-level pattern matching ──────────────────────
  const sentences = content
    .split(/[.!?\n]+/)
    .filter((s) => s.trim().length > 5);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    for (const pattern of ALL_PATTERNS) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        const fact = pattern.extract(match);
        if (fact) {
          results.push(fact);
          break; // first match per sentence
        }
      }
    }
  }

  // ── 2. Entity-based extraction ──────────────────────────────
  if (entities.length > 0) {
    results.push(...extractFromEntities(content, entities));
  }

  // ── 3. Procedural fallback ──────────────────────────────────
  if (memoryType === "procedural" && results.length === 0) {
    const fallback = extractProceduralFallback(content);
    if (fallback) {
      results.push(fallback);
    }
  }

  // ── 4. Apply context boosts ─────────────────────────────────
  const boosted = results.map((f) => applyContextBoosts(f, ctx));

  // ── 5. Deduplicate by (subject, predicate) — keep highest confidence
  const deduped = deduplicateFacts(boosted);

  log.debug("extract_complete", {
    sentence_count: sentences.length,
    entity_count: entities.length,
    raw_facts: results.length,
    deduped_facts: deduped.length,
  });

  return deduped;
}

// ── Helpers ────────────────────────────────────────────────────

/** Remove trailing punctuation and trim. */
function clean(s: string): string {
  return s.trim().replace(/[.!?;,]+$/, "").trim();
}

/** Normalize a key: lowercase, underscores for spaces. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Escape special regex characters. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Infer predicate for preference values. */
function inferPreferencePredicate(value: string): string {
  const lower = value.toLowerCase();
  if (/dark\s*mode|light\s*mode|theme/i.test(lower)) return "ide_theme";
  if (/typescript|javascript|python|rust|go\b|java\b|c\+\+|ruby/i.test(lower))
    return "favorite_language";
  if (/vim|emacs|vscode|neovim|intellij|sublime/i.test(lower)) return "editor";
  if (/tab|space|indent/i.test(lower)) return "indentation";
  if (/timezone|tz\b/i.test(lower)) return "timezone";
  if (/font/i.test(lower)) return "font";
  if (/format|prettier|eslint|linter/i.test(lower)) return "formatter";
  return "general_preference";
}

/** Infer predicate for project-level facts. */
function inferProjectPredicate(phrase: string): string {
  const lower = phrase.toLowerCase();
  if (/deadline|due/i.test(lower)) return "deadline";
  if (/uses?|stack|built\s+with/i.test(lower)) return "tech_stack";
  if (/queue|broker/i.test(lower)) return "queue";
  if (/component|service|module/i.test(lower)) return "component";
  return "attribute";
}

/** Deduplicate facts by (subject, predicate), keeping highest confidence. */
function deduplicateFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const map = new Map<string, ExtractedFact>();
  for (const fact of facts) {
    const key = `${fact.subject}::${fact.predicate}`;
    const existing = map.get(key);
    if (!existing || fact.confidence > existing.confidence) {
      map.set(key, fact);
    }
  }
  return Array.from(map.values());
}

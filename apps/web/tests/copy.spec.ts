/**
 * Matrix section 6 - copy discipline, dash discipline, emoji discipline.
 *
 * These are source-scanning tests: they read files off disk and assert on what
 * is written there. That is deliberate. The three rules they enforce
 * ("never hardcode a user-facing string", "never use an em-dash or en-dash",
 * "never put an emoji in rendered UI code") are all invisible to `typecheck`,
 * `lint` and `build`, so nothing else in the repo can catch a violation.
 *
 * The JSX scanning uses the TypeScript compiler's own parser rather than a
 * regex. A regex over `.tsx` cannot tell a rendered string from a Tailwind
 * class name, an `href`, or a comment, and the false positives make the test
 * useless within a week.
 *
 * NOTE ON THE CHARACTERS BEING HUNTED: this file must never contain a literal
 * em-dash or en-dash, or the em-dash test would match itself. They are always
 * built from escape sequences.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import { copy } from "@/lib/copy";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

/** Always POSIX-style, so a baseline entry reads the same on Windows and CI. */
function relative(root: string, absolute: string): string {
  return absolute.slice(root.length).split("\\").join("/").replace(/^\/+/, "");
}

function listFiles(
  root: string,
  options: { extensions?: Set<string>; skipDirs: Set<string> },
): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (options.skipDirs.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      if (!options.extensions || options.extensions.has(ext)) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// 6.1 / 6.4 - JSX literal extraction
// ---------------------------------------------------------------------------

interface RenderedLiteral {
  file: string;
  text: string;
}

const USER_FACING_ATTRIBUTES = new Set([
  "title",
  "placeholder",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
]);

/** Object properties whose value is displayed, e.g. `{ href, label }` nav tables. */
const DISPLAY_PROPERTIES = new Set(["label", "title", "text", "heading"]);

function isJsxContainer(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    ts.isJsxExpression(node)
  );
}

function isEqualityComparison(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  const kind = node.operatorToken.kind;
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

/**
 * Every string that can end up in front of a user, from one file.
 *
 * Collected: JSX text nodes, string and template literals inside a JSX child
 * expression, values of user-facing attributes, and `label`-ish object
 * properties.
 *
 * Deliberately NOT collected:
 * - anything inside a nested JSX element's attributes (`className`, `href`,
 *   `sizes`, ...) - the outer walk visits those elements itself;
 * - the operands of an equality comparison (`content_kind === "stream"`), which
 *   are semantic keys, not display text;
 * - comments, which the parser never turns into literals at all.
 */
function renderedLiterals(file: string, source: string): RenderedLiteral[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: RenderedLiteral[] = [];
  const push = (text: string) => found.push({ file, text });

  const collect = (node: ts.Node): void => {
    if (isJsxContainer(node) || isEqualityComparison(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      push(node.head.text);
      for (const span of node.templateSpans) push(span.literal.text);
    }
    node.forEachChild(collect);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && node.text.trim().length > 0) push(node.text);

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      collect(node.expression);
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      if (USER_FACING_ATTRIBUTES.has(name)) {
        const value = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (value) collect(value);
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      DISPLAY_PROPERTIES.has(node.name.getText(sourceFile))
    ) {
      collect(node.initializer);
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return found;
}

/** Every string literal in a file, used only for the emoji sweep. */
function allLiterals(file: string, source: string): RenderedLiteral[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: RenderedLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && node.text.trim().length > 0) {
      found.push({ file, text: node.text });
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({ file, text: node.text });
    } else if (ts.isTemplateExpression(node)) {
      found.push({ file, text: node.head.text });
      for (const span of node.templateSpans) found.push({ file, text: span.literal.text });
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

const UI_SOURCE_FILES = [
  ...listFiles(`${WEB_ROOT}app`, {
    extensions: new Set([".tsx", ".ts"]),
    skipDirs: new Set(["node_modules"]),
  }),
  ...listFiles(`${WEB_ROOT}components`, {
    extensions: new Set([".tsx", ".ts"]),
    skipDirs: new Set(["node_modules"]),
  }),
];

/**
 * A candidate is user-facing prose when it contains a word of three or more
 * letters. Shorter fragments are units and separators (`ms`, `/`, ` - `, `(`),
 * which the matrix explicitly allows.
 */
function looksLikeProse(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return false;
  if (/^(https?:)?\//.test(text)) return false;
  return /[\p{Letter}]{3,}/u.test(text);
}

/**
 * 🚨 KNOWN DEBT, not an exemption.
 *
 * Each entry is a real violation of "never hardcode a user-facing string
 * inside a component" that already existed before this suite was written.
 * Lane C may not edit application code, so they are pinned here instead.
 *
 * The assertion below is an EXACT set match, so this list is a ratchet:
 * - a new hardcoded string fails the test;
 * - fixing one of these also fails the test, until the entry is deleted.
 *
 * The list is now EMPTY, and it must stay that way. Both original entries were
 * fixed rather than left pinned:
 *   app/page.tsx "1 channel" / "channels"
 *     -> `copy.channels.channelCount(n)`, mirroring `channels.episodeCount(n)`.
 *   app/channels/[slug]/page.tsx "avg"
 *     -> `copy.grid.seasonAverage(...)`, which already renders "<n> avg".
 *
 * Do not add an entry here to make a failing build pass. Move the string into
 * lib/copy.ts instead - that is the entire point of the rule.
 */
const KNOWN_HARDCODED_STRINGS: ReadonlyArray<string> = [];

describe("6.1 no hardcoded user-facing strings in components", () => {
  const violations = UI_SOURCE_FILES.flatMap((file) =>
    renderedLiterals(file, readFileSync(file, "utf8"))
      .filter((literal) => looksLikeProse(literal.text))
      .map((literal) => `${relative(WEB_ROOT, literal.file)} :: ${literal.text.trim()}`),
  );
  const unique = [...new Set(violations)].sort();

  it("scans a meaningful number of files, so a silent pass is impossible", () => {
    expect(UI_SOURCE_FILES.length).toBeGreaterThan(10);
    expect(UI_SOURCE_FILES.some((file) => file.endsWith("page.tsx"))).toBe(true);
    expect(UI_SOURCE_FILES.some((file) => file.endsWith("EpisodeCard.tsx"))).toBe(true);
  });

  it("finds no hardcoded string beyond the pinned known-debt list", () => {
    // An exact match in both directions: this list may only shrink.
    expect(unique).toEqual([...KNOWN_HARDCODED_STRINGS].sort());
  });

  it("proves the scanner actually detects a hardcoded string", () => {
    const probe = renderedLiterals(
      "probe.tsx",
      'export const X = () => <p title="Tooltip text">Hardcoded heading</p>;',
    )
      .map((literal) => literal.text.trim())
      .filter(looksLikeProse);

    expect(probe).toContain("Hardcoded heading");
    expect(probe).toContain("Tooltip text");
  });

  it("does not flag class names, hrefs, semantic keys or comments", () => {
    const probe = renderedLiterals(
      "probe.tsx",
      [
        "export const X = ({ kind, label }: { kind: string; label: string }) => (",
        '  <div className="flex items-center gap-2 text-muted-foreground">',
        '    {/* a comment mentioning something readable */}',
        '    <a href="/episodes?sort=newest">{label}</a>',
        '    {kind === "stream" ? <span className="rounded bg-red-500">{label}</span> : null}',
        "  </div>",
        ");",
      ].join("\n"),
    )
      .map((literal) => literal.text.trim())
      .filter(looksLikeProse);

    expect(probe).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6.2 - copy key reachability (warn only, per the matrix)
// ---------------------------------------------------------------------------

function flattenCopyKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? flattenCopyKeys(child, prefix ? `${prefix}.${key}` : key)
      : [prefix ? `${prefix}.${key}` : key],
  );
}

/**
 * Strip comments before scanning for `copy.*` references.
 *
 * Without this, a comment that merely MENTIONS the copy module - e.g.
 * "put the string in `lib/copy.ts`" - matches the reference regex as the key
 * `copy.ts`, which resolves to nothing and fails the test. That is a false
 * positive on prose, and it fired twice in one afternoon.
 *
 * `[^:]` in the line-comment pattern protects `https://...` from being treated
 * as the start of a comment.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("6.2 copy keys", () => {
  const consumers = [
    ...UI_SOURCE_FILES,
    ...listFiles(`${WEB_ROOT}lib`, {
      extensions: new Set([".ts", ".tsx"]),
      skipDirs: new Set(["node_modules"]),
    }),
  ].filter((file) => !file.endsWith("lib/copy.ts"));

  const sources = consumers
    .map((file) => stripComments(readFileSync(file, "utf8")))
    .join("\n");
  /**
   * A reference is `copy.<key>`, NOT a path ending in the copy module.
   * `lib/copy.ts` and `https://x/copy.ts` are filenames; the leading `/` is what
   * tells them apart from real code. Comment stripping above handles prose; this
   * lookbehind handles the same mention appearing inside a string literal, which
   * stripping cannot reach.
   */
  const referenced = new Set(
    [...sources.matchAll(/(?<![\w/.])copy\.([A-Za-z0-9_.]+)/g)].map((match) =>
      match[1].replace(/\.$/, ""),
    ),
  );
  const declared = new Set(flattenCopyKeys(copy));
  /**
   * Group prefixes count as resolvable too: `copy.health.dependencies[key]` is a
   * legitimate dynamic lookup, and prose in a comment can mention `copy.errors`.
   * A typo still fails, because a misspelled group is not a declared prefix.
   */
  const declaredPrefixes = new Set(
    [...declared].flatMap((key) => {
      const parts = key.split(".");
      return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("."));
    }),
  );

  it("every copy.* reference in the app resolves to a real key", () => {
    // A typo here renders `undefined` in the UI and nothing else catches it.
    const missing = [...referenced].filter(
      (key) => !declared.has(key) && !declaredPrefixes.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("a misspelled copy key would be caught", () => {
    for (const typo of ["errrors.timeout", "errors.notfound", "grid.titel"]) {
      expect(declared.has(typo) || declaredPrefixes.has(typo)).toBe(false);
    }
  });

  /**
   * `stripComments` makes this scan more permissive, so it has to be proven that
   * it only removes prose and still sees real code. Without this, silently
   * over-stripping would turn 6.2 into a test that passes by seeing nothing.
   */
  it("ignores copy mentions in comments but still sees real references", () => {
    const probe = stripComments(
      [
        "// put the string in `lib/copy.ts` instead",
        "/* see lib/copy.ts for the full list */",
        'const url = "https://example.com/copy.ts";',
        "const a = copy.grid.title;",
        "const b = copy.errors.timeout;",
      ].join("\n"),
    );
    const found = [...probe.matchAll(/(?<![\w/.])copy\.([A-Za-z0-9_.]+)/g)].map(
      (m) => m[1],
    );

    // The two real references survive...
    expect(found).toContain("grid.title");
    expect(found).toContain("errors.timeout");
    // ...and the prose mentions do not become the bogus key `ts`.
    expect(found).not.toContain("ts");
    // The https:// URL must not be mistaken for a line comment, so the code
    // after it on later lines is still scanned - proven by the two hits above.
    expect(probe).toContain("https://example.com");
  });

  it("the app actually reads from lib/copy.ts", () => {
    expect(referenced.size).toBeGreaterThan(20);
  });

  it("reports unused copy keys as a warning, never as a failure", () => {
    const unused = [...declared].filter((key) => !referenced.has(key)).sort();
    if (unused.length > 0) {
      // Warn only: a key may be staged ahead of the wave that consumes it.
      console.warn(`[6.2] copy keys with no consumer yet (${unused.length}):\n  ${unused.join("\n  ")}`);
    }
    expect(declared.size).toBeGreaterThan(unused.length);
  });
});

// ---------------------------------------------------------------------------
// 6.3 - no em-dash or en-dash
// ---------------------------------------------------------------------------

/**
 * Files that legitimately contain a dash we do not own. Each must still exist,
 * so the exclusion list cannot quietly become a blanket.
 */
const DASH_EXEMPT_FILES: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: "apps/web/AGENTS.md",
    why: "written and re-added by `next dev` itself; not ours to edit",
  },
  {
    path: "docs/00-build-brief.html",
    why: "the original product brief, kept verbatim as handed over",
  },
  {
    path: "docs/01-canonical-models.py",
    why: "the canonical schema, kept verbatim as handed over with the brief",
  },
  {
    path: "Designs/design_handoff_podcast_index/design_files/support.js",
    why: "the design bundle's own template runtime, kept verbatim as handed over",
  },
];

describe("6.3 no em-dash or en-dash anywhere in the repo", () => {
  const exempt = new Set(DASH_EXEMPT_FILES.map((entry) => entry.path));
  const files = listFiles(REPO_ROOT, {
    extensions: new Set([
      ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx",
      ".py", ".css", ".json", ".md", ".html", ".yml", ".yaml", ".toml", ".sql",
    ]),
    skipDirs: new Set([
      "node_modules", ".next", ".git", ".turbo", ".venv", "venv",
      "__pycache__", ".pytest_cache", "dist", "build",
      "test-results", "playwright-report", ".vercel", "staticfiles",
      // Generated scratch output, already in .gitignore. `manage.py
      // export_review_page` writes real episode titles here, and a YouTube
      // title may legitimately contain an em-dash - which is the author's, not
      // ours. Every other entry in this list is generated or vendored for the
      // same reason.
      "tmp",
    ]),
  });

  it("scans the whole repo, not an empty set", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every exemption still points at a real file", () => {
    for (const entry of DASH_EXEMPT_FILES) {
      expect(
        statSync(`${REPO_ROOT}${entry.path}`).isFile(),
        `stale dash exemption: ${entry.path} (${entry.why})`,
      ).toBe(true);
    }
  });

  it("contains no U+2014 and no U+2013", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (exempt.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes(EM_DASH) || line.includes(EN_DASH)) {
          offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("lib/copy.ts, the whole user-facing surface, is clean", () => {
    const source = readFileSync(`${WEB_ROOT}lib/copy.ts`, "utf8");
    expect(source.includes(EM_DASH)).toBe(false);
    expect(source.includes(EN_DASH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6.4 - no emoji in rendered UI code
// ---------------------------------------------------------------------------

/**
 * Extended_Pictographic covers the emoji block; Regional_Indicator covers flag
 * pairs such as the Bulgarian flag, which is two regional indicators and is not
 * itself pictographic.
 */
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

describe("6.4 no emoji in rendered UI code", () => {
  it("no .tsx or .ts under app/ or components/ has an emoji in a string literal", () => {
    const offenders: string[] = [];
    for (const file of UI_SOURCE_FILES) {
      for (const literal of allLiterals(file, readFileSync(file, "utf8"))) {
        if (EMOJI_PATTERN.test(literal.text)) {
          offenders.push(`${relative(WEB_ROOT, file)} :: ${literal.text.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/copy.ts carries no emoji - icons are the component layer's job", () => {
    const file = `${WEB_ROOT}lib/copy.ts`;
    const offenders = allLiterals(file, readFileSync(file, "utf8")).filter((literal) =>
      EMOJI_PATTERN.test(literal.text),
    );
    expect(offenders.map((literal) => literal.text)).toEqual([]);
  });

  it("comments may keep emoji - the rule is about rendered output only", () => {
    const literals = allLiterals(
      "probe.tsx",
      ["// a comment with an emoji \u{1F1E7}\u{1F1EC}", 'export const X = "clean";'].join("\n"),
    );
    expect(literals.some((literal) => EMOJI_PATTERN.test(literal.text))).toBe(false);
  });

  it("proves the emoji scanner actually detects one in rendered output", () => {
    const literals = allLiterals("probe.tsx", 'export const X = () => <p>\u{2B50} star</p>;');
    expect(literals.some((literal) => EMOJI_PATTERN.test(literal.text))).toBe(true);
  });
});

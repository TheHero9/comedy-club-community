/**
 * Query tokenisation on the web side: the title split and the highlighter.
 *
 * 🇧🇬 Both of these used to treat a query as one opaque string, and both were
 * therefore broken on exactly the queries this app exists for. A Bulgarian
 * multi-word query is essentially never a literal substring of a title or a
 * label, so `title.includes(query)` put everything in one bucket and
 * `indexOf(query)` highlighted nothing.
 */
import { describe, expect, it } from "vitest";

import { highlightRuns, queryTokens, titleMatchesQuery } from "@/lib/search-tokens";

describe("queryTokens", () => {
  it("drops function words that would match any text", () => {
    expect(queryTokens("историята с колата")).toEqual(["историята", "колата"]);
  });

  it("drops tokens too short to be a useful needle", () => {
    // A two-character needle matches most titles in the catalogue.
    expect(queryTokens("на by от")).toEqual([]);
  });

  it("folds case with the Bulgarian locale", () => {
    expect(queryTokens("КАСПАРОВ")).toEqual(["каспаров"]);
  });
});

describe("titleMatchesQuery", () => {
  it("matches on any single word of a multi-word query", () => {
    expect(
      titleMatchesQuery("Извънземни в Царичина - ИСТИНАТА", "извънземни в царичина"),
    ).toBe(true);
  });

  it("does not match when no meaningful word is present", () => {
    expect(titleMatchesQuery("Нещо съвсем друго", "извънземни царичина")).toBe(false);
  });

  it("falls back to the whole string when every word is too short", () => {
    // Otherwise the section would be empty for a reason the reader cannot see.
    expect(titleMatchesQuery("Кой е на линия", "на")).toBe(true);
    expect(titleMatchesQuery("Нещо друго", "на")).toBe(false);
  });
});

describe("highlightRuns", () => {
  /** The runs must always reassemble into the original text, exactly. */
  function reassemble(text: string, query: string): string {
    return highlightRuns(text, query)
      .map((run) => run.text)
      .join("");
  }

  it("highlights each query word separately", () => {
    const runs = highlightRuns("историята за колата на Иван", "историята с колата");
    const hits = runs.filter((run) => run.hit).map((run) => run.text);
    expect(hits).toEqual(["историята", "колата"]);
  });

  it("is the bug it was written for: a two-word query used to highlight nothing", () => {
    // `"историята за колата".indexOf("историята с колата")` is -1, so the old
    // whole-string implementation returned the text with no highlight at all.
    const runs = highlightRuns("историята за колата", "историята с колата");
    expect(runs.some((run) => run.hit)).toBe(true);
  });

  it("never loses or duplicates a character", () => {
    const text = "Историята за колата и още нещо";
    expect(reassemble(text, "историята колата")).toBe(text);
    expect(reassemble(text, "нищо такова")).toBe(text);
    expect(reassemble(text, "")).toBe(text);
  });

  it("prefers the longer token when two start at the same character", () => {
    const runs = highlightRuns("колата е тук", "кола колата");
    expect(runs.find((run) => run.hit)?.text).toBe("колата");
  });

  it("returns one plain run when nothing matches", () => {
    // 🚨 A highlight on the wrong word is worse than none: it claims a match
    // that did not happen, and search is typo tolerant so the matched text
    // often does not contain the query at all.
    const runs = highlightRuns("нещо съвсем друго", "каспаров");
    expect(runs).toEqual([{ text: "нещо съвсем друго", hit: false }]);
  });

  it("matches case-insensitively but preserves the original casing", () => {
    const runs = highlightRuns("Каспаров игра шах", "каспаров");
    expect(runs.find((run) => run.hit)?.text).toBe("Каспаров");
  });
});

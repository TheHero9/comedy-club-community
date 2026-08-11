/**
 * The browse filter model, and the constant it shares with the API.
 *
 * 🚨 `MAX_API_LIMIT` here must equal `MAX_LIMIT` in `podcast/api/public.py`.
 * It did not, and that was a real 500: the web app clamped `limit` to 200 while
 * the API declared `Query(24, ge=1, le=100)`, so anything above 100 was
 * forwarded verbatim, rejected with a 422, and thrown out of a server component
 * as an error page.
 *
 * It was not only reachable by hand-editing a URL. "Зареди още" adds PAGE_SIZE
 * to `limit` on every click, so on a 1,393-episode catalogue the ELEVENTH click
 * (9 -> 108) crossed the ceiling and served a 500 to an ordinary user.
 *
 * So this file parses the Python source rather than restating the number, in
 * the same spirit as `score-bands.spec.ts` parsing `services/grid.py`. Two
 * copies of a limit cannot disagree if only one of them is authored.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  isAtLimitCeiling,
  KIND_OPTIONS,
  MAX_API_LIMIT,
  PAGE_SIZE,
  readFilters,
  SORT_OPTIONS,
  toApiQuery,
  toSearchParams,
} from "@/components/browse/filter-model";

const PUBLIC_API_PY = path.resolve(
  __dirname,
  "../../api/podcast/api/public.py",
);

describe("MAX_API_LIMIT agrees with the API", () => {
  it("matches MAX_LIMIT in podcast/api/public.py", () => {
    const source = readFileSync(PUBLIC_API_PY, "utf8");
    const match = source.match(/^MAX_LIMIT\s*=\s*(\d+)/m);

    expect(
      match,
      "could not find MAX_LIMIT in public.py - has it been renamed?",
    ).not.toBeNull();

    expect(
      MAX_API_LIMIT,
      "the web clamp and the API ceiling have drifted apart; anything above " +
        "the API's limit is a 422 and therefore a 500 page",
    ).toBe(Number(match![1]));
  });

  it("the episodes endpoint really is declared with that ceiling", () => {
    const source = readFileSync(PUBLIC_API_PY, "utf8");

    // Guards the test above: if `limit` stopped using MAX_LIMIT, matching the
    // constant would prove nothing about the endpoint.
    expect(source).toMatch(/limit:\s*int\s*=\s*Query\(\s*24,\s*ge=1,\s*le=MAX_LIMIT\s*\)/);
  });
});

describe("readFilters clamps and coerces limit", () => {
  const read = (query: Record<string, string>) => readFilters(query);

  it("defaults to one page when absent", () => {
    expect(read({}).limit).toBe(PAGE_SIZE);
  });

  it.each(["abc", "", "NaN", "-5", "0", "0.4"])(
    "falls back to the page size for %o",
    (limit) => {
      expect(read({ limit }).limit).toBe(PAGE_SIZE);
    },
  );

  it("never exceeds the API ceiling", () => {
    for (const limit of ["101", "200", "99999999", "1e12"]) {
      expect(read({ limit }).limit).toBeLessThanOrEqual(MAX_API_LIMIT);
    }
  });

  it("truncates a fractional limit to an integer", () => {
    // `Number("2.5")` is finite and positive, so this used to reach the API as
    // a float and come back 422.
    expect(read({ limit: "2.5" }).limit).toBe(2);
    expect(Number.isInteger(read({ limit: "2.5" }).limit)).toBe(true);
    expect(Number.isInteger(read({ limit: "99.9" }).limit)).toBe(true);
  });

  it("passes an integer to the API for every input it accepts", () => {
    for (const limit of ["1", "2.5", "9", "100", "99999999", "abc", "-1"]) {
      const value = toApiQuery(read({ limit })).limit;
      expect(Number.isInteger(value), `limit=${limit} produced ${value}`).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(MAX_API_LIMIT);
    }
  });
});

describe("readFilters allow-lists the enumerated groups", () => {
  it("rejects an unknown sort", () => {
    expect(readFilters({ sort: "'; DROP TABLE" }).sort).toBe(DEFAULT_SORT);
  });

  it("accepts every declared sort", () => {
    for (const option of SORT_OPTIONS) {
      expect(readFilters({ sort: option.value }).sort).toBe(option.value);
    }
  });

  it("rejects an unknown kind", () => {
    expect(readFilters({ kind: "banana" }).kind).toBe("");
  });

  it("accepts every declared kind", () => {
    for (const option of KIND_OPTIONS) {
      expect(readFilters({ kind: option.value }).kind).toBe(option.value);
    }
  });

  it("takes the first value when a param is repeated", () => {
    expect(readFilters({ sort: ["top", "oldest"] as never }).sort).toBe("top");
  });
});

describe("readFilters strips control characters from slugs", () => {
  it("removes a NUL byte", () => {
    // A NUL is legal in a URL and only fails at the database. The API rejects
    // it with a 400, and an unhandled 400 in a server component is a 500 page.
    expect(readFilters({ channel: "a\u0000b" }).channel).toBe("ab");
    expect(readFilters({ person: "a\u0000b" }).person).toBe("ab");
  });

  it.each(["\u0001", "\u001F", "\u007F", "\u009F"])(
    "removes control character %o",
    (control) => {
      expect(readFilters({ channel: `x${control}y` }).channel).toBe("xy");
    },
  );

  it("🇧🇬 leaves Cyrillic completely alone", () => {
    // The whole product is Bulgarian. A sanitiser that ate Cyrillic would break
    // every real channel slug while passing the tests above.
    const slug = "комеди-клуб-подкаст";
    expect(readFilters({ channel: slug }).channel).toBe(slug);
    expect(readFilters({ person: "Иван Кирков" }).person).toBe("Иван Кирков");
  });

  it("leaves ordinary punctuation alone", () => {
    expect(readFilters({ channel: "ivan-kirkov" }).channel).toBe("ivan-kirkov");
  });
});

describe("isAtLimitCeiling", () => {
  it("is false for a normal page", () => {
    expect(isAtLimitCeiling(readFilters({}))).toBe(false);
  });

  it("is true once the clamp has been reached", () => {
    expect(isAtLimitCeiling(readFilters({ limit: String(MAX_API_LIMIT) }))).toBe(true);
    expect(isAtLimitCeiling(readFilters({ limit: "99999999" }))).toBe(true);
  });
});

describe("toSearchParams round-trips", () => {
  it("drops defaults so a clean URL stays clean", () => {
    expect(toSearchParams(readFilters({}))).toBe("");
  });

  it("survives a round trip through the URL", () => {
    const original = readFilters({
      sort: "top",
      kind: "stream",
      channel: "ivan-kirkov",
      limit: "27",
    });

    const params = new URLSearchParams(toSearchParams(original).slice(1));
    const round = readFilters(Object.fromEntries(params.entries()));

    expect(round).toEqual(original);
  });

  it("round-trips a Cyrillic channel slug", () => {
    const original = readFilters({ channel: "комеди-клуб-подкаст" });
    const params = new URLSearchParams(toSearchParams(original).slice(1));

    expect(readFilters(Object.fromEntries(params.entries()))).toEqual(original);
  });
});

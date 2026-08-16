import { describe, expect, it } from "vitest";

import {
  formatTimestampInput,
  maskTimestampInput,
  parseTimestamp,
} from "@/lib/timestamp";

/**
 * 🚨 This file guards a client-side MIRROR of `podcast/services/timestamps.py`.
 * The API re-parses everything and is the authority; these tests exist so the
 * instant feedback agrees with it, not so the API can trust the client.
 */
describe("parseTimestamp", () => {
  it("reads every accepted shape", () => {
    expect(parseTimestamp("1:30:29").seconds).toBe(5429);
    expect(parseTimestamp("30:29").seconds).toBe(1829);
    expect(parseTimestamp("4:05").seconds).toBe(245);
    expect(parseTimestamp("45").seconds).toBe(45);
  });

  it("lets the leading part exceed 60, so 90:00 is ninety minutes", () => {
    expect(parseTimestamp("90:00").seconds).toBe(5400);
  });

  it("treats a blank field as no timestamp, NOT as an error", () => {
    // 🚨 The whole point of the 2026-08-16 change: a moment without a time is
    // a note about the episode. `ok` must be true and `seconds` must be null.
    for (const blank of ["", "   "]) {
      const parsed = parseTimestamp(blank);
      expect(parsed.ok).toBe(true);
      expect(parsed.seconds).toBeNull();
      expect(parsed.errorKey).toBeUndefined();
    }
  });

  it("still refuses a typo, because blank and malformed are different inputs", () => {
    // "4:75" is not 5:15. Reinterpreting it would deep-link the video to a
    // second the member never meant.
    expect(parseTimestamp("4:75").errorKey).toBe("overSixty");
    expect(parseTimestamp("1:2:3:4").errorKey).toBe("tooLong");
    expect(parseTimestamp("abc").errorKey).toBe("malformed");
    expect(parseTimestamp("-5").errorKey).toBe("malformed");
    expect(parseTimestamp("1.5").errorKey).toBe("malformed");
    // Full-width digits: `Number()` accepts them, the member did not type them.
    expect(parseTimestamp("５").errorKey).toBe("malformed");
  });

  it("round-trips through formatTimestampInput", () => {
    for (const seconds of [0, 45, 245, 1829, 5429]) {
      expect(parseTimestamp(formatTimestampInput(seconds)).seconds).toBe(seconds);
    }
  });
});

describe("maskTimestampInput", () => {
  it("punctuates digits so the colon never has to be typed", () => {
    // 🚨 The bug this fixes: `inputMode="numeric"` is a digits-only keypad on
    // a phone, so ":" was unreachable on the device most of this audience uses.
    expect(maskTimestampInput("13029")).toBe("1:30:29");
    expect(maskTimestampInput("455")).toBe("4:55");
    expect(maskTimestampInput("9000")).toBe("90:00");
  });

  it("leaves one and two digits alone, so seconds-only input still works", () => {
    expect(maskTimestampInput("4")).toBe("4");
    expect(maskTimestampInput("45")).toBe("45");
  });

  it("makes every prefix of a real time a real time", () => {
    // Typing 1:30:29 one digit at a time must never pass through a state the
    // parser rejects - otherwise the field shouts at you mid-word.
    const seen = ["1", "13", "130", "1302", "13029"].map(maskTimestampInput);
    expect(seen).toEqual(["1", "13", "1:30", "13:02", "1:30:29"]);
    for (const step of seen) {
      expect(parseTimestamp(step).ok).toBe(true);
    }
  });

  it("accepts a pasted, already-punctuated value", () => {
    expect(maskTimestampInput("1:30:29")).toBe("1:30:29");
    expect(maskTimestampInput("30:29")).toBe("30:29");
  });

  it("keeps an emptied field empty, since the time is optional", () => {
    expect(maskTimestampInput("")).toBe("");
    expect(maskTimestampInput("abc")).toBe("");
  });

  it("caps at h:mm:ss rather than growing without limit", () => {
    expect(maskTimestampInput("123456789")).toBe("12:34:56");
  });

  it("does NOT validate - a typo survives to the parser", () => {
    // 🚨 Deliberate. Masking "475" into 5:15 would be the silent rewrite the
    // strict 60 rule exists to prevent; it stays "4:75" and gets refused.
    expect(maskTimestampInput("475")).toBe("4:75");
    expect(parseTimestamp(maskTimestampInput("475")).ok).toBe(false);
  });
});

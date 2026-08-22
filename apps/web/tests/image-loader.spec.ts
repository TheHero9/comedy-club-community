/**
 * The image loader, and the config ladder it is one half of.
 *
 * 🚨 This exists because the failure it guards is INVISIBLE until it is
 * expensive. On 2026-08-22 every thumbnail on the production site disappeared:
 * `/_next/image` had exhausted its transformation allowance and was answering
 * `402 Payment Required` to every width not already in the edge cache. Nothing
 * in the repo could see it - typecheck, lint and build all pass whether images
 * are billed or free, and locally the optimizer never runs out.
 *
 * So the invariants are asserted directly:
 *   - the loader never returns a `/_next/image` URL (that IS the bill)
 *   - it never asks for a YouTube size larger than the one it was handed
 *     (only `mqdefault` and `hqdefault` are guaranteed to exist)
 *   - the config ladder and the loader's thresholds still agree
 *
 * The last one is the subtle one: they are two files, and a ladder entry with
 * no matching threshold silently sends a phone to the 1,280px source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import loader from "../lib/image-loader";

const VIDEO = "D2yanlVBl-s";
const MAXRES = `https://img.youtube.com/vi/${VIDEO}/maxresdefault.jpg`;
const HQ = `https://img.youtube.com/vi/${VIDEO}/hqdefault.jpg`;
const AVATAR =
  "https://yt3.googleusercontent.com/abc123hash=s480-c-k-c0x00ffffff-no-rj";

/** Every width the browser can ever be offered. Mirrors `deviceSizes`+`imageSizes`. */
const ALL_WIDTHS = [64, 128, 256, 320, 828, 1280];

describe("the loader never reaches the paid optimizer", () => {
  it("returns an absolute Google URL for every width of every source", () => {
    for (const src of [MAXRES, HQ, AVATAR]) {
      for (const width of ALL_WIDTHS) {
        const out = loader({ src, width });
        expect(out).not.toContain("/_next/image");
        expect(out).toMatch(/^https:\/\//);
      }
    }
  });

  it("passes an unrecognised source through untouched", () => {
    expect(loader({ src: "/icons/badge.png", width: 48 })).toBe(
      "/icons/badge.png",
    );
  });
});

describe("it only ever picks a size YouTube is known to have", () => {
  it("maps the small widths onto the two guaranteed buckets", () => {
    expect(loader({ src: MAXRES, width: 320 })).toContain("mqdefault.jpg");
    expect(loader({ src: MAXRES, width: 828 })).toContain("hqdefault.jpg");
  });

  it("keeps the video id when it swaps the variant", () => {
    expect(loader({ src: MAXRES, width: 320 })).toBe(
      `https://img.youtube.com/vi/${VIDEO}/mqdefault.jpg`,
    );
  });

  it("hands back the API's own URL above the last threshold, never a guess", () => {
    expect(loader({ src: MAXRES, width: 1280 })).toBe(MAXRES);
  });

  it("🚨 never upgrades an hqdefault source to maxresdefault", () => {
    // The API stores hqdefault precisely when maxresdefault was probed and
    // found ABSENT. Naming the bigger file here would render a broken image.
    expect(loader({ src: HQ, width: 1280 })).toBe(HQ);
  });

  it("accepts the i.ytimg.com form of the same CDN", () => {
    const alt = `https://i.ytimg.com/vi/${VIDEO}/maxresdefault.jpg`;
    expect(loader({ src: alt, width: 320 })).toBe(
      `https://i.ytimg.com/vi/${VIDEO}/mqdefault.jpg`,
    );
  });
});

describe("avatars re-derive their size suffix, and only downwards", () => {
  it("shrinks the =sNNN token to the requested width", () => {
    expect(loader({ src: AVATAR, width: 64 })).toContain("=s64-c-k-");
  });

  it("leaves the URL alone rather than upscaling past the stored size", () => {
    expect(loader({ src: AVATAR, width: 1280 })).toBe(AVATAR);
  });

  it("does not touch a banner's =wNNN token", () => {
    const banner = "https://yt3.googleusercontent.com/hash=w1707-no-rj";
    expect(loader({ src: banner, width: 640 })).toBe(banner);
  });
});

describe("the config ladder and the loader thresholds agree", () => {
  const loaderSource = readFileSync(
    path.join(__dirname, "..", "lib", "image-loader.ts"),
    "utf8",
  );
  const configSource = readFileSync(
    path.join(__dirname, "..", "next.config.ts"),
    "utf8",
  );

  const threshold = (name: string) => {
    const match = new RegExp(name + " = ([0-9]+)").exec(loaderSource);
    if (!match) throw new Error(`${name} not found in lib/image-loader.ts`);
    return Number(match[1]);
  };

  const deviceSizes = () => {
    const match = /deviceSizes: \[([0-9, ]+)\]/.exec(configSource);
    if (!match) throw new Error("deviceSizes not found in next.config.ts");
    return match[1].split(",").map((n) => Number(n.trim()));
  };

  it("wires the loader in at all", () => {
    // Deleting this line is how the paid optimizer comes back silently.
    expect(configSource).toContain('loaderFile: "./lib/image-loader.ts"');
  });

  it("offers a candidate at each threshold, so no width has to jump past one", () => {
    const sizes = deviceSizes();
    expect(sizes).toContain(threshold("MQDEFAULT_MAX_WIDTH"));
    expect(sizes).toContain(threshold("HQDEFAULT_MAX_WIDTH"));
  });

  it("caps the ladder at the widest thumbnail YouTube has", () => {
    expect(Math.max(...deviceSizes())).toBe(1280);
  });

  it("🚨 keeps the 828 rung that stops a 2x phone reaching for 1280", () => {
    // ~780px is what a 390px phone at 2x asks for. Without a rung just above
    // it, a 24-card page costs ~5 MB instead of ~500 KB.
    expect(threshold("HQDEFAULT_MAX_WIDTH")).toBeGreaterThanOrEqual(780);
  });
});

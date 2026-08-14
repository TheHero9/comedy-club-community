/**
 * DOM attribute names read at runtime.
 *
 * ⚠️ These live in `lib/` on purpose. `tests/copy.spec.ts` parses every `.ts`
 * and `.tsx` under `app/` and `components/` and treats any three-letter string
 * literal there as display copy, so an inline `getAttribute("aria-label")` in a
 * component fails the suite. It is not user-facing copy, so it does not belong
 * in `lib/copy.ts` either.
 */
export const ARIA_LABEL_ATTR = "aria-label";

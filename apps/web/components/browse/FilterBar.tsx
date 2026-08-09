"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import {
  isDefault,
  PAGE_SIZE,
  toSearchParams,
  type ActiveFilters,
  type FilterGroup,
  type FilterGroupDef,
} from "@/components/browse/filter-model";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The active-filter bar and the filter sheet behind it.
 *
 * Filters live in the URL, so this component only ever pushes a new one - it
 * holds no filter state of its own. That is what makes a filtered view
 * shareable and what stops the chips and the grid from disagreeing.
 *
 * `scroll: false` on every push matters: changing a filter should re-render the
 * results under the bar you are looking at, not throw you back to the top of
 * the page.
 */
interface FilterBarProps {
  filters: ActiveFilters;
  groups: FilterGroupDef[];
  /** Live total for the current filters, shown on the apply button. */
  total: number;
}

export function FilterBar({ filters, groups, total }: FilterBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function apply(next: Partial<ActiveFilters>) {
    // Any filter change resets pagination: keeping a limit of 36 across a
    // change would silently deep-load a different result set.
    router.push(`/episodes${toSearchParams({ ...filters, ...next, limit: PAGE_SIZE })}`, {
      scroll: false,
    });
  }

  const active = groups
    .flatMap((group) => {
      const value = filters[group.group];
      if (!value) return [];
      if (group.required && value === group.options[0]?.value) return [];
      const option = group.options.find((item) => item.value === value);
      if (!option) return [];
      return [{ group: group.group, prefix: group.chipPrefix, label: option.label }];
    })
    .filter(Boolean);

  function clearGroup(group: FilterGroup) {
    apply({ [group]: group === "sort" ? "newest" : "" } as Partial<ActiveFilters>);
  }

  return (
    <>
      <div className="noscroll -mx-4 mt-3.5 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:px-0">
        <Button
          variant="primary"
          size="lg"
          shape="pill"
          onClick={() => setOpen(true)}
          className="shrink-0 px-3.5 text-[13.5px]"
        >
          <SlidersHorizontal className="size-[15px]" aria-hidden strokeWidth={2.4} />
          {active.length > 0
            ? copy.browse.filtersWithCount(active.length)
            : copy.browse.filters}
        </Button>

        {active.map((chip) => (
          <Button
            key={`${chip.group}-${chip.label}`}
            variant="outline"
            size="lg"
            onClick={() => clearGroup(chip.group)}
            aria-label={copy.browse.removeFilter(chip.label)}
            className="shrink-0 px-3 text-[13px] font-normal"
          >
            {chip.prefix ? (
              <span className="text-subtle-foreground">{chip.prefix}</span>
            ) : null}
            {chip.label}
            <X className="size-3 text-subtle-foreground" aria-hidden strokeWidth={2.8} />
          </Button>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen} title={copy.browse.filters} hideTitle>
        <div className="flex items-center justify-between">
          <span className="font-display text-[17px] font-bold">
            {copy.browse.filters}
          </span>
          <Button
            variant="ghost"
            size="xs"
            shape="pill"
            className="px-0 text-[13.5px]"
            onClick={() => {
              setOpen(false);
              router.push("/episodes", { scroll: false });
            }}
            disabled={isDefault(filters)}
          >
            {copy.browse.clear}
          </Button>
        </div>

        {groups.map((group) => (
          <fieldset key={group.group} className="mt-4.5">
            <legend className="text-eyebrow">{group.title}</legend>
            <div className="mt-2.5 flex flex-wrap gap-[7px]">
              {group.options.map((option) => {
                const selected = filters[group.group] === option.value;
                return (
                  <Button
                    key={option.value}
                    variant={selected ? "primary" : "outline"}
                    size="md"
                    aria-pressed={selected}
                    className="font-normal"
                    onClick={() =>
                      apply({
                        [group.group]:
                          selected && !group.required ? "" : option.value,
                      } as Partial<ActiveFilters>)
                    }
                  >
                    {option.label}
                    {option.count !== undefined ? (
                      <span
                        className={cn(
                          "font-mono text-[11px] tabular",
                          selected ? "opacity-70" : "text-subtle-foreground",
                        )}
                      >
                        {option.count}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <Button
          variant="primary"
          size="2xl"
          block
          className="mt-5.5"
          onClick={() => setOpen(false)}
        >
          {copy.browse.apply(total)}
        </Button>
      </Sheet>
    </>
  );
}

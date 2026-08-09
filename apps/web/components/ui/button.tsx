import Link from "next/link";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 💊 Almost every interactive surface in this design is a pill (radius 99).
 * That is a deliberate signature, so `pill` is the default shape and a squared
 * corner is the exception, not the other way round.
 *
 * Press is `scale(0.97)` over 160ms with no shadow change; hover moves colour
 * and ring only, over 120ms. Focus is a 3px gold ring, which is the one place
 * gold appears outside a marker.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "font-semibold select-none outline-none",
    "transition-[color,background-color,border-color,transform] duration-120 ease-out",
    "active:scale-[0.97] active:duration-160",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border border-border-2 bg-transparent text-foreground hover:border-border-3",
        soft: "border border-border-2 bg-card text-foreground hover:bg-elevated",
        elevated: "bg-elevated text-foreground hover:brightness-110",
        dashed:
          "border border-dashed border-border-3 bg-transparent text-muted-foreground hover:text-foreground",
        ghost: "bg-transparent text-primary-text hover:text-primary-hover",
        quiet: "bg-transparent text-muted-foreground hover:text-foreground",
      },
      size: {
        /** Segmented items, topic pills, small chips. */
        xs: "h-[34px] px-[13px] text-[13px]",
        /** Filter and example chips. */
        sm: "min-h-[38px] px-[13px] text-[13.5px]",
        /** Filter-sheet options, quick dates. */
        md: "min-h-[42px] px-[15px] text-[14px]",
        /** Secondary actions, load more. */
        lg: "h-[46px] px-4 text-[14px]",
        /** Sheet primary actions. */
        xl: "h-[48px] px-5 text-[15px]",
        /** Sidebar primary action, filter apply. */
        "2xl": "h-[50px] px-5 text-[15px]",
        /** 38x38 with a 44px touch target from the wrapper's padding. */
        icon: "size-[38px] p-0",
        "icon-lg": "size-[46px] p-0",
        "icon-xl": "size-[52px] p-0",
      },
      shape: {
        pill: "rounded-pill",
        rounded: "rounded-md",
        card: "rounded-xl",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      shape: "pill",
      block: false,
    },
  },
);

type ButtonStyleProps = VariantProps<typeof buttonVariants>;

function Button({
  className,
  variant,
  size,
  shape,
  block,
  ...props
}: ButtonPrimitive.Props & ButtonStyleProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, shape, block }), className)}
      {...props}
    />
  );
}

/**
 * A link that looks like a button.
 *
 * Base UI composes with a `render` prop, and omitting `nativeButton={false}`
 * when the rendered element is an `<a>` logs an accessibility error that is
 * console-only - it passes typecheck, lint AND build. Rather than rely on
 * every call site remembering, links get their own component that never
 * touches the button primitive at all.
 */
function LinkButton({
  className,
  variant,
  size,
  shape,
  block,
  ...props
}: React.ComponentProps<typeof Link> & ButtonStyleProps) {
  return (
    <Link
      data-slot="link-button"
      className={cn(buttonVariants({ variant, size, shape, block }), className)}
      {...props}
    />
  );
}

/** Same styling for an external `<a>`, which Next's Link should not own. */
function ExternalLinkButton({
  className,
  variant,
  size,
  shape,
  block,
  ...props
}: React.ComponentProps<"a"> & ButtonStyleProps) {
  return (
    <a
      data-slot="link-button"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant, size, shape, block }), className)}
      {...props}
    />
  );
}

export { Button, LinkButton, ExternalLinkButton, buttonVariants };

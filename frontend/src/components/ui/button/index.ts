import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-semibold tracking-[-0.01em] transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 ease-out active:translate-y-px active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 disabled:active:translate-y-0 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/25 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "border border-primary/80 bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_6px_18px_rgb(0_0_0/0.18)] hover:border-primary hover:bg-[#e7c36f] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_8px_22px_rgb(0_0_0/0.24)]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-border bg-transparent text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.025)] hover:border-[#484942] hover:bg-secondary",
        secondary:
          "border border-border bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] hover:border-[#484942] hover:bg-[#292a25]",
        ghost:
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-10 px-4 py-2 has-[>svg]:px-3.5",
        "xs": "h-7 gap-1 rounded-lg px-2 text-[11px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        "sm": "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
        "lg": "h-11 px-6 has-[>svg]:px-4",
        "icon": "size-9 rounded-lg",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>

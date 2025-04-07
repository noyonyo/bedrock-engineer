/**
 * Utility function to combine class names
 * A simplified version inspired by clsx and twMerge from tailwindcss
 *
 * @param classes Class names to be combined (can be added conditionally)
 * @returns A string of combined class names
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ').trim()
}

export const sleep = (msec: number) => new Promise((resolve) => setTimeout(resolve, msec))

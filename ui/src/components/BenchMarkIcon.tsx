/**
 * Bench product mark (replaces legacy Lucide `Paperclip` branding in nav / skills source).
 *
 * Attachment affordances (upload file, etc.) should keep using the Lucide `Paperclip` icon.
 *
 * Assets: repo root `images/svg/`. Suffix means **background** the asset is drawn for:
 * - `*_on_light_bg` — dark ink → use when the **app** is in light mode (light page chrome).
 * - `*_on_dark_bg` — light ink → use when the **app** is in dark mode (dark page chrome).
 */
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import benchIconOnLightBgUrl from "@bench/images/svg/bench_icon_on_light_bg.svg?url";
import benchIconOnDarkBgUrl from "@bench/images/svg/bench_icon_on_dark_bg.svg?url";

type BenchMarkIconProps = {
  className?: string;
  /** Accessible name; use `""` for decorative marks (sets `aria-hidden`). */
  alt?: string;
};

export function BenchMarkIcon({ className, alt = "Bench" }: BenchMarkIconProps) {
  const { theme } = useTheme();
  const src = theme === "dark" ? benchIconOnDarkBgUrl : benchIconOnLightBgUrl;
  const decorative = alt === "";
  return (
    <img
      src={src}
      alt={decorative ? "" : alt}
      aria-hidden={decorative ? true : undefined}
      className={cn("h-5 w-5 shrink-0 object-contain", className)}
      draggable={false}
    />
  );
}

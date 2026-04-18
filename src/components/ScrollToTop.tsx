/**
 * Floating "scroll to top" button. Surfaces in the bottom-right of the
 * primary scroll container after the user has scrolled past one viewport.
 *
 * The app's scroll container is `<main>` inside AppLayout (the page itself
 * never scrolls — it's `h-screen overflow-hidden`). We auto-detect the
 * nearest scrollable ancestor at mount so the same button works for
 * page-level scrolling too if AppLayout ever changes.
 *
 * Visual: round button hovering above the BottomNav (which is bottom-0 on
 * mobile, ~64px tall) so it never collides with primary navigation.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

const SHOW_AFTER_PX = 300;

function findScrollContainer(start: HTMLElement | null): HTMLElement | Window {
  let el: HTMLElement | null = start?.parentElement ?? null;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return window;
}

const ScrollToTop: React.FC = () => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = findScrollContainer(sentinelRef.current);
    containerRef.current = container;

    const getScrollTop = () =>
      container === window
        ? window.scrollY
        : (container as HTMLElement).scrollTop;

    const onScroll = () => setVisible(getScrollTop() > SHOW_AFTER_PX);

    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (container === window) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      (container as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  return (
    <>
      {/* Anchor used to locate the scroll container — invisible, takes no space. */}
      <div ref={sentinelRef} className="sr-only" aria-hidden="true" />
      <button
        type="button"
        onClick={handleClick}
        aria-label="Scroll to top"
        className={cn(
          // Sits above the BottomNav (bottom-16 on mobile, bottom-6 on md+).
          "fixed right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-lg ring-1 ring-border",
          "transition-all duration-200 hover:scale-105 hover:bg-primary/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "bottom-20 md:bottom-6",
          visible
            ? "opacity-100 pointer-events-auto translate-y-0"
            : "opacity-0 pointer-events-none translate-y-2"
        )}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </>
  );
};

export default ScrollToTop;

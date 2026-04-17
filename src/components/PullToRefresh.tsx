import React, { useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
  threshold?: number;
  disabled?: boolean;
}

const MAX_PULL = 120;

const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className,
  threshold = 70,
  disabled = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || refreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  }, [disabled, refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Apply resistance
    const eased = Math.min(MAX_PULL, delta * 0.5);
    setPull(eased);
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull >= threshold && !refreshing) {
      setRefreshing(true);
      setPull(threshold);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }, [pull, threshold, refreshing, onRefresh]);

  const progress = Math.min(1, pull / threshold);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn("relative h-full overflow-y-auto overscroll-contain", className)}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center justify-center"
        style={{
          transform: `translate(-50%, ${pull - 40}px)`,
          opacity: progress,
          transition: refreshing || pull === 0 ? "transform 0.25s ease, opacity 0.25s ease" : "none",
        }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border">
          <RefreshCw
            className={cn("h-4 w-4 text-primary", refreshing && "animate-spin")}
            style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>
      <div
        style={{
          transform: `translateY(${pull}px)`,
          transition: refreshing || pull === 0 ? "transform 0.25s ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ExtractSearchProps {
  text: string;
}

/**
 * Search-within-extract: filters long imported documents by keyword,
 * highlights every match, and lets agents jump between hits using
 * the prev/next buttons or Enter / Shift+Enter from the search input.
 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ExtractSearch: React.FC<ExtractSearchProps> = ({ text }) => {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const trimmed = query.trim();
  const containerRef = useRef<HTMLPreElement>(null);

  const { nodes, count } = useMemo(() => {
    if (!trimmed) return { nodes: [text] as React.ReactNode[], count: 0 };
    const re = new RegExp(`(${escapeRegExp(trimmed)})`, "gi");
    const parts = text.split(re);
    let hits = 0;
    const out: React.ReactNode[] = parts.map((part, i) => {
      if (i % 2 === 1) {
        const matchIndex = hits;
        hits += 1;
        const isActive = matchIndex === activeIdx;
        return (
          <mark
            key={i}
            data-match-index={matchIndex}
            className={
              isActive
                ? "rounded bg-primary text-primary-foreground px-0.5 ring-2 ring-primary/60"
                : "rounded bg-primary/30 text-foreground px-0.5"
            }
          >
            {part}
          </mark>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
    return { nodes: out, count: hits };
  }, [text, trimmed, activeIdx]);

  // Reset active match whenever the query changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [trimmed]);

  // Scroll the active match into view inside the <pre> container.
  useEffect(() => {
    if (!trimmed || count === 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `mark[data-match-index="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx, trimmed, count, nodes]);

  const goNext = () => {
    if (count === 0) return;
    setActiveIdx((i) => (i + 1) % count);
  };
  const goPrev = () => {
    if (count === 0) return;
    setActiveIdx((i) => (i - 1 + count) % count);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) goPrev();
                else goNext();
              } else if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search within extract…  (Enter / Shift+Enter)"
            className="h-7 pl-7 pr-14 text-xs"
            aria-label="Search within extract"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                setQuery("");
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            goPrev();
          }}
          disabled={!trimmed || count === 0}
          className="h-7 w-7 p-0"
          aria-label="Previous match (Shift+Enter)"
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            goNext();
          }}
          disabled={!trimmed || count === 0}
          className="h-7 w-7 p-0"
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
      {trimmed && (
        <p className="text-[10px] text-muted-foreground">
          {count === 0
            ? "No matches"
            : `${activeIdx + 1} of ${count} match${count === 1 ? "" : "es"}`}
        </p>
      )}
      <pre
        ref={containerRef}
        className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/40 p-2 font-sans text-sm"
      >
        {nodes}
      </pre>
    </div>
  );
};

export default ExtractSearch;

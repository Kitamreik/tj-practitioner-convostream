import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ExtractSearchProps {
  text: string;
}

/**
 * Search-within-extract: filters long imported documents by keyword,
 * highlights every match, and reports how many hits were found so
 * agents can scan a document without scrolling its entire body.
 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ExtractSearch: React.FC<ExtractSearchProps> = ({ text }) => {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const { nodes, count } = useMemo(() => {
    if (!trimmed) return { nodes: [text] as React.ReactNode[], count: 0 };
    const re = new RegExp(`(${escapeRegExp(trimmed)})`, "gi");
    const parts = text.split(re);
    let hits = 0;
    const out: React.ReactNode[] = parts.map((part, i) => {
      if (i % 2 === 1) {
        hits += 1;
        return (
          <mark
            key={i}
            className="rounded bg-primary/30 text-foreground px-0.5"
          >
            {part}
          </mark>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
    return { nodes: out, count: hits };
  }, [text, trimmed]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Search within extract…"
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
      {trimmed && (
        <p className="text-[10px] text-muted-foreground">
          {count === 0 ? "No matches" : `${count} match${count === 1 ? "" : "es"}`}
        </p>
      )}
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/40 p-2 font-sans text-sm">
        {nodes}
      </pre>
    </div>
  );
};

export default ExtractSearch;

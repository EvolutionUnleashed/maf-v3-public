import React, { type ElementType, type ReactNode } from "react";

type SafeMarkdownProps = {
  children: string;
  className?: string;
};

const INLINE_MARKERS = ["[", "`", "**", "__", "*", "_"] as const;

function nextMarker(source: string, start: number): number {
  let next = -1;
  for (const marker of INLINE_MARKERS) {
    const index = source.indexOf(marker, start);
    if (index !== -1 && (next === -1 || index < next)) next = index;
  }
  return next;
}

function safeLinkTarget(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Render the small inline Markdown subset MAF produces. React escapes every
 * text node and links are restricted to HTTP(S), so generated content cannot
 * inject HTML, scripts, data URLs, or event handlers.
 */
export function renderSafeInline(source: string, keyPrefix = "inline"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  const pushText = (text: string) => {
    if (text) nodes.push(text);
  };

  while (cursor < source.length) {
    const markerIndex = nextMarker(source, cursor);
    if (markerIndex === -1) {
      pushText(source.slice(cursor));
      break;
    }
    pushText(source.slice(cursor, markerIndex));

    if (source[markerIndex] === "[") {
      const labelEnd = source.indexOf("](", markerIndex + 1);
      const urlEnd = labelEnd === -1 ? -1 : source.indexOf(")", labelEnd + 2);
      if (labelEnd !== -1 && urlEnd !== -1) {
        const label = source.slice(markerIndex + 1, labelEnd);
        const href = safeLinkTarget(source.slice(labelEnd + 2, urlEnd).trim());
        if (href) {
          nodes.push(
            <a
              className="underline decoration-primary/50 underline-offset-2 hover:text-primary"
              href={href}
              key={`${keyPrefix}-link-${key++}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {label}
            </a>,
          );
          cursor = urlEnd + 1;
          continue;
        }
      }
    }

    if (source[markerIndex] === "`") {
      const end = source.indexOf("`", markerIndex + 1);
      if (end !== -1) {
        nodes.push(
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" key={`${keyPrefix}-code-${key++}`}>
            {source.slice(markerIndex + 1, end)}
          </code>,
        );
        cursor = end + 1;
        continue;
      }
    }

    const doubleMarker = source.slice(markerIndex, markerIndex + 2);
    if (doubleMarker === "**" || doubleMarker === "__") {
      const end = source.indexOf(doubleMarker, markerIndex + 2);
      if (end !== -1) {
        const childKey = `${keyPrefix}-strong-${key}`;
        nodes.push(
          <strong key={`${keyPrefix}-strong-${key++}`}>
            {renderSafeInline(source.slice(markerIndex + 2, end), childKey)}
          </strong>,
        );
        cursor = end + 2;
        continue;
      }
    }

    const singleMarker = source[markerIndex];
    if (singleMarker === "*" || singleMarker === "_") {
      const end = source.indexOf(singleMarker, markerIndex + 1);
      if (end !== -1) {
        const childKey = `${keyPrefix}-em-${key}`;
        nodes.push(
          <em key={`${keyPrefix}-em-${key++}`}>
            {renderSafeInline(source.slice(markerIndex + 1, end), childKey)}
          </em>,
        );
        cursor = end + 1;
        continue;
      }
    }

    pushText(source[markerIndex]);
    cursor = markerIndex + 1;
  }

  return nodes;
}

export function SafeMarkdown({ children, className = "" }: SafeMarkdownProps) {
  const lines = String(children || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-4" key={`code-${index}`}>
          <code className="font-mono text-sm" data-language={language || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const Heading = `h${heading[1].length}` as ElementType;
      blocks.push(
        <Heading className="font-display font-semibold tracking-tight" key={`heading-${index}`}>
          {renderSafeInline(heading[2], `heading-${index}`)}
        </Heading>,
      );
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr className="my-5 border-border" key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote className="border-l-2 border-primary/50 pl-4 italic text-muted-foreground" key={`quote-${index}`}>
          {renderSafeInline(quoted.join(" "), `quote-${index}`)}
        </blockquote>,
      );
      continue;
    }

    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const matcher = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
      while (index < lines.length) {
        const match = matcher.exec(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List className={ordered ? "list-decimal space-y-1 pl-6" : "list-disc space-y-1 pl-6"} key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>{renderSafeInline(item, `list-${index}-${itemIndex}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !lines[index].trimStart().startsWith("```") &&
      !/^\s*(?:[-+*]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p className="leading-7" key={`paragraph-${index}`}>
        {renderSafeInline(paragraph.join(" "), `paragraph-${index}`)}
      </p>,
    );
  }

  return <div className={`space-y-4 break-words ${className}`.trim()}>{blocks}</div>;
}

export default SafeMarkdown;

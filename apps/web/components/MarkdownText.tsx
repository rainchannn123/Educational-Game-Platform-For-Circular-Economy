import React, { Fragment, type ReactNode } from "react";

const inlineTokens = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  return value.split(inlineTokens).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**"))
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("__") && token.endsWith("__"))
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`") && token.endsWith("`"))
      return <code key={key}>{token.slice(1, -1)}</code>;
    if (token.startsWith("*") && token.endsWith("*"))
      return <em key={key}>{token.slice(1, -1)}</em>;
    if (token.startsWith("_") && token.endsWith("_"))
      return <em key={key}>{token.slice(1, -1)}</em>;
    return <Fragment key={key}>{token}</Fragment>;
  });
}

export function MarkdownText({
  content,
  className,
}: {
  content: string;
  className?: string | undefined;
}) {
  const blocks = content.trim().split(/\n\s*\n/).filter(Boolean);
  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter(Boolean);
        const unordered = lines.every((line) => /^[-*]\s+/.test(line));
        const ordered = lines.every((line) => /^\d+\.\s+/.test(line));
        if (unordered || ordered) {
          const List = ordered ? "ol" : "ul";
          return (
            <List key={`list-${blockIndex}`}>
              {lines.map((line, lineIndex) => (
                <li key={`item-${lineIndex}`}>
                  {renderInline(line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""), `list-${blockIndex}-${lineIndex}`)}
                </li>
              ))}
            </List>
          );
        }
        const heading = lines.length === 1 ? lines[0]!.match(/^(#{1,3})\s+(.+)$/) : null;
        if (heading) {
          const headingLevel = heading[1]!;
          const headingText = heading[2]!;
          const Heading = `h${headingLevel.length}` as "h1" | "h2" | "h3";
          return <Heading key={`heading-${blockIndex}`}>{renderInline(headingText, `heading-${blockIndex}`)}</Heading>;
        }
        return (
          <p key={`paragraph-${blockIndex}`}>
            {lines.map((line, lineIndex) => (
              <Fragment key={`line-${lineIndex}`}>
                {lineIndex > 0 && <br />}
                {renderInline(line, `paragraph-${blockIndex}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

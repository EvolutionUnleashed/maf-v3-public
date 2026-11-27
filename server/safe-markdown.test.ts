import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../client/src/components/SafeMarkdown";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(SafeMarkdown, { children: markdown }));
}

describe("SafeMarkdown", () => {
  it("escapes generated HTML instead of interpreting it", () => {
    const html = render('<img src=x onerror="alert(1)"><script>alert(2)</script>');
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
  });

  it("allows only HTTP(S) links", () => {
    const html = render(
      "[safe](https://example.com/path) [script](javascript:alert(1)) [data](data:text/html,test)",
    );
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
  });

  it("renders the limited formatting used by generated content", () => {
    const html = render("## Heading\n\n- **Strong** item\n- `code` item");
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong>");
    expect(html).toContain("<code");
  });
});

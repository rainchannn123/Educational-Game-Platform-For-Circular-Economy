import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";

describe("MarkdownText", () => {
  it("renders supported Markdown as structured React elements", () => {
    const markup = renderToStaticMarkup(
      <MarkdownText content={"## Recycling plan\n\n**Recycle** the paper with `hydropulp`.\n\n- Check contamination\n- Choose a method"} />,
    );

    expect(markup).toContain("<h2>Recycling plan</h2>");
    expect(markup).toContain("<strong>Recycle</strong>");
    expect(markup).toContain("<code>hydropulp</code>");
    expect(markup).toContain("<ul>");
  });

  it("renders HTML-like model output as text instead of executable markup", () => {
    const markup = renderToStaticMarkup(
      <MarkdownText content={'<script>alert("unsafe")</script>'} />,
    );

    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});

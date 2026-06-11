import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
	it("renders GFM markdown (headings, emphasis)", () => {
		const html = renderMarkdown("# Title\n\nSome **bold** text.");
		expect(html).toContain("<h1");
		expect(html).toContain("Title");
		expect(html).toContain("<strong>bold</strong>");
	});

	it("highlights fenced code for a known language", () => {
		const html = renderMarkdown("```javascript\nconst x = 1;\n```");
		expect(html).toContain("language-javascript");
		expect(html).toContain("hljs-keyword"); // `const` got highlighted
	});

	it("resolves language aliases (js -> javascript)", () => {
		const html = renderMarkdown("```js\nconst x = 1;\n```");
		expect(html).toContain("hljs-keyword");
	});

	it("escapes code for an unknown language without throwing", () => {
		const html = renderMarkdown("```nope\n<b>x</b>\n```");
		expect(html).toContain("&lt;b&gt;");
	});

	it("sanitizes dangerous HTML", () => {
		const html = renderMarkdown("Hi <script>alert(1)</script> there");
		expect(html).not.toContain("<script>");
		expect(html).toContain("Hi");
	});

	it("balances dangling bold emphasis while streaming", () => {
		expect(renderMarkdown("a **bold", { streaming: true })).toContain("<strong>bold</strong>");
	});

	it("does not balance delimiters when not streaming", () => {
		expect(renderMarkdown("a **bold")).not.toContain("<strong>");
	});

	it("wraps fenced code blocks with a copy button", () => {
		const html = renderMarkdown("```js\nconst x = 1;\n```");
		expect(html).toContain("code-block");
		expect(html).toContain("data-copy");
		expect(html).toContain("<pre>");
	});

	it("does not add a copy button to inline code", () => {
		const html = renderMarkdown("use `npm run dev` please");
		expect(html).not.toContain("data-copy");
		expect(html).toContain("<code>npm run dev</code>");
	});

	it("returns an empty string for empty input", () => {
		expect(renderMarkdown("")).toBe("");
	});
});

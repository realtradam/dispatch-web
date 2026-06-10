import { render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import Table from "./Table.svelte";

describe("Table", () => {
	it("renders a header cell per column", () => {
		render(Table, { props: { columns: ["Name", "Version"], rows: [] } });
		const headers = screen.getAllByRole("columnheader");
		expect(headers.map((h) => h.textContent)).toEqual(["Name", "Version"]);
	});

	it("renders one row per data row with aligned cells", () => {
		render(Table, {
			props: {
				columns: ["Name", "Version"],
				rows: [
					["alpha", "1.0"],
					["beta", "2.3"],
				],
			},
		});
		const body = screen.getAllByRole("rowgroup")[1];
		if (body === undefined) throw new Error("expected a tbody rowgroup");
		const rows = within(body).getAllByRole("row");
		expect(rows).toHaveLength(2);
		expect(within(rows[0] as HTMLElement).getByText("alpha")).toBeInTheDocument();
		expect(within(rows[0] as HTMLElement).getByText("1.0")).toBeInTheDocument();
		expect(within(rows[1] as HTMLElement).getByText("beta")).toBeInTheDocument();
	});

	it("shows the empty message when there are no rows", () => {
		render(Table, { props: { columns: ["A"], rows: [], empty: "Nothing loaded" } });
		expect(screen.getByText("Nothing loaded")).toBeInTheDocument();
	});
});

"""Deterministic HTML table extraction. Stdlib only, and no model involved.

The numbers on this path come out of a vendor's own published table and nowhere else. A
language model is not in the loop, because the one thing that must never happen here is a
percentage that nobody published being attributed to a real company on a page whose whole
argument is that vendors overstate their results.

What comes out is a grid of strings with its position preserved, so a caller can require
that a value sits in the SAME ROW as the benchmark label it is being credited to. Checking
that "74.9" appears somewhere in the document is not the same check: a 74.9 in any paragraph
would pass it.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

# Cells that mean "not measured". Kept distinct from a zero, which is a result.
BLANK_CELLS = {"", "-", "--", "—", "–", "n/a", "na", "N/A"}

_PERCENT = re.compile(r"^([0-9]+(?:\.[0-9]+)?)\s*%$")
_BARE = re.compile(r"^([0-9]+(?:\.[0-9]+)?)$")


class TableExtractor(HTMLParser):
    """Collect every <table> as a list of rows, each row a list of cell strings."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "table":
            # Nested tables are flattened into the outer one rather than dropped: vendors
            # wrap tables in tables for layout, and losing the inner one loses the data.
            self._depth += 1
            if self._depth == 1:
                self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if any(cell for cell in self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == "table":
            self._depth -= 1
            if self._depth == 0 and self._table is not None:
                if self._table:
                    self.tables.append(self._table)
                self._table = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def extract_tables(markup: str) -> list[list[list[str]]]:
    """Every table in the document, as rows of cell strings."""
    # Script and style bodies are removed first: their contents are not table cells, and a
    # JSON blob inside a <script> is full of numbers that must never be read as results.
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", markup, flags=re.I)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.I)

    parser = TableExtractor()
    parser.feed(cleaned)
    parser.close()
    return parser.tables


def parse_value(cell: str) -> float | None:
    """A cell's number, or None when the cell holds no single number.

    Deliberately strict. "94.6%" and "94.6" are values; "94.6% (max effort)" is not, because
    reading a number out of prose is where a configuration qualifier gets silently dropped.
    """
    text = cell.strip()
    if text in BLANK_CELLS:
        return None
    for pattern in (_PERCENT, _BARE):
        match = pattern.match(text)
        if match:
            return float(match.group(1))
    return None


def normalise_label(text: str) -> str:
    """Compare labels without being defeated by dashes, footnote marks or case."""
    # Vendors write GPT-5.6 with a non-breaking hyphen and hang footnote superscripts off
    # benchmark names; neither changes what the row is about.
    lowered = text.lower()
    lowered = lowered.replace("‑", "-").replace("–", "-").replace("—", "-")
    lowered = re.sub(r"[⁰-₟¹²³]", "", lowered)
    return re.sub(r"[^a-z0-9.+]+", "", lowered)


def find_rows(
    table: list[list[str]], row_label: str
) -> list[tuple[list[str], list[str]]]:
    """Rows whose first cell matches `row_label`, paired with the table's header row.

    Returns (header, row) so the caller can line a value up with the column it sits under.
    A value is only ever credited to the model named at the top of its own column and the
    benchmark named at the start of its own row - that intersection is the whole guarantee.
    """
    target = normalise_label(row_label)
    matches = []
    header: list[str] = []
    for row in table:
        cells = [cell for cell in row]
        if not cells:
            continue
        # The header is the most recent row whose data cells hold no numbers: vendors stack
        # several header rows in one table, one per eval section.
        values = [parse_value(cell) for cell in cells[1:]]
        if cells[1:] and not any(value is not None for value in values):
            header = cells
            continue
        if normalise_label(cells[0]) == target and header:
            matches.append((header, cells))
    return matches

/** Parse RFC 4180 CSV while tolerating CRLF and a trailing blank line. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted cell.");
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value !== ""));
}

export function toCsv(rows) {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value ?? "");
            return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
          })
          .join(","),
      )
      .join("\n") + "\n"
  );
}

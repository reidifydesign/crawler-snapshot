/** Plain fixed-width table. Columns: [{ key, title, align?: 'left'|'right', max? }] */
export function renderTable(columns, rows) {
  const cells = rows.map((r) =>
    columns.map((c) => {
      let v = String(r[c.key] ?? '');
      if (c.max && v.length > c.max) v = `${v.slice(0, c.max - 1)}~`;
      return v;
    }),
  );
  const widths = columns.map((c, i) => Math.max(c.title.length, ...cells.map((row) => row[i].length)));
  const fmt = (row) =>
    row
      .map((v, i) => (columns[i].align === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  const head = fmt(columns.map((c) => c.title));
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [head, rule, ...cells.map(fmt)].join('\n');
}

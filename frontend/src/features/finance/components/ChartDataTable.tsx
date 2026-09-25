interface ChartDataTableProps {
  caption: string
  columns: string[]
  rows: string[][]
}

/** The chart's numbers as a real table, visually hidden, for screen readers. */
export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  return (
    // The wrapper is what is visually hidden: a table never shrinks below its content width, so a
    // hidden table itself would still widen the page.
    <div className="visually-hidden">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

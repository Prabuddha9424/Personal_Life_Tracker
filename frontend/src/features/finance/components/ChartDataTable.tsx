interface ChartDataTableProps {
  caption: string
  columns: string[]
  rows: string[][]
}

/** The chart's numbers as a real table, visually hidden, for screen readers. */
export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  return (
    <table className="visually-hidden">
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
  )
}

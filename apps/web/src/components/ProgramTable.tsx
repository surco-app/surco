import { useTranslation } from 'react-i18next'
import { type Cell, PROGRAM_TABLE, PROGRAMS } from '../lib/programTable'

function Mark({ cell }: { cell: Cell }) {
  const { t } = useTranslation()
  return (
    <>
      {cell.yes ? (
        <svg
          data-testid="program-yes"
          role="img"
          aria-label={t('features.programs.yes')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto block size-[18px] text-blue"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <span data-testid="program-no" className="text-[13px] text-edge">
          {t('features.programs.no')}
        </span>
      )}
      {cell.note && (
        <span data-testid="program-note" className="mt-1 block text-xs leading-snug text-muted">
          {t(`features.programs.notes.${cell.note}`)}
        </span>
      )}
    </>
  )
}

export default function ProgramTable() {
  const { t } = useTranslation()
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <section> would trip noNoninteractiveTabindex, and the scrollable table needs its tab stop
    <div
      data-testid="program-table"
      role="region"
      aria-label={t('features.programs.region')}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region is unreachable by keyboard without a tab stop (WCAG 2.1.1)
      tabIndex={0}
      className="overflow-x-auto rounded-2xl border border-line bg-surface2"
    >
      <table className="w-full min-w-[760px] border-collapse text-[15px]">
        <thead>
          <tr className="bg-surface">
            <th
              scope="col"
              className="w-[30%] px-5 py-4 text-left text-[13px] font-medium text-muted"
            >
              {t('features.programs.feature')}
            </th>
            {PROGRAMS.map((program) => (
              <th
                key={program.id}
                scope="col"
                className="px-3 py-4 text-center text-sm font-semibold text-fg"
              >
                {program.name}
              </th>
            ))}
          </tr>
        </thead>
        {PROGRAM_TABLE.map((group) => (
          <tbody key={group.id}>
            <tr>
              <th
                scope="colgroup"
                colSpan={PROGRAMS.length + 1}
                className="border-t border-line px-5 pt-5 pb-2 text-left text-xs font-semibold tracking-[0.08em] text-faint uppercase"
              >
                {t(`features.programs.groups.${group.id}`)}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.id} className="border-t border-line/60">
                <th scope="row" className="px-5 py-3.5 text-left font-normal text-fg">
                  {t(`features.programs.rows.${row.id}`)}
                </th>
                {PROGRAMS.map((program) => (
                  <td
                    key={program.id}
                    data-testid={`program-cell-${row.id}-${program.id}`}
                    className="px-2.5 py-3 text-center align-middle"
                  >
                    <Mark cell={row.cells[program.id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

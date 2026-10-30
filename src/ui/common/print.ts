/** What is being printed: the 80 mm till slip or an A4 report. print.css shows only that part. */
export type PrintMode = 'receipt' | 'report'

const PAGE: Record<PrintMode, string> = {
  receipt: '80mm 200mm',
  report: 'A4 portrait',
}

/** Print in one mode: tag <html> with `print-<mode>` and set the page size, then undo both on afterprint. */
export function printAs(mode: PrintMode): void {
  const root = document.documentElement
  // Some browsers skip afterprint on a cancelled dialog; drop any mode left behind first.
  document.head.querySelectorAll('style[data-print-page]').forEach((s) => s.remove())
  root.classList.remove('print-receipt', 'print-report')
  const page = document.createElement('style')
  page.dataset.printPage = mode
  page.textContent = `@page { size: ${PAGE[mode]}; margin: ${mode === 'receipt' ? '0' : '12mm'}; }`
  document.head.appendChild(page)
  root.classList.add(`print-${mode}`)
  window.addEventListener(
    'afterprint',
    () => {
      root.classList.remove(`print-${mode}`)
      page.remove()
    },
    { once: true },
  )
  window.print()
}

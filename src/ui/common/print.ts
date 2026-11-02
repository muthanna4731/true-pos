/** What is being printed: the 80 mm till slip or an A4 report. print.css shows only that part. */
export type PrintMode = 'receipt' | 'report'

const PAGE: Record<PrintMode, string> = {
  receipt: '80mm 200mm',
  report: 'A4 portrait',
}

/** Undoes the print setup in progress (mode class, page size, section mark). */
let undo: (() => void) | undefined

/**
 * Print in one mode: tag <html> with `print-<mode>` and set the page size, then undo both on afterprint.
 * A report page can hold several reports, so pass the element that was clicked: only the `.report-print`
 * section around it gets the `printing` class, and print.css hides the others.
 */
export function printAs(mode: PrintMode, source?: Element | null): void {
  const root = document.documentElement
  // Some browsers skip afterprint on a cancelled dialog; drop any mode left behind first.
  undo?.()
  const page = document.createElement('style')
  page.dataset.printPage = mode
  page.textContent = `@page { size: ${PAGE[mode]}; margin: ${mode === 'receipt' ? '0' : '12mm'}; }`
  document.head.appendChild(page)
  root.classList.add(`print-${mode}`)
  const section = mode === 'report' ? source?.closest('.report-print') : null
  section?.classList.add('printing')
  const done = (): void => {
    root.classList.remove(`print-${mode}`)
    section?.classList.remove('printing')
    page.remove()
    window.removeEventListener('afterprint', done)
    if (undo === done) undo = undefined
  }
  undo = done
  window.addEventListener('afterprint', done)
  window.print()
}

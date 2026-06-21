/**
 * Export the current note to PDF using the browser's native print dialog.
 * The print.css stylesheet hides all UI chrome so only the editor content
 * is rendered. The user chooses "Save as PDF" as the destination.
 *
 * We temporarily set the document title so the suggested PDF filename
 * matches the note title.
 */
export function exportToPdf(title: string): void {
  const original = document.title
  const name = title.trim() || 'Untitled'
  document.title = name

  const restore = () => {
    document.title = original
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)

  window.print()

  // Fallback in case afterprint never fires (some browsers).
  setTimeout(restore, 1000)
}

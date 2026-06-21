/** Turn a note title into a safe filename. */
function slugify(title: string): string {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || 'untitled'
}

/** Download markdown content as a .md file. */
export function downloadMarkdown(title: string, markdown: string): void {
  const heading = title.trim() ? `# ${title.trim()}\n\n` : ''
  const blob = new Blob([heading + markdown], {
    type: 'text/markdown;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugify(title)}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

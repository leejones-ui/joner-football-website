const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const applyMarks = (text: string, markKeys: string[] = [], markDefs: any[] = []) => {
  return markKeys.reduce((output, key) => {
    if (key === 'strong') return `<strong>${output}</strong>`
    if (key === 'em') return `<em>${output}</em>`
    if (key === 'code') return `<code>${output}</code>`

    const def = markDefs.find((item) => item?._key === key)
    if (def?._type === 'link' && def.href) {
      const href = escapeHtml(String(def.href))
      const target = def.blank ? ' target="_blank" rel="noreferrer noopener"' : ''
      return `<a href="${href}" class="text-joner-red hover:underline"${target}>${output}</a>`
    }

    return output
  }, text)
}

const renderChildren = (block: any) => {
  const children = Array.isArray(block?.children) ? block.children : []
  const markDefs = Array.isArray(block?.markDefs) ? block.markDefs : []

  return children
    .map((child: any) => {
      const text = escapeHtml(String(child?.text || ''))
      return applyMarks(text, Array.isArray(child?.marks) ? child.marks : [], markDefs)
    })
    .join('')
}

const renderBlock = (block: any) => {
  const style = block?.style || 'normal'
  const content = renderChildren(block)

  if (!content.trim()) return ''

  if (style === 'h2') return `<h2 class="font-heading mb-4 text-2xl font-bold uppercase text-white">${content}</h2>`
  if (style === 'h3') return `<h3 class="font-heading mb-3 text-xl font-bold uppercase text-white">${content}</h3>`
  if (style === 'blockquote') return `<blockquote class="border-l-4 border-joner-red pl-4 font-body text-lg italic text-gray-200">${content}</blockquote>`

  return `<p class="font-body leading-relaxed text-gray-300">${content}</p>`
}

const renderList = (items: any[], ordered: boolean) => {
  const tag = ordered ? 'ol' : 'ul'
  const className = ordered
    ? 'space-y-2 pl-5 font-body text-gray-300 list-decimal'
    : 'space-y-2 font-body text-gray-300'

  const content = items
    .map((item) => `<li class="${ordered ? '' : 'flex items-start gap-2'}">${ordered ? '' : '<span class="text-joner-red font-bold flex-shrink-0">&#8226;</span><span>'}${renderChildren(item)}${ordered ? '' : '</span>'}</li>`)
    .join('')

  return `<${tag} class="${className}">${content}</${tag}>`
}

export function portableTextToHtml(blocks: any[] = []) {
  if (!Array.isArray(blocks) || !blocks.length) return ''

  const html: string[] = []
  let listBuffer: any[] = []
  let listOrdered = false

  const flushList = () => {
    if (!listBuffer.length) return
    html.push(renderList(listBuffer, listOrdered))
    listBuffer = []
  }

  for (const block of blocks) {
    if (!block || block._type !== 'block') continue

    if (block.listItem) {
      const ordered = block.listItem === 'number'
      if (listBuffer.length && ordered !== listOrdered) flushList()
      listOrdered = ordered
      listBuffer.push(block)
      continue
    }

    flushList()
    html.push(renderBlock(block))
  }

  flushList()

  return html.filter(Boolean).join('')
}

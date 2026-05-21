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

const renderImageWithMeta = (block: any) => {
  if (block?.hideImage) return ''
  const imageUrl = block?.url || block?.imageUrl || block?.coverImageUrl || block?.src
  if (!imageUrl) return ''

  const alt = escapeHtml(String(block?.alt || block?.caption || 'Joner Football App'))
  const caption = block?.caption ? `<figcaption class="mt-3 font-body text-sm text-gray-400">${escapeHtml(String(block.caption))}</figcaption>` : ''

  return `<figure class="my-8 overflow-hidden rounded-lg border border-white/10 bg-joner-gray"><img src="${escapeHtml(String(imageUrl))}" alt="${alt}" class="w-full object-cover" loading="lazy" />${caption}</figure>`
}

const renderAppCta = (block: any) => {
  const title = escapeHtml(String(block?.title || 'Train This Inside The Joner Football App'))
  const text = escapeHtml(String(block?.text || 'Get the full session detail, drills and progressions inside the app.'))
  const href = escapeHtml(String(block?.href || 'https://jonerfootball.com/join/'))
  const label = escapeHtml(String(block?.label || 'Open The App'))
  const secondaryHref = block?.secondaryHref ? escapeHtml(String(block.secondaryHref)) : ''
  const secondaryLabel = escapeHtml(String(block?.secondaryLabel || 'Try The App Free'))
  const secondary = secondaryHref
    ? `<a href="${secondaryHref}" class="inline-flex items-center justify-center border border-joner-black px-5 py-3 font-heading text-sm uppercase tracking-wide text-joner-black hover:bg-joner-black hover:text-white">${secondaryLabel}</a>`
    : ''

  return `<aside class="my-8 rounded-lg border border-joner-red bg-white p-6 text-joner-black shadow-2xl shadow-black/30"><p class="mb-2 font-heading text-xs uppercase tracking-[0.24em] text-joner-red">Joner Football App</p><h3 class="mb-3 font-heading text-2xl font-black uppercase leading-tight text-joner-black">${title}</h3><p class="mb-5 font-body text-base leading-relaxed text-gray-700">${text}</p><div class="flex flex-col gap-3 sm:flex-row"><a href="${href}" class="inline-flex items-center justify-center bg-joner-red px-5 py-3 font-heading text-sm uppercase tracking-wide text-white hover:bg-red-700">${label}</a>${secondary}</div></aside>`
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
    if (!block) continue
    if (block._type === 'appCta') {
      flushList()
      html.push(renderAppCta(block))
      continue
    }
    if (block._type === 'imageWithMeta') {
      flushList()
      html.push(renderImageWithMeta(block))
      continue
    }
    if (block._type !== 'block') continue

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

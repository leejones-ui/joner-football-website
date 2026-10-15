// The PDF tax invoice where it is used (Lee, 16 Oct 2026): attached to the
// fee emails, and downloaded by staff (Money > Invoices, a player's open
// link) and by families (My account > Fees). The drawing is in
// _jfp-invoice-pdf.js; this reads what it needs from the store.
//
// Attaching is never in the way of the email: when the PDF cannot be made,
// the email still goes, without it, and staff are told (pdfWarning).
import { listGroups } from './_jfp-store.js'
import { getInvoice, publicInvoice, invoiceUrl } from './_jfp-invoices.js'
import { docFromInvoice, docFromPayreq, feeInvoiceNumber, renderInvoicePdf, pdfName, attachOn } from './_jfp-invoice-pdf.js'

export const PDF_WARNING = 'The PDF invoice could not be made, so the email went without it. Download the PDF from the link and send it if the family asks.'

export function docForInvoice(inv, config, base) {
  return docFromInvoice(inv, publicInvoice(inv, config), config, { payUrl: invoiceUrl(base, inv) })
}

// A payment request's invoice. One made for a custom invoice is that invoice.
export async function docForPayreq(q, config, base) {
  if (q.invoiceId) {
    const inv = await getInvoice(q.invoiceId)
    if (inv) return docForInvoice(inv, config, base)
  }
  const groups = Object.fromEntries((await listGroups()).map((g) => [g.id, g]))
  const number = await feeInvoiceNumber(q.id)
  return docFromPayreq(q, config, { number, groups, payUrl: `${base}/jfp-account/?pay=${encodeURIComponent(q.id)}` })
}

async function attach(make) {
  try {
    const doc = await make()
    const bytes = await renderInvoicePdf(doc)
    return { attachment: [{ name: pdfName(doc.number), content: Buffer.from(bytes).toString('base64') }], number: doc.number }
  } catch (error) {
    console.error('jfp invoice pdf failed', error)
    return { pdfWarning: PDF_WARNING }
  }
}
// { attachment, number } to hand to the email, { pdfWarning } when it could
// not be made, or {} when Settings has the PDF switched off.
export async function feePdfAttachment(q, config, base) {
  if (!q || !attachOn(config)) return {}
  return attach(() => docForPayreq(q, config, base))
}
export async function invoicePdfAttachment(inv, config, base) {
  if (!inv || !attachOn(config)) return {}
  return attach(() => docForInvoice(inv, config, base))
}

// A download: the PDF as base64 for the page to save.
export async function pdfDownload(doc) {
  const bytes = await renderInvoicePdf(doc)
  return { filename: pdfName(doc.number), number: doc.number, pdf: Buffer.from(bytes).toString('base64') }
}

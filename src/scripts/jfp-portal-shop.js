// Shop orders in the Joner Football Portal (Lee, 11 Nov 2026): Shopify sales
// and the orders Ligia still has to post, so everything Joner is in one
// place. Read only: posting and tracking are still done in Shopify (and the
// labels in Australia Post MyPost Business). Lee and Ligia only.
import { esc, api, toast, money } from './jfp-common.js'
import { psHead, psBadge, psHelp } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })
const FLAG = { AU: 'Australia', US: 'USA', GB: 'UK', NZ: 'New Zealand', CA: 'Canada', IE: 'Ireland' }
const where = (o) => [o.place, FLAG[o.country] || o.country].filter(Boolean).join(', ')
const when = (iso) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const age = (d) => (d <= 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`)
const itemsText = (o, onlyToShip = false) => o.items.filter((i) => !onlyToShip || i.toShip).map((i) => `${onlyToShip ? i.toShip : i.qty} x ${i.title.replace(/^Joner Football\s+/i, '')}${i.variant ? ` (${i.variant})` : ''}`).join(', ')
const STATUS = (o) => {
  if (o.cancelled) return ['grey', 'Cancelled']
  if (o.refundedCents && o.refundedCents >= o.totalCents) return ['grey', 'Refunded']
  if (o.toPost) return o.late ? ['red', 'To post, late'] : ['orange', 'To post']
  if (o.fulfilment === 'FULFILLED') return ['green', 'Posted']
  if (!o.items.some((i) => i.toShip)) return ['green', 'Nothing to post']
  return ['grey', o.fulfilment.toLowerCase().replace(/_/g, ' ') || 'Open']
}

export async function renderShopOrders(ui) {
  const { view, need, onCount } = ui
  const head = (count = '') => psHead({ title: 'Shop orders', count, primary: '<a class="j-btn j-btn-line" href="https://shop.jonerfootball.com" target="_blank" rel="noopener noreferrer">Open the shop</a>' }).replace('</h1>', `</h1>${psHelp('Orders from shop.jonerfootball.com, read from Shopify every couple of minutes. To post = paid orders with items still to send. They go red after 2 days. Post them as usual: buy the label in MyPost Business, then mark the order fulfilled in Shopify with the tracking number, and it leaves this list. Totals are what customers paid. Refunds show on each order.', 'About shop orders')}`)
  view().innerHTML = `${head()}<p class="muted">Reading Shopify</p>`
  const load = async (fresh = false) => need(await call('shopOrders', fresh ? { fresh: true } : {}))
  let d
  try { d = (await load()).shop } catch (e) { view().innerHTML = `${head()}<div class="j-box j-box-amber">${esc(e.message)}</div>`; return }

  if (!d.connected) {
    view().innerHTML = `${head()}<div class="j-box j-box-grey sh-connect"><b>Shopify is not connected yet.</b>
      <p>One job for Lee in Shopify (about 5 minutes). Shopify now makes these apps in its Dev Dashboard:</p>
      <ol><li>Open <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer">dev.shopify.com/dashboard</a> and create an app called "Joner Portal".</li>
      <li>In the app's version, tick only <b>read_orders</b> and <b>read_products</b>. Release it, then install it on the Joner store.</li>
      <li>In the app's Settings, copy the Client ID and Client secret into Vercel (joner-football-website, Production) as <b>SHOPIFY_CLIENT_ID</b> and <b>SHOPIFY_CLIENT_SECRET</b>. Never paste them in a chat.</li>
      <li>Tell Claude it is done, and this page fills in.</li></ol></div>`
    return
  }

  const draw = () => {
    const late = d.toPost.filter((o) => o.late)
    view().innerHTML = `${head(d.toPost.length ? `${d.toPost.length} to post${late.length ? ` · ${late.length} late` : ''}` : 'Nothing to post')}
      <div class="sh-bar"><span class="ps-sub-line" style="margin:0">Read from Shopify ${esc(when(d.at))}</span><button type="button" class="j-btn j-btn-line j-btn-sm" id="sh-refresh">Refresh</button></div>
      <div class="cs-days sh-tiles">
        <section class="cs-day${late.length ? ' sh-late' : ''}"><p class="cs-lbl">To post</p><p class="cs-big">${d.toPost.length}</p><p class="cs-note">${late.length ? `<span class="cs-flag">${late.length} waiting more than 2 days</span>` : d.toPost.length ? 'All under 2 days old' : 'All caught up'}</p></section>
        <section class="cs-day"><p class="cs-lbl">Today</p><p class="cs-big">${esc(money(d.today.cents))}</p><p class="cs-note">${d.today.orders} order${d.today.orders === 1 ? '' : 's'}</p></section>
        <section class="cs-day"><p class="cs-lbl">This week</p><p class="cs-big">${esc(money(d.week.cents))}</p><p class="cs-note">${d.week.orders} order${d.week.orders === 1 ? '' : 's'} since Monday</p></section>
        <section class="cs-day"><p class="cs-lbl">Last 30 days</p><p class="cs-big">${esc(money(d.month.cents))}</p><p class="cs-note">${d.month.orders} order${d.month.orders === 1 ? '' : 's'}</p></section>
      </div>
      <h2 class="sh-h">To post</h2>
      <div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Order</th><th>Items to send</th><th>Where to</th><th>Waiting</th><th class="ps-end"><span class="sr-only">Open</span></th></tr></thead><tbody>
        ${d.toPost.map((o) => `<tr data-sh="${esc(o.url)}"><td data-col="who"><b>${esc(o.name)}</b><span class="ps-sub">${esc(o.customer)}</span></td><td data-col="group">${esc(itemsText(o, true))}</td><td data-col="flags">${esc(where(o)) || '<span class="ps-sub">No address</span>'}</td><td data-col="pay">${psBadge(o.late ? 'red' : 'orange', age(o.ageDays))}<span class="ps-sub">${esc(when(o.createdAt))}</span></td><td class="ps-end"><a class="j-btn j-btn-line j-btn-sm" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Open in Shopify</a></td></tr>`).join('') || '<tr><td colspan="5"><div class="ps-empty">Nothing to post. New orders appear here as soon as they are paid.</div></td></tr>'}
      </tbody></table></div>
      <div class="sh-two">
        <section><h2 class="sh-h">Top products this week</h2>
          ${d.top.length ? `<ul class="jm-feelist">${d.top.map((t) => `<li><span>${esc(t.title.replace(/^Joner Football\s+/i, ''))}<small>${esc(money(t.cents))}</small></span><b>${t.qty}</b></li>`).join('')}</ul>` : '<p class="muted small">No sales yet this week.</p>'}
        </section>
        <section><h2 class="sh-h">Latest orders</h2>
          <div class="ps-table-wrap"><table class="ps-table ps-flat"><tbody>
            ${d.recent.slice(0, 12).map((o) => `<tr data-sh="${esc(o.url)}"><td data-col="who"><b>${esc(o.name)}</b> <span class="ps-sub">${esc(o.customer)} · ${esc(when(o.createdAt))}</span><span class="ps-sub">${esc(itemsText(o))}</span></td><td data-col="pay">${psBadge(...STATUS(o))}<span class="ps-sub">${esc(money(o.totalCents))}${o.refundedCents ? ` · ${esc(money(o.refundedCents))} refunded` : ''}${o.tracking?.number ? ` · ${o.tracking.url ? `<a href="${esc(o.tracking.url)}" target="_blank" rel="noopener noreferrer">${esc(o.tracking.number)}</a>` : esc(o.tracking.number)}` : ''}</span></td></tr>`).join('') || '<tr><td><div class="ps-empty">No orders in the last 35 days.</div></td></tr>'}
          </tbody></table></div>
        </section>
      </div>`
    view().querySelectorAll('[data-sh]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) window.open(r.dataset.sh, '_blank', 'noopener') }))
    view().querySelector('#sh-refresh').addEventListener('click', async (e) => {
      e.target.disabled = true
      try { d = (await load(true)).shop; draw(); toast('Read from Shopify again.') } catch (err) { e.target.disabled = false; toast(err.message) }
    })
    onCount?.(d.toPost.length, late.length)
  }
  draw()
}

import { sanityClient } from './sanityClient'
import { staticPageDefinitionByKey } from '../sanity/pageCatalog.js'

const PAGE_QUERY = `*[_type == "page" && pageKey == $pageKey && (publishStatus == "published" || !defined(publishStatus))] | order(_updatedAt desc)[0]{
  title,
  pageKey,
  pageMode,
  slug,
  heroEyebrow,
  heroHeadline,
  heroSubheadline,
  heroVideo,
  primaryCta,
  secondaryCta,
  buttonLinks[]{
    label,
    url,
    openInNewTab,
    style,
    trackingLabel
  },
  pricingBlocks[]{
    label,
    price,
    description,
    stripePaymentLink,
    paypalPaymentLink,
    featured
  },
  testimonials[]{
    quote,
    name,
    role,
    image{
      alt,
      caption,
      hideImage,
      "imageUrl": image.asset->url,
      "mobileImageUrl": mobileImage.asset->url
    }
  },
  faqs[]{
    question,
    answer
  },
  imageGallery[]{
    alt,
    caption,
    hideImage,
    "imageUrl": image.asset->url,
    "mobileImageUrl": mobileImage.asset->url
  },
  formSettings,
  seo{
    title,
    description,
    canonicalUrl,
    noIndex,
    "imageUrl": image.asset->url
  },
  heroImage{
    alt,
    caption,
    hideImage,
    "imageUrl": image.asset->url,
    "mobileImageUrl": mobileImage.asset->url
  },
  sections[]{
    _key,
    sectionType,
    label,
    active,
    eyebrow,
    headline,
    subheadline,
    body,
    videoUrl,
    trackingLabel,
    image{
      alt,
      caption,
      hideImage,
      "imageUrl": image.asset->url,
      "mobileImageUrl": mobileImage.asset->url
    },
    buttons[]{
      label,
      url,
      openInNewTab,
      style,
      trackingLabel
    },
    items[]{
      title,
      description,
      showItem,
      button,
      image{
        alt,
        caption,
        hideImage,
        "imageUrl": image.asset->url,
        "mobileImageUrl": mobileImage.asset->url
      }
    },
    pricingOptions[]{
      label,
      price,
      description,
      stripePaymentLink,
      paypalPaymentLink,
      featured
    },
    testimonials[]{
      quote,
      name,
      role,
      image{
        alt,
        caption,
        hideImage,
        "imageUrl": image.asset->url,
        "mobileImageUrl": mobileImage.asset->url
      }
    },
    faqs[]{
      question,
      answer
    },
    gallery[]{
      alt,
      caption,
      hideImage,
      "imageUrl": image.asset->url,
      "mobileImageUrl": mobileImage.asset->url
    }
  }
}`

export async function fetchSanityPage(pageKey: string) {
  try {
    const page = await sanityClient.fetch(PAGE_QUERY, { pageKey })
    const definition = staticPageDefinitionByKey[pageKey]

    if (page?.slug?.current) return page

    if (page && definition?.route) {
      return {
        ...page,
        slug: {
          current: definition.route === '/' ? '/' : definition.route.replace(/^\//, ''),
        },
      }
    }

    return page
  } catch (error) {
    console.error(`Sanity fetch failed for page ${pageKey}:`, error)
    return null
  }
}

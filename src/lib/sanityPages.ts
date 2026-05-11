import { sanityClient } from './sanityClient'

export async function fetchSanityPage(pageKey: string) {
  try {
    return await sanityClient.fetch(
      `*[_type == "page" && pageKey == $pageKey && publishStatus != "hidden"] | order(_updatedAt desc)[0]{
        title,
        pageKey,
        heroEyebrow,
        heroHeadline,
        heroSubheadline,
        primaryCta,
        secondaryCta,
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
      }`,
      { pageKey }
    )
  } catch (error) {
    console.error(`Sanity fetch failed for page ${pageKey}:`, error)
    return null
  }
}

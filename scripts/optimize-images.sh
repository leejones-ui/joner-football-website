#!/bin/bash
#
# Image optimization pipeline for the Joner Football site.
#
# What it does:
#   For every PNG and JPG inside `public/images/**`, generate sibling AVIF and
#   JPEG variants if they don't already exist (or if the source is newer).
#   AVIF gives ~85% smaller files than PNG with no visible quality loss for
#   photos. JPEG is the universal fallback for browsers that do not yet
#   support AVIF (Safari < 16.4, ancient Chrome / Firefox).
#
# Why sips:
#   macOS ships sips which writes AVIF natively. No Homebrew install, no Node
#   deps. Trade-off: sips does not write WebP. If you want WebP later, install
#   cwebp via Homebrew and add a second pass below.
#
# Markup pattern to use in .astro files:
#
#   <picture>
#     <source srcset="/images/foo.avif" type="image/avif" />
#     <source srcset="/images/foo.opt.jpg" type="image/jpeg" />
#     <img src="/images/foo.opt.jpg" alt="..." loading="lazy" />
#   </picture>
#
# Usage:
#   bash scripts/optimize-images.sh                            # all images
#   bash scripts/optimize-images.sh public/images/coaches-only # subset

set -e

ROOT="${1:-public/images}"
MAX_WIDTH=1600
AVIF_QUALITY=80
JPEG_QUALITY=82

if [[ ! -d "$ROOT" ]]; then
  echo "Directory not found: $ROOT" >&2
  exit 1
fi

kb() { echo "$(( ($1 + 512) / 1024 ))"; }   # bytes to KB, rounded

echo "Optimising images under: $ROOT"
echo "  Max width: ${MAX_WIDTH}px  AVIF q=$AVIF_QUALITY  JPEG q=$JPEG_QUALITY"
echo ""

count_in=0
count_out=0
saved_total=0

while IFS= read -r -d '' src; do
  count_in=$((count_in + 1))
  base="${src%.*}"
  avif_path="${base}.avif"
  jpeg_path="${base}.opt.jpg"

  src_size=$(stat -f %z "$src")
  src_mtime=$(stat -f %m "$src")

  # AVIF
  avif_mtime=0
  [[ -f "$avif_path" ]] && avif_mtime=$(stat -f %m "$avif_path")
  if [[ "$src_mtime" -gt "$avif_mtime" ]]; then
    /usr/bin/sips -Z $MAX_WIDTH -s format avif -s formatOptions $AVIF_QUALITY "$src" --out "$avif_path" >/dev/null 2>&1
    avif_size=$(stat -f %z "$avif_path")
    saved=$((src_size - avif_size))
    saved_total=$((saved_total + saved))
    count_out=$((count_out + 1))
    echo "  AVIF $(basename "$avif_path") -> $(kb $avif_size) KB (saved $(kb $saved) KB)"
  fi

  # JPEG fallback. Skip if source is already a .jpg or .jpeg.
  case "$src" in
    *.jpg|*.JPG|*.jpeg|*.JPEG) ;;
    *)
      jpeg_mtime=0
      [[ -f "$jpeg_path" ]] && jpeg_mtime=$(stat -f %m "$jpeg_path")
      if [[ "$src_mtime" -gt "$jpeg_mtime" ]]; then
        /usr/bin/sips -Z $MAX_WIDTH -s format jpeg -s formatOptions $JPEG_QUALITY "$src" --out "$jpeg_path" >/dev/null 2>&1
        jpeg_size=$(stat -f %z "$jpeg_path")
        count_out=$((count_out + 1))
        echo "  JPEG $(basename "$jpeg_path") -> $(kb $jpeg_size) KB"
      fi
      ;;
  esac
done < <(find "$ROOT" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \) -not -iname "*.opt.jpg" -print0)

echo ""
echo "Sources scanned: $count_in. Variants written: $count_out. Total saved: $(kb $saved_total) KB"

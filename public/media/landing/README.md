# Landing card photos

Source: the shop's own photos, supplied by the CEO on 2026-11-16 in two folders (`edited photos toyota vios` and `edited photos hilux toyota`, 10-20 MB JPEGs). Mapping, crops and alt text follow the UI/UX rulings in P1-88 section 17.13. The CEO recorded the pictured staff's consent on 2026-11-16. The source files are not in this repository.

Each file is a 4:3 crop at 1600 x 1200, converted to sRGB and saved as WebP (quality 72) with sharp, which writes no EXIF, GPS, XMP or ICC data. `next/image` serves smaller sizes from it. The tests in `src/components/landing/landing-page.test.ts` check the size, the dimensions and that no metadata chunk is present.

| File | Source | Card | Crop |
|---|---|---|---|
| `basic-wash.webp` | DSC00680 | Basic Wash | Left-anchored. The certificate wall is blurred in the pixels so no staff name can be read. |
| `signature-wash.webp` | DSC00696 | Signature Wash | Centre |
| `exterior-detailing.webp` | DSC00741 | Exterior Detailing | Right-anchored |
| `full-detailing.webp` | DSC00749 | Full Detailing | Centre |
| `eclipse.webp` | DSC00760 | Eclipse | From 11 % of the width |
| `arcane.webp` | DSC00762 | Arcane | Left-anchored, right edge at 86 % of the width, which drops the business licence placard |
| `kenzo.webp` | DSC00730 | Kenzo | Centre, all four items whole |

The mapping by catalog slug is in `src/components/landing/landing-photos.ts`. A photo sits only on the service it shows. Other cards keep the labelled "Photo coming soon" frame. No shot with a readable plate is used.

/**
 * Sample outputs for the login showcase wall, bundled in public/showcase/
 * (400 px wide WebP, 6 to 20 KB each). All were generated with this studio
 * (Soul 2 and Z-Image Turbo) for the template; forks can swap the files and
 * this list freely.
 */

export interface ShowcaseImage {
  src: string;
  width: number;
  height: number;
  /** Short description; the wall itself is decorative, so this is only used when an image is shown on its own. */
  alt: string;
}

export const SHOWCASE_IMAGES: readonly ShowcaseImage[] = [
  { src: "/showcase/canal-portrait.webp", width: 400, height: 533, alt: "Portrait in an orange coat on a rainy canal bridge at dusk" },
  { src: "/showcase/greenhouse-robot.webp", width: 400, height: 400, alt: "Orange robot watering plants in a greenhouse" },
  { src: "/showcase/tulip-fields.webp", width: 400, height: 227, alt: "Aerial view of striped tulip fields with a windmill" },
  { src: "/showcase/rocket-poster.webp", width: 400, height: 711, alt: "Retro poster of a rocket launching from a desert canyon" },
  { src: "/showcase/mug.webp", width: 400, height: 300, alt: "Matte black coffee mug on an oak table in morning light" },
  { src: "/showcase/perfume.webp", width: 400, height: 533, alt: "Perfume bottle on volcanic rock with splashing water" },
  { src: "/showcase/holo-workspace.webp", width: 400, height: 227, alt: "Minimal workspace with a holographic dashboard at night" },
  { src: "/showcase/skateboarder.webp", width: 400, height: 600, alt: "Skateboarder in the air over a concrete bowl at golden hour" },
  { src: "/showcase/floating-island.webp", width: 400, height: 400, alt: "Isometric floating island city with waterfalls" },
  { src: "/showcase/latte-art.webp", width: 400, height: 706, alt: "Barista pouring latte art in a warm cafe" },
];

/**
 * Splits items into `count` columns of similar height (masonry): each item
 * goes to the column that is currently shortest, measured in widths so every
 * column is assumed to have the same width. Order within a column is kept.
 */
export function balanceColumns<T extends { width: number; height: number }>(items: readonly T[], count: number): T[][] {
  const columns = Math.max(1, Math.floor(count));
  const result: T[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < columns; i += 1) if (heights[i] < heights[target]) target = i;
    result[target].push(item);
    heights[target] += item.width > 0 ? item.height / item.width : 1;
  }
  return result;
}

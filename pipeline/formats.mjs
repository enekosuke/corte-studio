import { RequestError } from './errors.mjs';

const sizes = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const layouts = ['fill', 'fit', 'split', 'three', 'four', 'shared', 'gameplay'];
const fitRatios = { original: null, '4:3': 4 / 3, '1:1': 1 };
const contentCrops = ['auto', 'side', 'below'];
export const defaultFormat = { ratio: '9:16', layouts, fitCrop: 'original', contentCrop: 'auto' };
export const formatCatalog = { ratios: Object.keys(sizes), sizes, layouts, fitCrops: Object.keys(fitRatios), contentCrops };
export const outputSize = ({ ratio }) => sizes[ratio];

export function normalizeFormat(input = defaultFormat) {
  const { ratio, layouts: enabled, fitCrop, contentCrop = 'auto' } = input ?? {};
  if (!Object.hasOwn(sizes, ratio) || !Array.isArray(enabled) || !enabled.length || enabled.some((layout) => !layouts.includes(layout)) || !Object.hasOwn(fitRatios, fitCrop) || !contentCrops.includes(contentCrop)) {
    throw new RequestError(400, 'Elige una proporción, un recorte para Ajustar, una pantalla de contenido y al menos un diseño.');
  }
  return { ratio, layouts: layouts.filter((layout) => enabled.includes(layout)), fitCrop, contentCrop };
}

const even = (value) => Math.floor(value / 2) * 2;
export const CONTAIN_Y_FACTORS = { top: 0.5, bottom: 0.28, fit: 0.4 };

/**
 * Compute even-aligned vertical offset inside a contain panel so gameplay and fit
 * frames sit slightly higher and stay clear of mobile Shorts descriptions.
 */
export function containOffsetY(containerHeight, contentHeight, role = 'bottom') {
  const factor = CONTAIN_Y_FACTORS[role] ?? CONTAIN_Y_FACTORS.bottom;
  return Math.max(0, even(Math.max(0, containerHeight - contentHeight) * factor));
}

export function insetTitleReserve(format) {
  const [width, height] = outputSize(format);
  return even(192 * Math.min(width / 1080, height / 1920));
}

export function layoutPanels(layout, ratio) {
  const [width, height] = sizes[ratio];
  const midX = even(width / 2);
  const midY = even(height / 2);
  if (layout === 'fill' || layout === 'fit') return [{ x: 0, y: 0, width, height }];
  if (layout === 'shared' || layout === 'gameplay') {
    const top = even(height * (layout === 'shared' ? 0.37 : 0.31));
    return [{ x: 0, y: 0, width, height: top, contain: true, headingSpace: 108 }, { x: 0, y: top, width, height: height - top, contain: true }];
  }
  const top = layout === 'four'
    ? [{ x: 0, y: 0, width: midX, height: midY }, { x: midX, y: 0, width: width - midX, height: midY }]
    : [{ x: 0, y: 0, width, height: midY }];
  if (layout === 'split') return [...top, { x: 0, y: midY, width, height: height - midY }];
  return [...top, { x: 0, y: midY, width: midX, height: height - midY }, { x: midX, y: midY, width: width - midX, height: height - midY }];
}

const decimal = (value) => Number(value).toFixed(5);

function axis(points, coordinate) {
  if (!points.length) return '0.5';
  let expression = decimal(points.at(-1)[coordinate]);
  for (let index = points.length - 2; index >= 0; index--) {
    const current = points[index];
    const next = points[index + 1];
    const start = decimal(current[coordinate]);
    const delta = decimal(next[coordinate] - current[coordinate]);
    const blend = next.cutBefore ? start : `${start}+(${delta})*clip((t-${decimal(current.offset)})/${decimal(next.offset - current.offset)},0,1)`;
    expression = `if(lt(t,${decimal(next.offset)}),${blend},${expression})`;
  }
  return expression;
}

function windowCrop(width, height, points) {
  return `crop=w='max(2,trunc((${width})/2)*2)':h='max(2,trunc((${height})/2)*2)':x='max(0,min(iw-ow,iw*(${axis(points, 'x')})-ow/2))':y='max(0,min(ih-oh,ih*(${axis(points, 'y')})-oh/2))'`;
}

const cropAspect = (aspect, points) => windowCrop(`min(iw,ih*${aspect})`, `min(ih,iw/${aspect})`, points);

export function compositionGraph(plan, format, { reserveInsetTitle = false } = {}) {
  const [width, height] = sizes[format.ratio];
  const layout = plan.layout ?? (plan.mode === 'follow' ? 'fill' : 'fit');
  const tracks = plan.tracks ?? [plan.points?.map((point) => ({ ...point, x: point.center, y: 0.5 })) ?? []];
  const norm = "scale=w='max(2,trunc(iw*sar/2)*2)':h='trunc(ih/2)*2',setsar=1";
  if (layout === 'fill') return `[0:v]${norm},${cropAspect(width / height, tracks[0])},scale=${width}:${height}`;
  if (layout === 'fit') {
    const aspect = fitRatios[format.fitCrop];
    const r0 = plan.regions?.[0];
    const hasRegionCrop = !aspect && r0 && (r0.width < 0.99 || r0.height < 0.99);
    const crop = aspect
      ? `${cropAspect(aspect, tracks[0])},`
      : (hasRegionCrop ? `${windowCrop(`iw*${decimal(r0.width)}`, `ih*${decimal(r0.height)}`, tracks[0])},` : '');
    return `[0:v]${norm},split[back][front];[back]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:2,eq=brightness=-0.15[bg];[front]${crop}scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:trunc((H-h)*${CONTAIN_Y_FACTORS.fit}/2)*2`;
  }
  const panels = layoutPanels(layout, format.ratio);
  const inputs = panels.map((_, index) => `[in${index}]`).join('');
  const tiles = panels.map(({ width: w, height: h, contain, headingSpace = 0 }, index) => {
    const points = tracks[index] ?? [];
    const { width: regionWidth = 1, height: regionHeight = 1 } = plan.regions?.[index] ?? {};
    if (!contain) {
      const aspect = w / h;
      const span = `min(min(iw,ih*${aspect}),max(iw*${decimal(regionWidth)},ih*${decimal(regionHeight)}*${aspect}))`;
      return `[in${index}]${windowCrop(span, `(${span})/${aspect}`, points)},scale=${w}:${h},setsar=1[tile${index}]`;
    }
    const crop = windowCrop(`iw*${decimal(regionWidth)}`, `ih*${decimal(regionHeight)}`, points);
    const visibleHeight = h - headingSpace;
    const yFactor = index === 0 ? CONTAIN_Y_FACTORS.top : CONTAIN_Y_FACTORS.bottom;
    const titleReserve = reserveInsetTitle && index === 1 ? insetTitleReserve(format) : 0;
    const naturalOffset = `trunc((H-h)*${yFactor}/2)*2`;
    const offset = titleReserve ? `'max(${titleReserve},${naturalOffset})'` : naturalOffset;
    return `[in${index}]${crop},split[blur${index}][sharp${index}];[blur${index}]scale=${w}:${visibleHeight}:force_original_aspect_ratio=increase,crop=${w}:${visibleHeight},boxblur=16:2,eq=brightness=-0.20[canvas${index}];[sharp${index}]scale=${w}:${visibleHeight - titleReserve}:force_original_aspect_ratio=decrease:force_divisible_by=2[visible${index}];[canvas${index}][visible${index}]overlay=(W-w)/2:${offset},pad=${w}:${h}:0:${headingSpace}:color=0x171820,setsar=1[tile${index}]`;
  });
  const stack = panels.map((_, index) => `[tile${index}]`).join('');
  const positions = panels.map(({ x, y }) => `${x}_${y}`).join('|');
  return `[0:v]${norm},split=${panels.length}${inputs};${tiles.join(';')};${stack}xstack=inputs=${panels.length}:layout=${positions}:fill=black`;
}

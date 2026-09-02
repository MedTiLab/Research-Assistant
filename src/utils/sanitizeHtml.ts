import DOMPurify from 'dompurify';

const HTML_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const HTML_ATTRS = [
  'alt',
  'aria-label',
  'aria-labelledby',
  'class',
  'colspan',
  'dir',
  'height',
  'href',
  'lang',
  'rel',
  'rowspan',
  'scope',
  'src',
  'target',
  'title',
  'width',
];

const SVG_TAGS = [
  'a',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'g',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'style',
  'svg',
  'text',
  'textPath',
  'title',
  'tspan',
  'use',
];

const SVG_ATTRS = [
  'alignment-baseline',
  'aria-label',
  'aria-labelledby',
  'class',
  'clip-path',
  'clip-rule',
  'cx',
  'cy',
  'd',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'href',
  'id',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'offset',
  'opacity',
  'orient',
  'points',
  'preserveAspectRatio',
  'r',
  'refX',
  'refY',
  'role',
  'rx',
  'ry',
  'spreadMethod',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'style',
  'text-anchor',
  'transform',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'xlink:href',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
];

const URI_PATTERN = /^(?:(?:https?|mailto|tel|data:image\/(?:png|gif|jpeg|webp|svg\+xml);base64):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const SVG_URI_PATTERN = /^(?:#|data:image\/(?:png|gif|jpeg|webp);base64)/i;

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  const attrName = String(data.attrName || '').toLowerCase();
  const attrValue = String(data.attrValue || '').trim();

  if (attrName.startsWith('on')) {
    data.keepAttr = false;
    return;
  }

  if ((attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') && /^javascript:/i.test(attrValue)) {
    data.keepAttr = false;
    return;
  }

  const isSvgNode = (typeof SVGElement !== 'undefined' && node instanceof SVGElement)
    || ('ownerSVGElement' in node && Boolean(node.ownerSVGElement));
  if (isSvgNode && attrName === 'style' && /url\(\s*(?!['"]?#)/i.test(attrValue)) {
    data.keepAttr = false;
  }
});

export function sanitizeHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: HTML_TAGS,
    ALLOWED_ATTR: HTML_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOWED_URI_REGEXP: URI_PATTERN,
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  });
}

export function sanitizeSvg(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOWED_TAGS: SVG_TAGS,
    ALLOWED_ATTR: SVG_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOWED_URI_REGEXP: SVG_URI_PATTERN,
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror', 'onmouseover', 'onmouseenter', 'onmouseleave'],
  });
}

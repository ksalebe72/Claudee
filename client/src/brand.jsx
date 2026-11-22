// Aplica la marca (colores y logo) cargada por el dueño en Ajustes → General.
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const mix = (rgb, to, t) => rgb.map((c, i) => Math.round(c + (to[i] - c) * t));
const css = (rgb) => `rgb(${rgb.join(',')})`;

export function applyBrand(brand) {
  const root = document.documentElement.style;
  const props = ['--primary', '--primary-soft', '--on-primary', '--sidebar', '--sidebar-text', '--sidebar-strong', '--sidebar-active', '--brand-gradient'];
  props.forEach((p) => root.removeProperty(p));
  if (!brand) return;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  if (brand.primary) {
    const p = hexToRgb(brand.primary);
    root.setProperty('--primary', brand.primary);
    root.setProperty('--primary-soft', css(dark ? mix(p, [23, 27, 45], 0.75) : mix(p, [255, 255, 255], 0.88)));
    root.setProperty('--on-primary', luminance(p) > 165 ? '#111' : '#fff');
  }
  if (brand.sidebar) {
    const s = hexToRgb(brand.sidebar);
    const claro = luminance(s) > 165;
    root.setProperty('--sidebar', brand.sidebar);
    root.setProperty('--sidebar-text', claro ? '#333' : '#d6d9e8');
    root.setProperty('--sidebar-strong', claro ? '#111' : '#fff');
    root.setProperty('--sidebar-active', claro ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.14)');
  }
  if (brand.gradient?.length) root.setProperty('--brand-gradient', `linear-gradient(90deg, ${brand.gradient.join(', ')})`);
  const icon = brand.icon || brand.logo;
  const link = document.querySelector("link[rel='icon']");
  if (link && icon) link.href = icon;
  if (brand.name) document.title = `${brand.name} · ColorPlus OS`;
}

/** Símbolo de la marca (para el menú). */
export function BrandMark({ brand, className = '' }) {
  const src = brand?.icon || brand?.logo;
  return src
    ? <img src={src} alt={brand.name || 'Logo'} className={`brand-mark ${className}`} />
    : <div className={`logo ${className}`}>CP</div>;
}

/** Logo completo (inicio de sesión, portal). */
export function BrandLogo({ brand, className = '' }) {
  return brand?.logo ? <img src={brand.logo} alt={brand.name || 'Logo'} className={`brand-logo-full ${className}`} /> : <BrandMark brand={brand} />;
}

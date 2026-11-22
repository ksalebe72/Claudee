// Simulador de SanMar Web Services para pruebas locales (NO es SanMar real).
// Imita los tres servicios: SanMarProductInfoServicePort, SanMarPricingServicePort y SanMarWebServicePort.
// Estilos especiales: LENTO (tarda 3 s), LIMITE (HTTP 429), INESTABLE (corta la 1ª conexión), cualquier otro → no encontrado.
import http from 'node:http';

const COLORES = [
  { nombre: 'Jet Black', codigo: 'JET BLACK', hex: '#1d1d1f' },
  { nombre: 'Navy', codigo: 'NAVY', hex: '#1f2a44' },
  { nombre: 'Athletic Heather', codigo: 'ATH HEATHER', hex: '#b9bcc0' },
];
const TALLAS = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const USUARIO = 'test';

const tee = (fill, back) => `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100" viewBox="0 0 400 440"><rect width="400" height="440" fill="#fff"/><path d="M150 22 C${back ? '175 34 225 34' : '170 48 230 48'} 250 22 L330 46 L392 128 L340 160 L318 132 L320 424 C240 432 160 432 80 424 L82 132 L60 160 L8 128 L70 46 Z" fill="${fill}" stroke="#333"/><text x="200" y="420" font-size="10" text-anchor="middle" fill="#999">SIMULADOR ${back ? 'ESPALDA' : 'FRENTE'}</text></svg>`;
const env = (inner, ns = 'http://impl.webservice.integration.sanmar.com/') =>
  `<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:resp xmlns:ns2="${ns}"><return>${inner}</return></ns2:resp></S:Body></S:Envelope>`;
const tag = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? '';
const precio = (talla) => (['2XL', '3XL'].includes(talla) ? 5.12 : 3.18);

export function startMock(port) {
  const base = `http://localhost:${port}`;
  const stats = { llamadas: { producto: 0, precios: 0, inventario: 0 }, inestable: 0 };
  const img = (c, side) => `${base}/img/${encodeURIComponent(c.nombre)}/${side}.svg`;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const [, , color, side] = req.url.split('/');
      const c = COLORES.find((x) => x.nombre === decodeURIComponent(color));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(tee(c?.hex || '#888', side.startsWith('back')));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const send = (xml, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/xml' }); res.end(xml); };
      const servicio = req.url.includes('ProductInfo') ? 'producto' : req.url.includes('Pricing') ? 'precios' : 'inventario';
      stats.llamadas[servicio]++;

      const user = servicio === 'inventario' ? tag(body, 'arg1') : tag(body, 'sanMarUserName');
      const style = servicio === 'inventario' ? tag(body, 'arg3') : tag(body, 'style');
      const color = servicio === 'inventario' ? tag(body, 'arg4') : tag(body, 'color');
      const size = servicio === 'inventario' ? tag(body, 'arg5') : tag(body, 'size');

      if (style === 'LENTO') await new Promise((r) => setTimeout(r, 3000));
      if (style === 'LIMITE') return send('Too Many Requests', 429);
      if (style === 'INESTABLE' && stats.inestable++ === 0) return req.socket.destroy();
      if (user !== USUARIO) return send(env(`<errorOccured>true</errorOccured><message>Invalid User Name or Password for customer</message>`));
      const estiloOk = ['PC61', 'INESTABLE'].includes(style);
      if (!estiloOk) return send(env(`<errorOccured>true</errorOccured><message>No data found for style ${style}</message>`));

      if (servicio === 'producto') {
        const filas = COLORES.flatMap((c) => TALLAS.map((t) => `<listResponse>
          <productBasicInfo><availableSizes>S-3XL</availableSizes><brandName>Port &amp; Company</brandName><catalogColor>${c.nombre}</catalogColor><color>${c.codigo}</color><pieceWeight>0.42</pieceWeight><productDescription>&lt;p&gt;Camiseta de algodón 6.1 oz.&lt;/p&gt;</productDescription><productStatus>Active</productStatus><productTitle>Port &amp; Company Essential Tee. PC61</productTitle><size>${t}</size><style>${style}</style></productBasicInfo>
          <productImageInfo><colorSwatchImage>${img(c, 'swatch')}</colorSwatchImage><frontFlat>${img(c, 'front')}</frontFlat><backFlat>${img(c, 'back')}</backFlat><frontModel>${img(c, 'front-model')}</frontModel><backModel>${img(c, 'back-model')}</backModel><sideModel>${img(c, 'side-model')}</sideModel></productImageInfo>
          <productPriceInfo><piecePrice>9.99</piecePrice></productPriceInfo></listResponse>`)).join('');
        return send(env(`<errorOccured>false</errorOccured><message/>${filas}`));
      }
      if (servicio === 'precios') {
        // Solo acepta el código de color (para probar que el cliente usa el código primero).
        const cs = color ? COLORES.filter((c) => c.codigo === color) : COLORES;
        if (!cs.length) return send(env(`<errorOccured>true</errorOccured><message>No pricing found</message>`));
        const filas = cs.flatMap((c) => TALLAS.map((t) => `<listResponse><casePrice>${(precio(t) * 1.05).toFixed(2)}</casePrice><color>${c.codigo}</color><myPrice>${precio(t)}</myPrice><piecePrice>${(precio(t) * 1.4).toFixed(2)}</piecePrice><size>${t}</size><style>${style}</style></listResponse>`)).join('');
        return send(env(`<errorOccured>false</errorOccured><message/>${filas}`));
      }
      // inventario
      const c = COLORES.find((x) => x.codigo === color || x.nombre === color);
      if (!c || !TALLAS.includes(size)) return send(env(`<errorOccurred>true</errorOccurred><message>No inventory found</message>`, 'http://webservice.integration.sanmar.com/'));
      const q = (TALLAS.indexOf(size) + 1) * 100;
      return send(env(`<errorOccurred>false</errorOccurred><message/><response><skus><sku><color>${c.codigo}</color><size>${size}</size><style>${style}</style>
        <whse><whseID>1</whseID><whseName>Seattle, WA</whseName><qty>${q}</qty></whse>
        <whse><whseID>2</whseID><whseName>Cincinnati, OH</whseName><qty>${q * 2}</qty></whse>
        <whse><whseID>3</whseID><whseName>Dallas, TX</whseName><qty>0</qty></whse></sku></skus></response>`, 'http://webservice.integration.sanmar.com/'));
    });
  });
  server.stats = stats;
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1]?.endsWith('sanmar-mock.js')) startMock(Number(process.argv[2]) || 4555).then(() => console.log('Simulador SanMar listo'));

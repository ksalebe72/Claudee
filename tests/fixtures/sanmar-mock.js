// Servidor que imita el servicio SOAP de SanMar (formato getProductInfoByStyleColorSize) para pruebas locales.
import http from 'node:http';

const tee = (fill, back) => `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100" viewBox="0 0 400 440"><rect width="400" height="440" fill="#fff"/><path d="M150 22 C${back ? '175 34 225 34' : '170 48 230 48'} 250 22 L330 46 L392 128 L340 160 L318 132 L320 424 C240 432 160 432 80 424 L82 132 L60 160 L8 128 L70 46 Z" fill="${fill}" stroke="#333"/><text x="200" y="420" font-size="10" text-anchor="middle" fill="#999">MOCK ${back ? 'BACK' : 'FRONT'}</text></svg>`;
const COLORS = { Navy: '#1f2a44', Red: '#c62828', 'Athletic Heather': '#b9bcc0' };

export function startMock(port) {
  const base = `http://localhost:${port}`;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const [, , color, side] = req.url.split('/');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(tee(COLORS[decodeURIComponent(color)] || '#888', side.startsWith('back')));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const style = /<style>([^<]*)<\/style>/.exec(body)?.[1];
      const ok = /<sanMarUserName>test<\/sanMarUserName>/.test(body);
      let inner;
      if (!ok) inner = '<errorOccured>true</errorOccured><message>Invalid credentials</message>';
      else if (style !== 'PC54') inner = '<errorOccured>false</errorOccured><message/>';
      else {
        inner = '<errorOccured>false</errorOccured><message/>' + Object.keys(COLORS).flatMap((c) => ['S', 'M', 'L', '2XL'].map((size) => `
          <listResponse>
            <productBasicInfo><brandName>Port &amp; Company</brandName><catalogColor>${c}</catalogColor><color>${c.toUpperCase()}</color><productTitle>Port &amp; Company Core Cotton Tee. PC54</productTitle><size>${size}</size><style>PC54</style></productBasicInfo>
            <productImageInfo><colorSwatchImage>${base}/img/${encodeURIComponent(c)}/swatch.svg</colorSwatchImage><frontFlat>${base}/img/${encodeURIComponent(c)}/front.svg</frontFlat><backFlat>${base}/img/${encodeURIComponent(c)}/back.svg</backFlat><frontModel>${base}/img/${encodeURIComponent(c)}/front-model.svg</frontModel><backModel>${base}/img/${encodeURIComponent(c)}/back-model.svg</backModel></productImageInfo>
            <productPriceInfo><piecePrice>${size === '2XL' ? '4.98' : '2.98'}</piecePrice></productPriceInfo>
          </listResponse>`)).join('');
      }
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:getProductInfoByStyleColorSizeResponse xmlns:ns2="http://impl.webservice.integration.sanmar.com/"><return>${inner}</return></ns2:getProductInfoByStyleColorSizeResponse></S:Body></S:Envelope>`);
    });
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1]?.endsWith('sanmar-mock.js')) startMock(Number(process.argv[2]) || 4555).then(() => console.log('mock SanMar listo'));

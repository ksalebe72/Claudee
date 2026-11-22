// Exportación de una liquidación de comisiones a PDF y Excel.
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

const money = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctTxt = (t) => (t == null ? '—' : `${Math.round(t * 10000) / 100}%`);
const BASES = { venta_neta: 'Venta neta', ganancia_producto: 'Ganancia de producto', ganancia_total: 'Ganancia producto + envío' };
const ESTADOS = { borrador: 'Borrador', revisada: 'Revisada por Finanzas', aprobada: 'Aprobada por la dueña', pagada: 'Pagada' };

const COLUMNAS = [
  ['Tipo', (e) => (e.tipo === 'ajuste' ? 'Ajuste' : 'Orden')],
  ['Orden', (e) => e.orden],
  ['Cliente', (e) => e.cliente],
  ['Fecha factura', (e) => e.fechaFactura || '—'],
  ['Cobro completo', (e) => e.fechaCobroCompleto || '—'],
  ['Venta neta', (e) => e.ventaNeta, true],
  ['Costo', (e) => e.costo, true],
  ['Ganancia', (e) => e.ganancia, true],
  ['Base comisionable', (e) => e.base, true],
  ['Tasa', (e) => pctTxt(e.tasa)],
  ['Comisión', (e) => e.monto, true],
  ['Estado', (e) => e.estado],
];

export function liquidationPdf(v, business, res, logoPath = null) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36 });
  doc.pipe(res);
  const L = v.liquidacion;
  if (logoPath) {
    try { doc.image(logoPath, doc.page.width - doc.page.margins.right - 70, 24, { fit: [70, 70] }); } catch { /* si la imagen no se puede leer, sigue sin logo */ }
  }
  doc.font('Helvetica-Bold').fontSize(16).text(`${business} · Liquidación de comisiones`);
  doc.font('Helvetica').fontSize(11).fillColor('#444')
    .text(`Vendedor: ${v.vendedor?.name || '—'}    Mes: ${v.periodo}    Pago previsto: ${L.fechaPagoPrevista}`)
    .text(`Estado: ${ESTADOS[L.status] || L.status}${L.reviewed_by ? `   · Revisó: ${L.reviewed_by}` : ''}${L.approved_by ? `   · Aprobó: ${L.approved_by}` : ''}${L.paid_at ? `   · Pagada el ${L.paid_at} (ref. ${L.paid_reference})` : ''}`);
  doc.moveDown(0.8).fillColor('#000');
  if (logoPath) doc.y = Math.max(doc.y, 24 + 70 + 8); // la tabla empieza debajo del logo

  const widths = [44, 58, 110, 62, 66, 64, 60, 60, 66, 42, 62, 46];
  const x0 = doc.page.margins.left;
  const row = (cells, bold = false) => {
    const y = doc.y;
    let x = x0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((c, i) => { doc.text(String(c), x + 2, y, { width: widths[i] - 4, align: COLUMNAS[i][2] ? 'right' : 'left' }); x += widths[i]; });
    doc.x = x0; // vuelve al margen izquierdo para el texto que sigue
    doc.y = y + (bold ? 24 : 16);
    if (doc.y > doc.page.height - 60) doc.addPage();
  };
  row(COLUMNAS.map((c) => c[0]), true);
  doc.moveTo(x0, doc.y - 3).lineTo(x0 + widths.reduce((a, b) => a + b, 0), doc.y - 3).strokeColor('#999').stroke();
  for (const e of v.entradas) row(COLUMNAS.map(([, f, m]) => (m ? money(f(e)) : f(e))));
  if (!v.entradas.length) row(['Sin órdenes en este mes'].concat(Array(11).fill('')));
  const anchoTabla = widths.reduce((a, b) => a + b, 0);
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).text(`Total a pagar: ${money(v.total)}`, x0, doc.y, { width: anchoTabla, align: 'right' });

  if (v.pendientes.length) {
    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Órdenes que todavía no entran a liquidación', x0, doc.y, { width: anchoTabla });
    doc.font('Helvetica').fontSize(8);
    for (const p of v.pendientes) doc.text(`${p.orden} · ${p.cliente} · ${p.estado}${p.saldo > 0 ? ` · saldo ${money(p.saldo)}` : ''}${p.faltantes?.length ? ` · falta: ${p.faltantes.join('; ')}` : ''}`);
  }
  doc.moveDown(1).fontSize(7).fillColor('#666').text('Documento generado por ColorPlus OS. El sistema calcula la liquidación; el pago lo realiza una persona fuera del sistema.', x0, doc.y, { width: anchoTabla });
  doc.end();
}

export async function liquidationXlsx(v, business) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ColorPlus OS';
  const ws = wb.addWorksheet(`Liquidación ${v.periodo}`);
  const L = v.liquidacion;
  ws.addRow([`${business} · Liquidación de comisiones`]).font = { bold: true, size: 14 };
  ws.addRow([`Vendedor: ${v.vendedor?.name || '—'}`, '', `Mes: ${v.periodo}`, '', `Pago previsto: ${L.fechaPagoPrevista}`]);
  ws.addRow([`Estado: ${ESTADOS[L.status] || L.status}`, '', L.paid_at ? `Pagada: ${L.paid_at} (ref. ${L.paid_reference})` : '']);
  ws.addRow([]);
  const head = ws.addRow(COLUMNAS.map((c) => c[0]));
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E8FF' } }; });
  for (const e of v.entradas) {
    const r = ws.addRow(COLUMNAS.map(([, f, m]) => (m ? f(e) ?? null : f(e))));
    COLUMNAS.forEach(([, , m], i) => { if (m) r.getCell(i + 1).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00'; });
  }
  const t = ws.addRow(['', '', '', '', '', '', '', '', '', 'Total', v.total]);
  t.font = { bold: true };
  t.getCell(11).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
  if (v.pendientes.length) {
    ws.addRow([]);
    ws.addRow(['Órdenes que todavía no entran']).font = { bold: true };
    ws.addRow(['Orden', 'Cliente', 'Estado', 'Saldo', 'Falta']).font = { bold: true };
    for (const p of v.pendientes) ws.addRow([p.orden, p.cliente, p.estado, p.saldo, (p.faltantes || []).join('; ')]);
  }
  ws.columns.forEach((c, i) => { c.width = [8, 10, 26, 13, 14, 13, 12, 12, 16, 8, 12, 12][i] || 14; });
  return wb.xlsx.writeBuffer();
}

export { BASES };

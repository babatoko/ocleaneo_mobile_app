import PDFDocument from 'pdfkit';

export function renderOrderPdf(order, res) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="commande-${order.id}.pdf"`
  );
  doc.pipe(res);

  doc.fontSize(18).text('Ocleaneo — Récapitulatif de commande', { align: 'center' });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Commande n°${order.id}`);
  doc.text(`Chantier : ${order.chantier_name}`);
  doc.text(`Salarié : ${order.employee_name}`);
  doc.text(`Date : ${order.created_at}`);
  doc.moveDown();

  doc.fontSize(13).text('Produits commandés', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  for (const item of order.items) {
    doc.text(
      `${item.product_emoji} ${item.product_name} — ${item.packaging_label} × ${item.quantity}`
    );
  }

  doc.end();
}

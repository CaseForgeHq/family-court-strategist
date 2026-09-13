// Small real PDF with a selectable text layer. Fictional content only.
export function samplePdf(text = "On 2024-03-19, Alex reported that the changeover did not occur.") {
  const escaped = text.replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 12 Tf 40 750 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function findings(id) {
  const sources = [{ documentId: id, page: 1, quote: "Alex reported that the changeover did not occur." }];
  return { summary: "The document records Alex's account of a missed changeover.", limitations: ["Only the supplied documents were reviewed. The account has not been independently verified."], findings: [
    { kind: "event", title: "Alex reports missed changeover", detail: "Alex reports that the changeover did not occur; this remains an attributed account.", date: "2024-03-19", sources },
    { kind: "claim", title: "Alex's changeover account", detail: "Alex says the changeover did not occur.", date: null, sources },
    { kind: "claim", title: "Unsupported model output", detail: "This intentionally invalid test finding must never be saved.", date: null, sources: [{ documentId: id, page: 1, quote: "This text does not exist in the source document." }] },
  ] };
}

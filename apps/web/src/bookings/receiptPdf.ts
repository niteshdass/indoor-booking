/**
 * Renders the receipt element to an A4 PDF and downloads it. The libraries load on first use only.
 * The page is drawn as an image, so any script (Cyrillic included) comes out as on screen; the
 * clone it is drawn from is switched to the light theme, whatever the app theme is.
 */
export async function downloadReceiptPdf(node: HTMLElement, fileName: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: null,
    onclone: (doc) => {
      doc.documentElement.dataset.theme = 'light';
      // SVGs are cloned with the page's (possibly dark) styles inlined and drawn as separate
      // images, so the copied styles are dropped and the light colours written in.
      const svgs = [...doc.querySelectorAll<SVGElement>('svg, svg *')];
      svgs.forEach((el) => el.removeAttribute('style'));
      svgs.forEach((el) => {
        const { fill, stroke, strokeWidth } = doc.defaultView!.getComputedStyle(el);
        Object.assign(el.style, { fill, stroke, strokeWidth });
      });
    },
  });
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // Full page width; shrunk to fit if it is ever taller than one page.
  const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
  // Compressed, or the PNG is stored raw and the file runs to megabytes.
  pdf.addImage(canvas, 'PNG', 0, 0, canvas.width * scale, canvas.height * scale, undefined, 'FAST');
  pdf.save(fileName);
}

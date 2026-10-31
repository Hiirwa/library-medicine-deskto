import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** QR code as an SVG string (black on white, quiet zone included). */
export function qrSvg(text: string, cell = 8): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 3, scalable: true });
}

export function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const svg = useMemo(() => qrSvg(text), [text]);
  return <div className="qr" style={{ width: size, height: size }} role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

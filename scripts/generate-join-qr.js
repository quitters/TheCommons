import fs from 'node:fs/promises';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run qr -- https://your-public-address/station/');
const url = new URL(input);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) participant URL without credentials.');
const directory = new URL('../client/shared/', import.meta.url);
const options = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
const svg = await QRCode.toString(url.href, { ...options, type: 'svg', width: 600 });
const png = await QRCode.toBuffer(url.href, { ...options, width: 900 });
const decoded = PNG.sync.read(png);
const scanned = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
if (scanned?.data !== url.href) throw new Error('Generated QR did not decode to the participant URL. Existing join code retained.');
await fs.writeFile(new URL('join-qr.svg', directory), svg);
await fs.writeFile(new URL('join-qr.png', directory), png);
// Publish the new address last so pages only reload the QR after both files exist.
await fs.writeFile(new URL('join-current.json', directory), JSON.stringify({ url: url.href, updatedAt: Date.now() }));
console.log(`Join QR ready for ${url.href}\nLarge view: /shared/join.html\nPrint/download: /shared/join-qr.png`);

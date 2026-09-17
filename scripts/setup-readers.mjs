import { resolve } from 'node:path';
import { getReaderStatus, provisionReaders } from '../app/lib/reader-dependencies.js';

const directoryIndex = process.argv.indexOf('--directory');
const directory = directoryIndex >= 0 ? resolve(process.argv[directoryIndex + 1] || '') : undefined;
if (directoryIndex >= 0 && !process.argv[directoryIndex + 1]) throw new Error('--directory requires a local directory path.');
if (process.argv.includes('--status')) {
  console.log(JSON.stringify(getReaderStatus({ directory }), null, 2));
} else {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  let lastMessage = '';
  try {
    const result = await provisionReaders({ directory, signal: controller.signal, onProgress(progress) {
      const message = `${progress.dependency}: ${progress.state} ${Math.floor(progress.bytes / 10_000_000) * 10} MB`;
      if (message !== lastMessage) { console.log(message); lastMessage = message; }
    } });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

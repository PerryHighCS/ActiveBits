import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const loaderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'jsx-loader.mjs');
register(pathToFileURL(loaderPath).href, pathToFileURL('./'));

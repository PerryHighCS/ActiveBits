import esbuild from 'esbuild';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { transform } = esbuild;

const resolveWithExtensions = async (basePath) => {
  const candidates = [
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};

export async function resolve(specifier, context, defaultResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !path.extname(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const basePath = specifier.startsWith('/')
      ? specifier
      : path.resolve(path.dirname(parentPath), specifier);
    const resolved = await resolveWithExtensions(basePath);
    if (resolved) {
      return {
        url: pathToFileURL(resolved).href,
        shortCircuit: true,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default "";',
      shortCircuit: true,
    };
  }

  if (url.endsWith('.jsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const result = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      sourcemap: 'inline',
      sourcefile: fileURLToPath(url),
    });

    return {
      format: 'module',
      source: result.code,
      shortCircuit: true,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}

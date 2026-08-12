import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://holinessfoundation.org/sermons';
const OUTPUT_URL = new URL('../public/sermons.json', import.meta.url);

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&bull;/gi, '•')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_match, hex, decimal) => String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePreacher(value) {
  const [lastName, ...givenNames] = value.split(',');
  return givenNames.length > 0 ? `${givenNames.join(',').trim()} ${lastName.trim()}` : value.trim();
}

export function parseSermonCatalog(html) {
  const preacherCards = html.split(/<div class="sermon-card mb-4">/i).slice(1);
  const sermons = [];

  for (const card of preacherCards) {
    const preacherMatch = card.match(/<h5 class="sermon-card-title mb-0">([\s\S]*?)<\/h5>/i);
    if (!preacherMatch) continue;
    const preacher = normalizePreacher(decodeHtml(preacherMatch[1]));
    const sermonBlocks = card.split(/<div class="border rounded p-3 mb-3[^"]*">/i).slice(1);

    for (const block of sermonBlocks) {
      const titleMatch = block.match(/<h6 class="mb-1">([\s\S]*?)<\/h6>/i);
      const metaMatch = block.match(/<div class="sermon-meta mb-1">([\s\S]*?)<\/div>/i);
      const streamMatch = block.match(/<source\s+src="([^"]*sermons\/stream\/(\d+))"/i);
      if (!titleMatch || !metaMatch || !streamMatch) continue;

      const metaHtml = metaMatch[1];
      const date = decodeHtml(metaHtml.split('<span')[0]);
      const categoryMatch = metaHtml.match(/fa-tag[^>]*><\/i>[\s\S]*?([^<]+)<\/span>/i);
      const streamId = streamMatch[2];
      sermons.push({
        id: `archive-${streamId}`,
        title: decodeHtml(titleMatch[1]),
        preacher,
        date,
        category: categoryMatch ? decodeHtml(categoryMatch[1]) : 'Sermon',
        audioUrl: new URL(streamMatch[1], SOURCE_URL).href,
      });
    }
  }

  if (sermons.length === 0) throw new Error('No sermons were found in the source archive');
  if (new Set(sermons.map((sermon) => sermon.id)).size !== sermons.length) throw new Error('The source archive returned duplicate stream identifiers');
  return { source: SOURCE_URL, sermons };
}

export async function updateSermonCatalog({ checkOnly = false } = {}) {
  const response = await fetch(SOURCE_URL, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Archive request failed with ${response.status}`);
  const nextCatalog = `${JSON.stringify(parseSermonCatalog(await response.text()), null, 2)}\n`;
  const currentCatalog = await readFile(OUTPUT_URL, 'utf8').catch(() => '');

  if (currentCatalog === nextCatalog) return false;
  if (checkOnly) throw new Error('The bundled sermon catalog does not match the source archive');
  await writeFile(OUTPUT_URL, nextCatalog, 'utf8');
  return true;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = await updateSermonCatalog({ checkOnly: process.argv.includes('--check') });
  console.log(changed ? 'Sermon catalog updated.' : 'Sermon catalog is already current.');
}

import { promises as fs } from 'node:fs';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from '../../src/forms/testing/excelFixtures';
import { permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../../src/forms/testing/wordFixtures';

/**
 * Writes the synthetic forms the end-to-end tests import into `dir`, which must exist, and gives the path of each by
 * file name. `toolbox-rev01.docx` is a later revision of `toolbox.docx`: the same code, a new revision, `Subject`
 * renamed to `Topic`, and a `Location` field added.
 */
export async function writeFormFixtures(dir: string): Promise<Record<string, string>> {
  const forms: Record<string, Uint8Array> = {
    'toolbox.docx': toolboxTalkDocx(),
    'toolbox-rev01.docx': toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' }),
    'permit.docx': permitDocx(),
    'weekly.dotx': weeklyJobsDotx(),
    'inventory.xlsx': inventoryXlsx(),
    'daygrid.xlsx': dayGridXlsx(),
    'matrix.xlsx': matrixXlsx(),
    'conditions.xlsx': conditionListXlsx(),
  };
  const paths: Record<string, string> = {};
  for (const [fileName, bytes] of Object.entries(forms)) {
    paths[fileName] = `${dir}/${fileName}`;
    await fs.writeFile(paths[fileName], bytes);
  }
  return paths;
}

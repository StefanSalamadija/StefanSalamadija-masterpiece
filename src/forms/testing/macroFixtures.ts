import { bytesOf, partText, readPackage, utf8, writePackage } from '../package';
import { CONTENT_TYPE, REL_TYPE } from './zip';

/*
 * Macro-enabled and template variants of the synthetic fixtures (R21): an ordinary fixture with a made-up VBA project
 * added, as Word and Excel lay one out, and an Excel workbook declared as a template. Every added part is invented: the
 * "VBA project" is a few bytes of made-up text, never a real macro.
 */

const MS_REL = 'http://schemas.microsoft.com/office/2006/relationships';

export const MACRO_TYPE = {
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  vbaProject: 'application/vnd.ms-office.vbaProject',
  vbaData: 'application/vnd.ms-word.vbaData+xml',
  vbaSignature: 'application/vnd.ms-office.vbaProjectSignature',
  keyMap: 'application/vnd.ms-word.keyMapCustomizations+xml',
  printerSettings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings',
} as const;

export const MACRO_REL = {
  vbaProject: `${MS_REL}/vbaProject`,
  vbaData: `${MS_REL}/wordVbaData`,
  vbaSignature: `${MS_REL}/vbaProjectSignature`,
  keyMap: `${MS_REL}/keyMapCustomizations`,
  ribbon: 'http://schemas.microsoft.com/office/2007/relationships/ui/extensibility',
} as const;

/** Made-up bytes standing in for a VBA project: a compound-file magic, then invented text and every byte value. */
const FAKE_VBA = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, ...bytesOf('Demo module: Sub Hello() End Sub'), ...Array.from({ length: 256 }, (_, i) => i)]);
const FAKE_SIGNATURE = bytesOf('demo signature, not a real one');
const FAKE_PRINTER = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 256);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const VBA_DATA = `${XML}<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"><wne:mcds><wne:mcd wne:macroName="PROJECT.DEMOMODULE.HELLO" wne:name="Project.DemoModule.Hello" wne:bEncrypt="00" wne:cmg="56"/></wne:mcds></wne:vbaSuppData>`;
const KEY_MAP = `${XML}<wne:tcg xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"><wne:keymaps><wne:keymap wne:kcmPrimary="0448"><wne:macro wne:macroName="PROJECT.DEMOMODULE.HELLO"/></wne:keymap></wne:keymaps></wne:tcg>`;
const RIBBON_WITH_CALLBACK = `${XML}<customUI xmlns="http://schemas.microsoft.com/office/2009/07/customui"><ribbon><tabs><tab id="demoTab" label="Demo"><group id="demoGroup" label="Demo"><button id="hello" label="Hello" image="hello" onAction="Hello"/></group></tab></tabs></ribbon></customUI>`;
const RIBBON_PLAIN = `${XML}<customUI xmlns="http://schemas.microsoft.com/office/2009/07/customui"><ribbon><tabs><tab idMso="TabDeveloper" visible="false"/></tabs></ribbon></customUI>`;
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

export type MacroKind = 'docm' | 'dotm' | 'xlsm' | 'xltm';

export interface MacroOptions {
  /** Word: a signature part for the project (`vbaProjectSignature.bin`, from the project's own `.rels`). */
  signature?: boolean;
  /** Word: a key map (`customizations.xml`) that runs a macro. */
  keyMap?: boolean;
  /** A ribbon (`customUI/customUI14.xml`) whose button calls a macro, with an icon of its own. */
  ribbon?: boolean;
  /** A ribbon (`customUI/plain.xml`) that only hides a tab and calls nothing. */
  plainRibbon?: boolean;
  /** Excel: a printer settings part, which shares the `bin` extension with the project. */
  printerSettings?: boolean;
}

/** The text of a part with `entry` put before its closing `</Types>` or `</Relationships>`. */
function before(text: string, closing: string, entry: string): string {
  const at = text.lastIndexOf(closing);
  if (at < 0) throw new Error(`No ${closing}`);
  return text.slice(0, at) + entry + text.slice(at);
}

const rel = (id: string, type: string, target: string): string => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
const rels = (...entries: string[]): string => `${XML}<Relationships xmlns="${RELS_NS}">${entries.join('')}</Relationships>`;

/**
 * `bytes` (a `.docx`, `.dotx` or `.xlsx` fixture) turned into a macro file of `kind`, laid out as Word and Excel save
 * one: the main part's content type becomes the macro-enabled one, and `vbaProject.bin` sits beside the main part with
 * a relationship from it. Word declares the project by a `bin` Default and gives it a `vbaData.xml` through its own
 * `.rels`; Excel declares it by an Override.
 */
export function withMacros(bytes: Uint8Array, kind: MacroKind, options: MacroOptions = {}): Uint8Array {
  const pkg = readPackage(bytes);
  const word = kind === 'docm' || kind === 'dotm';
  const main = word ? 'word/document.xml' : 'xl/workbook.xml';
  const dir = main.slice(0, main.lastIndexOf('/') + 1);
  const mainRels = `${dir}_rels/${main.slice(dir.length)}.rels`;
  const changed = new Map<string, Uint8Array>();

  let types = partText(pkg, '[Content_Types].xml')!;
  types = types.replace(word ? /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.(?:document|template)\.main\+xml/ : /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.(?:sheet|template)\.main\+xml/, MACRO_TYPE[kind]);
  let relsText = partText(pkg, mainRels)!;
  relsText = before(relsText, '</Relationships>', rel('rIdVba1', MACRO_REL.vbaProject, 'vbaProject.bin'));
  let rootRels = partText(pkg, '_rels/.rels')!;

  changed.set(`${dir}vbaProject.bin`, FAKE_VBA);
  if (word) {
    // Word: `<Default Extension="bin">` for the project, its `.rels` to `vbaData.xml`.
    types = types.replace(/<Default\b/, `<Default Extension="bin" ContentType="${MACRO_TYPE.vbaProject}"/><Default`);
    types = before(types, '</Types>', `<Override PartName="/word/vbaData.xml" ContentType="${MACRO_TYPE.vbaData}"/>`);
    const projectRels = [rel('rId1', MACRO_REL.vbaData, 'vbaData.xml')];
    changed.set('word/vbaData.xml', bytesOf(VBA_DATA));
    if (options.signature) {
      projectRels.push(rel('rId2', MACRO_REL.vbaSignature, 'vbaProjectSignature.bin'));
      types = before(types, '</Types>', `<Override PartName="/word/vbaProjectSignature.bin" ContentType="${MACRO_TYPE.vbaSignature}"/>`);
      changed.set('word/vbaProjectSignature.bin', FAKE_SIGNATURE);
    }
    changed.set('word/_rels/vbaProject.bin.rels', bytesOf(rels(...projectRels)));
    if (options.keyMap) {
      relsText = before(relsText, '</Relationships>', rel('rIdKeys1', MACRO_REL.keyMap, 'customizations.xml'));
      types = before(types, '</Types>', `<Override PartName="/word/customizations.xml" ContentType="${MACRO_TYPE.keyMap}"/>`);
      changed.set('word/customizations.xml', bytesOf(KEY_MAP));
    }
  } else {
    types = before(types, '</Types>', `<Override PartName="/xl/vbaProject.bin" ContentType="${MACRO_TYPE.vbaProject}"/>`);
    if (options.printerSettings) {
      types = types.replace(/<Default\b/, `<Default Extension="bin" ContentType="${MACRO_TYPE.printerSettings}"/><Default`);
      changed.set('xl/printerSettings/printerSettings1.bin', FAKE_PRINTER);
    }
  }
  if (options.ribbon) {
    rootRels = before(rootRels, '</Relationships>', rel('rIdUi1', MACRO_REL.ribbon, 'customUI/customUI14.xml'));
    changed.set('customUI/customUI14.xml', bytesOf(RIBBON_WITH_CALLBACK));
    changed.set('customUI/_rels/customUI14.xml.rels', bytesOf(rels(rel('hello', REL_TYPE.image, 'images/hello.png'))));
    changed.set('customUI/images/hello.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
  }
  if (options.plainRibbon) {
    rootRels = before(rootRels, '</Relationships>', rel('rIdUi2', MACRO_REL.ribbon, 'customUI/plain.xml'));
    changed.set('customUI/plain.xml', bytesOf(RIBBON_PLAIN));
  }

  changed.set('[Content_Types].xml', bytesOf(types));
  changed.set(mainRels, bytesOf(relsText));
  if (rootRels !== partText(pkg, '_rels/.rels')) changed.set('_rels/.rels', bytesOf(rootRels));
  return writePackage(pkg, changed);
}

/** An `.xlsx` fixture declared as a template (`.xltx`): only its workbook's content type changes. */
export function asExcelTemplate(bytes: Uint8Array): Uint8Array {
  const pkg = readPackage(bytes);
  const types = utf8(pkg.entries.get('[Content_Types].xml')!);
  if (!types.includes(CONTENT_TYPE.workbook)) throw new Error('Not a workbook');
  return writePackage(pkg, new Map([['[Content_Types].xml', bytesOf(types.replace(CONTENT_TYPE.workbook, MACRO_TYPE.xltx))]]));
}

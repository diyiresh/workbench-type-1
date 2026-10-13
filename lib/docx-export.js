"use strict";

const MarkdownIt = require("markdown-it");
const d = require("docx");
const AdmZip = require("adm-zip");
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const md = new MarkdownIt({ html: false, linkify: false });

function inline(tokens = [], docxLibrary = d) {
  const d = docxLibrary;
  let bold = false, italics = false;
  const runs = [];
  const links = [];
  for (const t of tokens) {
    if (t.type === "strong_open") bold = true;
    else if (t.type === "strong_close") bold = false;
    else if (t.type === "em_open") italics = true;
    else if (t.type === "em_close") italics = false;
    else if (t.type === 'link_open') links.push({ start: runs.length, href: t.attrGet('href') });
    else if (t.type === 'link_close') { const link = links.pop(); runs.push(new d.ExternalHyperlink({ children: runs.splice(link.start), link: link.href })); }
    else if (["softbreak", "hardbreak"].includes(t.type)) runs.push(new d.TextRun({ break: 1 }));
    else if (["text", "code_inline"].includes(t.type)) runs.push(new d.TextRun({ text: t.content, bold, italics, color: "000000" }));
    else if (t.type === "image") throw new Error("docx_images_require_explicit_materials");
    else if (!["link_open", "link_close"].includes(t.type)) throw new Error("unsupported_markdown_inline:" + t.type);
  }
  return runs;
}

function plain(tokens) {
  return tokens.filter(t => ["text", "code_inline", "softbreak", "hardbreak"].includes(t.type))
    .map(t => t.type.endsWith("break") ? "\n" : t.content).join("");
}

// The same parsed blocks drive authoring and content readback. No model rewrites.
function blocks(source, docxLibrary = d) {
  const d = docxLibrary;
  if (/<(?:script|iframe|img|table)\b/i.test(source)) throw new Error("unsupported_markdown_html");
  const tokens = md.parse(source.replace(/<!--[^]*?-->/g, ""), {});
  const result = [];
  let heading = 0, listDepth = 0;
  const lists = [];
  let itemPrefix = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") heading = Number(t.tag.slice(1));
    else if (t.type === "heading_close") heading = 0;
    else if (["bullet_list_open", "ordered_list_open"].includes(t.type)) { listDepth++; lists.push({ ordered: t.type === 'ordered_list_open', next: Number(t.attrGet('start') || 1) }); }
    else if (["bullet_list_close", "ordered_list_close"].includes(t.type)) { listDepth--; lists.pop(); }
    else if (t.type === 'list_item_open') { const list = lists.at(-1); itemPrefix = list.ordered ? String(list.next++) + '. ' : '• '; }
    else if (t.type === "table_open") {
      const rows = []; let row, cell;
      while (++i < tokens.length && tokens[i].type !== "table_close") {
        const v = tokens[i];
        if (v.type === "tr_open") { row = []; rows.push(row); }
        if (["td_open", "th_open"].includes(v.type)) { cell = { header: v.type === "th_open", runs: [], text: "" }; row.push(cell); }
        if (v.type === "inline") { cell.runs = inline(v.children, d); cell.text = plain(v.children); }
      }
      result.push({ table: rows });
    } else if (t.type === "inline") { result.push({ heading, listDepth, runs: [...(itemPrefix ? [new d.TextRun(itemPrefix)] : []), ...inline(t.children, d)], text: itemPrefix + plain(t.children) }); itemPrefix = ''; }
    else if (["fence", "code_block"].includes(t.type)) result.push({ runs: [new d.TextRun(t.content.trimEnd())], text: t.content.trimEnd(), code: true });
  }
  return result;
}

function normalizeText(value) { return value.replace(/\s+/g, ""); }

function tableWidths(rows) {
  const count = rows[0].length;
  if (count > 10) throw new Error("docx_table_too_many_columns");
  const weights = rows[0].map((cell, index) => /^(#|编号|序号|ID)$/i.test(cell.text.trim()) ? 1 : Math.sqrt(Math.max(6, Math.min(800, Math.max(...rows.map(row => (row[index]?.text || '').length))))));
  const minimum = weights.map(w => w === 1 ? 450 : 950);
  const free = Math.max(0, 9638 - minimum.reduce((a,b) => a+b,0));
  const total = weights.reduce((a,b) => a+b,0);
  const widths = weights.map((w,i) => minimum[i] + Math.floor(free * w / total));
  widths[widths.length - 1] += 9638 - widths.reduce((a,b) => a+b,0);
  return widths;
}

function readDocx(buffer) {
  const zip = new AdmZip(buffer);
  const xml = zip.readAsText("word/document.xml");
  if (!zip.getEntry("[Content_Types].xml") || !xml || XMLValidator.validate(xml) !== true) throw new Error("invalid_docx_package");
  // Read paragraphs and table cells in document order, preserving entity decoding.
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, parseTagValue: false });
  const paragraphs = [];
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node["w:p"]) { let text = ""; function collect(xs) { for (const x of xs || []) { if (x["w:t"]) text += x["w:t"].map(y => y["#text"] ?? "").join(""); else if (x["w:br"] || x["w:tab"]) text += "\n"; else for (const value of Object.values(x)) if (Array.isArray(value)) collect(value); } } collect(node["w:p"]); paragraphs.push(text); }
      else for (const value of Object.values(node)) if (Array.isArray(value)) visit(value);
    }
  }
  visit(parser.parse(xml));
  return paragraphs.join("\n");
}

async function exportDocx(source, docxLibrary = d) {
  const d = docxLibrary;
  const parsed = blocks(source, d);
  const expectedText = parsed.flatMap(b => b.table ? b.table.flat().map(c => c.text) : [b.text]).join("\n");
  let titleUsed = false;
  const paragraph = b => {
    const firstHeading = b.heading && !titleUsed;
    if (b.heading) titleUsed = true;
    return new d.Paragraph({ children: b.runs, heading: b.heading ? (firstHeading ? d.HeadingLevel.TITLE : d.HeadingLevel["HEADING_" + Math.min(Math.max(b.heading - 1, 1), 6)]) : undefined,
    indent: b.listDepth ? { left: b.listDepth * 240 } : undefined, spacing: { after: 100, line: 320 }, keepNext: !!b.heading, widowControl: true });
  };
  const children = parsed.map(b => b.table ? new d.Table({ width: { size: 9638, type: d.WidthType.DXA }, layout: d.TableLayoutType.FIXED,
    columnWidths: tableWidths(b.table),
    rows: b.table.map(row => new d.TableRow({ tableHeader: row.every(c => c.header), children: row.map((c,index) => new d.TableCell({ width: { size: tableWidths(b.table)[index], type: d.WidthType.DXA }, children: [new d.Paragraph({ children: c.runs, spacing: { after: 60 }, widowControl: true })],
      margins: { top: 70, bottom: 70, left: 90, right: 90 }, shading: c.header ? { fill: "EAEAEA" } : undefined })) })) }) : paragraph(b));
  const doc = new d.Document({ styles: { default: { document: { run: { font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "宋体" }, size: 24, color: "000000" } },
    title: { run: { font: "黑体", size: 32, bold: true, color: "000000" } }, heading1: { run: { font: "黑体", size: 28, bold: true, color: "000000" } }, heading2: { run: { font: "黑体", size: 26, bold: true, color: "000000" } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children,
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT] })] })] }) } }] });
  const buffer = await d.Packer.toBuffer(doc);
  const readback = readDocx(buffer);
  if (!expectedText.trim() || normalizeText(readback) !== normalizeText(expectedText)) throw new Error("docx_content_readback_mismatch");
  return { buffer, readback, contentSha256: require("crypto").createHash("sha256").update(normalizeText(readback)).digest("hex") };
}

module.exports = { exportDocx, readDocx, normalizeText };

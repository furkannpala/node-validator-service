const xmlJs = require("xml-js");

/**
 * Java walked every write payload with doc.getElementsByTagName("*"), a flat list of all
 * elements in document order. The compact xml-js tree used elsewhere groups siblings by tag
 * name and loses that order, so the write paths parse in non-compact mode and flatten here.
 */

/**
 * Java's DocumentBuilder rejected a truncated body; xml-js drops the unfinished element and
 * returns what it had, which would let a half-uploaded payload through as if it were whole.
 * Anything malformed in the middle still raises from the parser itself.
 */
function assertWellFormed(text) {
    const trimmed = text.trim();
    if (trimmed === "") throw new Error("Premature end of file.");
    if (!trimmed.endsWith(">")) throw new Error("XML document ends inside a tag.");
}

/** Pre-order list of { name, attrs, node } — the same order and content Java iterated. */
function elements(xml) {
    const text = Buffer.isBuffer(xml) ? xml.toString("utf-8") : String(xml == null ? "" : xml);
    assertWellFormed(text);
    const root = xmlJs.xml2js(text, { compact: false, ignoreComment: true, ignoreDoctype: true });
    const out = [];
    collect(root.elements, out);
    return out;
}

function collect(nodes, out) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
        if (node.type !== "element") continue;
        out.push({ name: node.name, attrs: node.attributes || {}, node });
        collect(node.elements, out);
    }
}

/** Descendants of one element with the given tag name, as Element.getElementsByTagName did. */
function descendants(node, tagName) {
    const out = [];
    collect(node?.elements, out);
    return out.filter((e) => e.name.toLowerCase() === String(tagName).toLowerCase());
}

module.exports = { elements, descendants };

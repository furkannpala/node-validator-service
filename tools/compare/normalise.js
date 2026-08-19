/**
 * Turns the two services' answers into something comparable. Everything removed here is a
 * difference the migration plan already accepts or that neither service controls; a real
 * difference in an attribute value survives all of it.
 *
 * Each rule is listed in the report so a reader can see what was forgiven.
 */

/** Java writes standalone="no" and puts no newline after the declaration; xml-js does neither. */
function stripDeclaration(text) {
    return text.replace(/<\?xml[^>]*\?>\s*/, '');
}

/**
 * ojdbc11 appends "\n\nhttps://docs.oracle.com/error-help/..." to an ORA message and
 * node-oracledb appends "\nHelp: https://docs.oracle.com/error-help/...". Both drivers add a
 * link to the same page; neither service chose to.
 */
function stripOracleHelpLink(text) {
    return text.replace(/(?:&#10;|\s)*(?:Help:\s*)?https:\/\/docs\.oracle\.com\/error-help\/\S*/g, '');
}

/**
 * Java's XML writer escapes a newline inside an attribute value as &#10;, xml-js leaves it
 * literal. An XML parser normalises a literal newline in an attribute to a space, so this is a
 * real difference on the device — it is recorded in the report rather than fixed, because
 * getXmlResponse lives in the parent project.
 */
function unifyAttributeNewlines(text) {
    return text.replace(/&#10;/g, '\n');
}

/**
 * ORA-06550 quotes the position of the offending token in the statement, and the roadmap
 * converts Java's {call ...} escape into an anonymous BEGIN ... END; block, which moves it.
 * Only the coordinates are dropped: the PLS- code and the message after them still have to
 * match, so a genuinely different compilation failure is still caught.
 */
function stripPlsqlPosition(text) {
    return text.replace(/line \d+, column \d+:/g, 'line <POS>:');
}

/** Values the database or the clock produces at call time, named per case. */
function blankVolatile(text, names) {
    let out = text;
    for (const name of names || []) {
        out = out.replace(new RegExp(`(\\b${name}\\s*=\\s*")[^"]*(")`, 'g'), '$1<VOLATILE>$2');
    }
    return out;
}

/** Indentation and line breaks between elements, which the plan tolerates. */
function collapseWhitespace(text) {
    return text.replace(/>\s+</g, '><').replace(/[ \t]+/g, ' ').trim();
}

function normalise(text, volatile) {
    let out = String(text == null ? '' : text);
    out = stripDeclaration(out);
    out = unifyAttributeNewlines(out);
    out = stripOracleHelpLink(out);
    out = stripPlsqlPosition(out);
    out = blankVolatile(out, volatile);
    out = collapseWhitespace(out);
    return out;
}

const RULES = [
    'XML declaration dropped (Java adds standalone="no")',
    'newline in an attribute unified (&#10; vs literal) — a real device-side difference, see notes [52]',
    'the Oracle error-help link both JDBC drivers append is removed',
    'ORA-06550 line/column coordinates dropped (the {call} to BEGIN..END; conversion moves them)',
    'per-case volatile attributes blanked (clock and sequence values)',
    'whitespace between elements collapsed',
];

module.exports = { normalise, RULES };

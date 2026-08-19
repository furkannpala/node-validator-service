/**
 * Java serialised the Kafka payloads with Gson, whose default is to leave a null field out of
 * the document altogether. The consumers were written against that, so a bean projection has
 * to drop nulls rather than emit them — an empty string is a value and stays.
 *
 * Key order is the order of the object handed in, which is why every caller lists the fields
 * in the Java class's declaration order.
 */
function gson(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}

module.exports = { gson };

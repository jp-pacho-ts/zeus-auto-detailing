// Independent reader of the client's document; never uses the manifest builder.
export function documentPrices(source) {
    const rows = source.split(/\r?\n/).filter(line => line.startsWith('|')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
    const prices = new Map();
    const amount = cell => cell === '—' ? 'N' : cell === '?' ? 'U' : Number(cell.replaceAll(',', '').match(/\d+/)?.[0]);
    for (const row of rows) {
        const name = row[0];
        if (['Basic Wash', 'Signature Wash', 'Premium Wash'].includes(name))
            prices.set(name, row.slice(2, 7).map(amount));
        else if (['Glass Acid Rain Removal', 'Bac to Zero', 'Interior Detailing', 'Exterior Detailing', 'Engine Detailing', 'Full Detailing', 'Headlight Restoration'].includes(name))
            prices.set(name, row.slice(1, 6).map(amount));
        else if (/^Package [123] ·/.test(name))
            prices.set(name.split(' · ')[1].split(' (')[0], ['U', ...row.slice(1, 5).map(cell => Number(cell.match(/\*\*([\d,]+)\*\*/)[1].replaceAll(',', '')))]);
        else if (['Nano Ceramic Tint', 'Sputtered Tint', 'Regular Tint'].includes(name))
            prices.set(name, ['U', ...row.slice(2, 6).map(amount)]);
        else if (['7.5 mil TPU', '8.0 mil TPU'].includes(name))
            prices.set(name, ['U', ...row.slice(1, 5).map(amount)]);
        else if (name === 'Washover repaint (full)')
            prices.set(name, ['U', ...[...row[1].matchAll(/(?:S|M|L|XL) ([\d,]+)/g)].map(match => Number(match[1].replaceAll(',', '')))]);
        else if (name === 'Panel repaint')
            prices.set(name, Array(5).fill('U'));
    }
    prices.set('Motorcycle Graphene', [Number(source.match(/\*\*Motorcycle Graphene:\*\* ([\d,]+)/)[1].replaceAll(',', '')), 'U', 'U', 'U', 'U']);
    return prices;
}

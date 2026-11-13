// Bundles the game into one HTML file for publishing as a claude.ai artifact.
// Usage: node tools/build-artifact.js  ->  dist/hexhaven.html
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).trim();
const js = ['js/board.js', 'js/rules.js', 'js/ui.js'].map(read).join('\n');
const out = `<title>Hexhaven</title>
<style>
${read('style.css')}
</style>
${body}
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/hexhaven.html'), out);
console.log('wrote dist/hexhaven.html', out.length, 'bytes');

// Fails when any page could load data from somewhere other than the selected node.
//   - scripts: no fetch / $.get / $.ajax / XHR / WebSocket / socket.io outside scripts/common/node.js,
//     and no known data host named in code (comments are ignored)
//   - pages, templates, styles: no script, stylesheet, font or @import from another host
// Images and media may come from anywhere (NFT pictures), and plain links are fine.
// Run: node tools/check-no-foreign-fetch.js  (the gulp build runs it first)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'app');
const NODE_LAYER = path.join('scripts', 'common', 'node.js');
const SKIP_DIRS = [path.join('scripts', '3rd-party'), 'vendor'];

const NETWORK_CALLS = [
	/\bfetch\s*\(/,
	/\$\.(get|post|ajax|getJSON|getScript)\s*\(/,
	/\bXMLHttpRequest\b/,
	/\bnew\s+WebSocket\b/,
	/\bnew\s+EventSource\b/,
	/\bio\s*\(\s*['"`]/,
	/navigator\.sendBeacon/,
	/\bimportScripts\s*\(/
];

const DATA_HOSTS = [
	'api.ergoplatform.com', 'api-testnet.ergoplatform.com', 'api-p2p.ergoplatform.com', 'node-p2p.ergoplatform.com',
	'api.ergexplorer.com', 'api2.ergexplorer.com', 'devapi.ergexplorer.com', 'socket.ergexplorer.com',
	'chain.mewfinance.com', 'api.mewfinance.com', 'api2.mewfinance.com', 'stats.mewfinance.com',
	'sigmaspace.io', 'ergo.watch', 'cruxfinance.io', 'spectrum.fi', 'ergopad.io', 'ergo.aap.cornell.edu'
];

const PAGE_RULES = [
	[/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i, 'script from another host'],
	[/<link[^>]+href\s*=\s*["']?(https?:)?\/\/[^>]*>/i, 'link to another host', tag => /rel\s*=\s*["']?(stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|manifest|icon)/i.test(tag)],
	[/@import\s+(url\()?["']?(https?:)?\/\//i, '@import from another host'],
	[/url\(\s*["']?(https?:)?\/\/[^)]*\.(woff2?|ttf|otf|eot|css)/i, 'font or stylesheet from another host']
];

function stripComments(code) {
	// Good enough for this codebase: blanks /* */ blocks (keeping line numbers) and // comments not part of a URL
	return code
		.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
		.replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(root, full);

		if (SKIP_DIRS.some(skip => rel === skip || rel.startsWith(skip + path.sep))) continue;
		if (entry.isDirectory()) walk(full, out);
		else out.push(rel);
	}

	return out;
}

const problems = [];

for (const rel of walk(root)) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');

	if (rel.endsWith('.js')) {
		const code = stripComments(text.replace(/\/\/ lite-allow-media.*$/gm, ''));
		const lines = code.split('\n');

		lines.forEach((line, i) => {
			// NFT media (images, audio, video) may come from anywhere; such a line says so with this marker
			if (text.split('\n')[i] && text.split('\n')[i].includes('lite-allow-media')) return;

			if (rel !== NODE_LAYER) {
				for (const pattern of NETWORK_CALLS) {
					if (pattern.test(line)) problems.push(rel + ':' + (i + 1) + '  network call outside node.js: ' + line.trim().slice(0, 120));
				}
			}

			for (const host of DATA_HOSTS) {
				if (line.includes(host)) problems.push(rel + ':' + (i + 1) + '  data host ' + host + ': ' + line.trim().slice(0, 120));
			}
		});
	}

	if (/\.(njk|html|css|scss)$/.test(rel) && !/^[^/]+\.html$/.test(rel)) {
		const lines = text.split('\n');

		lines.forEach((line, i) => {
			for (const [pattern, label, accept] of PAGE_RULES) {
				const match = line.match(pattern);
				if (match && (!accept || accept(match[0]))) problems.push(rel + ':' + (i + 1) + '  ' + label + ': ' + line.trim().slice(0, 120));
			}

			for (const host of DATA_HOSTS) {
				if (line.includes(host)) problems.push(rel + ':' + (i + 1) + '  data host ' + host + ': ' + line.trim().slice(0, 120));
			}
		});
	}
}

if (problems.length > 0) {
	console.error(problems.join('\n'));
	console.error('\n' + problems.length + ' problem(s): everything must come from the selected node (scripts/common/node.js).');
	process.exit(1);
}

console.log('No foreign data sources.');

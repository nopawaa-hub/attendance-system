// Small helper to render HTML pages without a template engine.
function page({ title, body, head = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
${head}
</head>
<body class="bg-slate-100 min-h-screen">
${body}
</body>
</html>`;
}

module.exports = { page };

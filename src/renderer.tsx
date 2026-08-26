import { jsxRenderer } from 'hono/jsx-renderer';

export const renderer = jsxRenderer(({ children, title }) => {
  return (
    <html lang="en-AU">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" content="#17629d" />
        <meta name="application-name" content="ProInspect Building Management" />
        <meta name="description" content="Building operations for Prima and Meridian Apartments" />
        <title>{title ? `${title} · ProInspect Building Management` : 'ProInspect Building Management · Prima & Meridian'}</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/static/proinspect-icon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://cdn.tailwindcss.com" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous" />
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        <link href="/static/style.css" rel="stylesheet" />
        <script src="/static/app.js"></script>
        <script src="/static/pwa.js" defer></script>
      </head>
      <body class="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
});

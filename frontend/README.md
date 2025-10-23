# Proxy AI Fusion - Frontend

Modern, type-safe frontend for Proxy AI Fusion built with React, TypeScript, and shadcn/ui.

## Tech Stack

- **React 18** - UI framework
- **TypeScript 5** - Type safety
- **Vite** - Fast build tool with HMR
- **shadcn/ui** - Beautiful, accessible UI components built on Radix UI
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Beautiful icon library
- **Chart.js** - Token usage visualization

## Features

- 🎨 Modern, responsive UI with dark/light theme support
- 🌐 Internationalization (English and Chinese)
- 🔄 Real-time request monitoring via WebSocket
- ⚙️ Complete configuration management
- 🔀 Model routing configuration
- ⚖️ Load balancer settings
- 📊 Request logs with detailed views
- 🎯 Type-safe API client
- ♿ Accessible components (ARIA compliant)

## Development

### Prerequisites

- Node.js 18+ (or compatible)
- npm or yarn

### Install Dependencies

```bash
cd frontend
npm install
```

### Development Server

```bash
npm run dev
```

This starts the Vite dev server at `http://localhost:5173` with HMR enabled. API requests will be proxied to `http://localhost:8800`.

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

## Building for Production

### Build

```bash
npm run build
```

This command:
1. Runs TypeScript compiler for type checking
2. Builds the production bundle with Vite
3. Outputs to `frontend/dist/`

The Rust backend is configured to serve these static files from `frontend/dist/`.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
frontend/
├── src/
│   ├── components/        # React components
│   │   ├── ui/           # shadcn/ui base components
│   │   ├── ConfigPanel.tsx
│   │   ├── RoutingPanel.tsx
│   │   ├── LoadBalancerPanel.tsx
│   │   ├── LogsPanel.tsx
│   │   └── RequestMonitor.tsx
│   ├── services/         # API and WebSocket clients
│   │   ├── api.ts
│   │   ├── websocket.ts
│   │   └── i18n.ts
│   ├── types/            # TypeScript type definitions
│   │   ├── common.ts
│   │   ├── routing.ts
│   │   ├── loadbalancer.ts
│   │   ├── logs.ts
│   │   └── events.ts
│   ├── lib/              # Utility functions
│   │   └── utils.ts
│   ├── styles/           # Global styles
│   │   └── globals.css
│   ├── App.tsx           # Main application component
│   └── main.tsx          # Application entry point
├── public/
│   └── locales/          # i18n translation files
│       ├── en.json
│       └── zh.json
├── index.html            # HTML entry point
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite configuration
├── tailwind.config.ts    # Tailwind CSS configuration
├── postcss.config.js     # PostCSS configuration
└── components.json       # shadcn/ui configuration
```

## Adding New shadcn/ui Components

The project uses [shadcn/ui](https://ui.shadcn.com/) for UI components. To add a new component:

```bash
npx shadcn-ui@latest add <component-name>
```

For example:
```bash
npx shadcn-ui@latest add dropdown-menu
npx shadcn-ui@latest add toast
```

## Customization

### Theme

Edit `src/styles/globals.css` to customize the color scheme:

```css
:root {
  --primary: 221.2 83.2% 53.3%;
  --secondary: 210 40% 96.1%;
  /* ... */
}
```

### Tailwind Configuration

Modify `tailwind.config.ts` to customize Tailwind CSS settings.

## API Integration

The frontend communicates with the Rust backend via:

1. **REST API** - Located at `/api/*` endpoints
2. **WebSocket** - Real-time updates at `/ws/realtime`

API client is defined in `src/services/api.ts` with full TypeScript type safety.

## Internationalization

Translation files are located in `public/locales/`:
- `en.json` - English
- `zh.json` - Chinese (Simplified)

To add a new language:
1. Create a new JSON file in `public/locales/`
2. Update the `Language` type in `src/services/i18n.ts`
3. Add the language option in `App.tsx`

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

Same as parent project

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Optional same-origin route to the local Supabase API. Point VITE_SUPABASE_URL at
    // http://localhost:5173/supabase to use it. Some embedded browsers (such as the
    // Claude desktop app's browser pane) block a page from calling another local port;
    // ordinary browsers do not need this. Development server only.
    proxy: {
      '/supabase': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
    },
  },
});

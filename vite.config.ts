import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Sprint 11 (F-56): the address the README, Supabase's site_url and the screenshot script use.
    // Vite's default, localhost, can resolve to ::1 and not answer on 127.0.0.1.
    host: '127.0.0.1',
    // Optional same-origin route to the local Supabase API. Point VITE_SUPABASE_URL at
    // http://127.0.0.1:5173/supabase to use it. Some embedded browsers (such as the
    // Claude desktop app's browser pane) block a page from calling another local port;
    // ordinary browsers do not need this. Development server only.
    proxy: {
      // Only Supabase's own API paths: the browser also loads shared code from the
      // supabase/functions folder (Sprint 2), which must not be sent to the database server.
      '^/supabase/(auth|rest|functions|storage|realtime)/v1': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
    },
  },
});

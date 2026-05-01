import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Real ISO Proxy with aggressive redirect following and streaming
  app.use('/iso-proxy', async (req, res) => {
    try {
      const urlPath = req.url.replace(/^\//, '');
      const targetUrl = `https://cdimage.debian.org/${urlPath}`;
      console.log('Proxying ISO Request:', targetUrl, req.headers.range);
      
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(targetUrl, {
        method: req.method,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(req.headers.range ? { 'Range': req.headers.range } : {})
        }
      });
      
      if (!response.ok && response.status !== 206) {
        res.status(response.status).send('Upstream status ' + response.status);
        return;
      }
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      
      res.status(response.status);
      
      for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
      }
      
      if (response.body) {
         response.body.pipe(res);
      } else {
         res.end();
      }
      
    } catch (err) {
      console.error('ISO Proxy Error:', err);
      res.status(500).send('Proxy Error');
    }
  });

  const distroProxy = createProxyMiddleware({
    target: 'https://distrosea.com',
    changeOrigin: true,
    ws: true,
    pathRewrite: {
      '^/distrosea-proxy': '',
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        // Look like a real browser to DistroSea
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        proxyReq.setHeader('Referer', 'https://distrosea.com/');
        proxyReq.setHeader('Origin', 'https://distrosea.com');
        
        // Pass through original cookies if they exist
        if (req.headers.cookie) {
          proxyReq.setHeader('cookie', req.headers.cookie);
        }
      },
      proxyRes: (proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';
        
        // Remove frame blockers
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-content-type-options'];
        
        // Handle Cookies: Change domain to match our proxy host
        if (proxyRes.headers['set-cookie']) {
          proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie => 
            cookie.replace(/Domain=[^;]+;?/i, '').replace(/Secure/i, '')
          );
        }

        // We only buffer and modify text-based content
        const shouldModify = contentType.includes('text/html') || 
                            contentType.includes('javascript') || 
                            contentType.includes('application/json');

        if (shouldModify) {
          let body = Buffer.from([]);
          proxyRes.on('data', (chunk) => { body = Buffer.concat([body, chunk]); });
          proxyRes.on('end', () => {
            let content = body.toString();
            
            if (contentType.includes('text/html')) {
              // Inject base tag and rewrite absolute paths
              // Use regex for case-insensitive head tag
              if (/<head/i.test(content)) {
                content = content.replace(/(<head[^>]*>)/i, '$1<base href="/distrosea-proxy/">');
              } else {
                content = '<base href="/distrosea-proxy/">' + content;
              }
              content = content.replace(/(src|href|action)="\//g, '$1="/distrosea-proxy/');
              
              // Disable frame-busting scripts deeply
              content = content.replace(/window\.top\s*!==\s*window\.self/g, 'false');
              content = content.replace(/top\.location\.href/g, 'self.location.href');
              content = content.replace(/parent\.location/g, 'self.location');
            } else if (contentType.includes('javascript')) {
              // Rewrite dynamic domain references in JS
              content = content.replace(/https:\/\/distrosea\.com/g, ''); 
            }
            
            // Set headers and send modified content
            Object.keys(proxyRes.headers).forEach((key) => {
              const lowerKey = key.toLowerCase();
              if (!['content-length', 'x-frame-options', 'content-security-policy', 'transfer-encoding'].includes(lowerKey)) {
                res.setHeader(key, proxyRes.headers[key]!);
              }
            });
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.end(content);
          });
        } else {
          // Pass through binary data (images, fonts, etc.) directly
          Object.keys(proxyRes.headers).forEach((key) => {
            if (!['x-frame-options', 'content-security-policy'].includes(key.toLowerCase())) {
              res.setHeader(key, proxyRes.headers[key]!);
            }
          });
          res.setHeader('Access-Control-Allow-Origin', '*');
          proxyRes.pipe(res);
        }
      }
    },
    selfHandleResponse: true,
  });

  app.use('/distrosea-proxy', distroProxy);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on 0.0.0.0:${PORT}`);
    console.log(`NODE_ENV is ${process.env.NODE_ENV}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});


import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fetch from 'node-fetch';

const app = express();
app.use('/proxy', createProxyMiddleware({
  target: 'https://cdimage.debian.org',
  changeOrigin: true,
  followRedirects: true,
  pathRewrite: { '^/proxy': '' },
}));

const server = app.listen(4000, async () => {
   const res = await fetch('http://localhost:4000/proxy/debian-cd/current/amd64/iso-cd/debian-13.4.0-amd64-netinst.iso', { redirect: 'manual' });
   console.log(res.status);
   console.log(res.headers.raw());
   server.close();
});
